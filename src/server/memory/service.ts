import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import {
  interviewTurns,
  lifeEventPeople,
  lifeEvents,
  memoryFacts,
  people,
  relationships,
  storyThreadPeople,
  storyThreads,
} from "@/db/schema";
import { recordAudit } from "../audit";
import { requireProjectAccess } from "../authz";
import { NotFoundError, ValidationError } from "../errors";

export type Person = typeof people.$inferSelect;
export type LifeEvent = typeof lifeEvents.$inferSelect;
export type Fact = typeof memoryFacts.$inferSelect;

// ------------------------------------------------------------------ people

export async function listPeople(db: DbClient, projectId: string) {
  const rows = await db
    .select()
    .from(people)
    .where(and(eq(people.projectId, projectId), inArray(people.status, ["confirmed", "proposed"]), eq(people.isNarrator, false)))
    .orderBy(asc(people.preferredName));
  const counts = rows.length
    ? await db
        .select({ personId: lifeEventPeople.personId, count: sql<number>`count(*)` })
        .from(lifeEventPeople)
        .where(inArray(lifeEventPeople.personId, rows.map((r) => r.id)))
        .groupBy(lifeEventPeople.personId)
    : [];
  const countMap = new Map(counts.map((c) => [c.personId, Number(c.count)]));
  return rows.map((p) => ({ ...p, eventCount: countMap.get(p.id) ?? 0 }));
}

export async function getPersonDetail(db: DbClient, projectId: string, personId: string) {
  const person = await db.query.people.findFirst({ where: and(eq(people.id, personId), eq(people.projectId, projectId)) });
  if (!person || person.status === "rejected" || person.status === "merged") throw new NotFoundError("We couldn't find that person.");
  const events = await db
    .select({ event: lifeEvents })
    .from(lifeEventPeople)
    .innerJoin(lifeEvents, eq(lifeEvents.id, lifeEventPeople.eventId))
    .where(and(eq(lifeEventPeople.personId, personId), inArray(lifeEvents.status, ["confirmed", "proposed"])))
    .orderBy(asc(lifeEvents.approximateYear));
  const rels = await db
    .select({ rel: relationships, other: people })
    .from(relationships)
    .innerJoin(people, eq(people.id, relationships.relatedPersonId))
    .where(and(eq(relationships.personId, personId), ne(relationships.status, "rejected")));
  const inverse = await db
    .select({ rel: relationships, other: people })
    .from(relationships)
    .innerJoin(people, eq(people.id, relationships.personId))
    .where(and(eq(relationships.relatedPersonId, personId), ne(relationships.status, "rejected")));
  const threads = await db
    .select({ thread: storyThreads })
    .from(storyThreadPeople)
    .innerJoin(storyThreads, eq(storyThreads.id, storyThreadPeople.threadId))
    .where(eq(storyThreadPeople.personId, personId));
  const facts = await db
    .select()
    .from(memoryFacts)
    .where(and(eq(memoryFacts.subjectType, "person"), eq(memoryFacts.subjectId, personId), ne(memoryFacts.verificationStatus, "rejected")))
    .orderBy(desc(memoryFacts.createdAt));
  const sourceTurnIds = [person.sourceTurnId, ...facts.map((f) => f.sourceTurnId), ...events.map((e) => e.event.sourceTurnId)].filter((id): id is string => Boolean(id));
  const stories = sourceTurnIds.length
    ? await db
        .select({ id: interviewTurns.id, text: sql<string>`coalesce(${interviewTurns.correctedText}, ${interviewTurns.originalText})`, sessionId: interviewTurns.sessionId, createdAt: interviewTurns.createdAt })
        .from(interviewTurns)
        .where(inArray(interviewTurns.id, [...new Set(sourceTurnIds)]))
        .orderBy(asc(interviewTurns.createdAt))
    : [];
  return {
    person,
    events: events.map((e) => e.event),
    relationships: [
      ...rels.map((r) => ({ id: r.rel.id, type: r.rel.relationshipType, other: r.other, direction: "out" as const })),
      ...inverse.map((r) => ({ id: r.rel.id, type: r.rel.relationshipType, other: r.other, direction: "in" as const })),
    ],
    threads: threads.map((t) => t.thread),
    facts,
    stories,
  };
}

export async function updatePerson(
  db: DbClient,
  userId: string,
  projectId: string,
  personId: string,
  input: { preferredName: string; fullName: string | null; aliases: string[]; relationshipToNarrator: string | null; description: string | null; notes: string | null; birthDate: string | null; deathDate: string | null; datePrecision: Person["datePrecision"] },
): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "memory:write");
  const person = await db.query.people.findFirst({ where: and(eq(people.id, personId), eq(people.projectId, projectId)) });
  if (!person) throw new NotFoundError("We couldn't find that person.");
  if (!input.preferredName.trim()) throw new ValidationError("A name is required.");
  await db
    .update(people)
    .set({ ...input, preferredName: input.preferredName.trim(), status: "confirmed", userVerified: true })
    .where(eq(people.id, personId));
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "person.update", targetType: "person", targetId: personId });
}

/**
 * Merges `duplicateId` into `keepId`: links, facts and relationships move to
 * the kept person; the duplicate's name becomes an alias. Source turns are
 * untouched.
 */
export async function mergePeople(db: DbClient, userId: string, projectId: string, keepId: string, duplicateId: string): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "memory:write");
  if (keepId === duplicateId) throw new ValidationError("Choose two different people to merge.");
  const [keep, dup] = await Promise.all([
    db.query.people.findFirst({ where: and(eq(people.id, keepId), eq(people.projectId, projectId)) }),
    db.query.people.findFirst({ where: and(eq(people.id, duplicateId), eq(people.projectId, projectId)) }),
  ]);
  if (!keep || !dup) throw new NotFoundError("We couldn't find those people.");
  await db.transaction(async (tx) => {
    const aliases = Array.from(new Set([...keep.aliases, dup.preferredName, ...dup.aliases].filter((a) => a.toLowerCase() !== keep.preferredName.toLowerCase())));
    await tx.update(people).set({ aliases, userVerified: true, status: "confirmed", relationshipToNarrator: keep.relationshipToNarrator ?? dup.relationshipToNarrator, description: keep.description ?? dup.description }).where(eq(people.id, keepId));
    const dupEvents = await tx.select().from(lifeEventPeople).where(eq(lifeEventPeople.personId, duplicateId));
    for (const link of dupEvents) await tx.insert(lifeEventPeople).values({ eventId: link.eventId, personId: keepId }).onConflictDoNothing();
    await tx.delete(lifeEventPeople).where(eq(lifeEventPeople.personId, duplicateId));
    const dupThreads = await tx.select().from(storyThreadPeople).where(eq(storyThreadPeople.personId, duplicateId));
    for (const link of dupThreads) await tx.insert(storyThreadPeople).values({ threadId: link.threadId, personId: keepId }).onConflictDoNothing();
    await tx.delete(storyThreadPeople).where(eq(storyThreadPeople.personId, duplicateId));
    await tx.update(memoryFacts).set({ subjectId: keepId }).where(and(eq(memoryFacts.subjectType, "person"), eq(memoryFacts.subjectId, duplicateId)));
    await tx.update(memoryFacts).set({ verificationStatus: "confirmed" }).where(and(eq(memoryFacts.factType, "possible_duplicate"), or(eq(memoryFacts.subjectId, duplicateId), eq(memoryFacts.subjectId, keepId))));
    const dupRels = await tx.select().from(relationships).where(or(eq(relationships.personId, duplicateId), eq(relationships.relatedPersonId, duplicateId)));
    for (const r of dupRels) {
      const a = r.personId === duplicateId ? keepId : r.personId;
      const b = r.relatedPersonId === duplicateId ? keepId : r.relatedPersonId;
      await tx.delete(relationships).where(eq(relationships.id, r.id));
      if (a !== b) await tx.insert(relationships).values({ ...r, id: undefined, personId: a, relatedPersonId: b }).onConflictDoNothing();
    }
    await tx.update(people).set({ status: "merged", mergedIntoPersonId: keepId }).where(eq(people.id, duplicateId));
  });
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "person.merge", targetType: "person", targetId: keepId });
}

export async function setPersonStatus(db: DbClient, userId: string, projectId: string, personId: string, status: "confirmed" | "rejected"): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "memory:write");
  const res = await db.update(people).set({ status, userVerified: true }).where(and(eq(people.id, personId), eq(people.projectId, projectId))).returning({ id: people.id });
  if (res.length === 0) throw new NotFoundError("We couldn't find that person.");
  if (status === "rejected") {
    await db.update(memoryFacts).set({ verificationStatus: "rejected" }).where(and(eq(memoryFacts.subjectType, "person"), eq(memoryFacts.subjectId, personId), eq(memoryFacts.factType, "possible_duplicate")));
  }
  await recordAudit(db, { projectId, actorUserId: userId, actionType: `person.${status}`, targetType: "person", targetId: personId });
}

// ------------------------------------------------------------------ events

export async function listEvents(db: DbClient, projectId: string) {
  const rows = await db
    .select()
    .from(lifeEvents)
    .where(and(eq(lifeEvents.projectId, projectId), inArray(lifeEvents.status, ["confirmed", "proposed"])))
    .orderBy(asc(lifeEvents.sortKey), asc(lifeEvents.approximateYear), asc(lifeEvents.startDate), asc(lifeEvents.createdAt));
  const links = rows.length
    ? await db
        .select({ eventId: lifeEventPeople.eventId, personId: people.id, name: people.preferredName })
        .from(lifeEventPeople)
        .innerJoin(people, eq(people.id, lifeEventPeople.personId))
        .where(inArray(lifeEventPeople.eventId, rows.map((r) => r.id)))
    : [];
  const byEvent = new Map<string, Array<{ id: string; name: string }>>();
  for (const l of links) (byEvent.get(l.eventId) ?? byEvent.set(l.eventId, []).get(l.eventId)!).push({ id: l.personId, name: l.name });
  return rows.map((e) => ({ ...e, people: byEvent.get(e.id) ?? [] }));
}

export async function updateEvent(
  db: DbClient,
  userId: string,
  projectId: string,
  eventId: string,
  input: { title: string; description: string; category: string; approximateYear: number | null; approximateAge: number | null; startDate: string | null; endDate: string | null; datePrecision: LifeEvent["datePrecision"]; location: string | null; userNote: string | null },
): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "memory:write");
  if (!input.title.trim()) throw new ValidationError("A title is required.");
  const res = await db
    .update(lifeEvents)
    .set({ ...input, title: input.title.trim(), status: "confirmed", userVerified: true })
    .where(and(eq(lifeEvents.id, eventId), eq(lifeEvents.projectId, projectId)))
    .returning({ id: lifeEvents.id });
  if (res.length === 0) throw new NotFoundError("We couldn't find that event.");
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "event.update", targetType: "life_event", targetId: eventId });
}

export async function setEventStatus(db: DbClient, userId: string, projectId: string, eventId: string, status: "confirmed" | "rejected"): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "memory:write");
  const res = await db.update(lifeEvents).set({ status, userVerified: true }).where(and(eq(lifeEvents.id, eventId), eq(lifeEvents.projectId, projectId))).returning({ id: lifeEvents.id });
  if (res.length === 0) throw new NotFoundError("We couldn't find that event.");
}

export async function mergeEvents(db: DbClient, userId: string, projectId: string, keepId: string, duplicateId: string): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "memory:write");
  if (keepId === duplicateId) throw new ValidationError("Choose two different events to merge.");
  const [keep, dup] = await Promise.all([
    db.query.lifeEvents.findFirst({ where: and(eq(lifeEvents.id, keepId), eq(lifeEvents.projectId, projectId)) }),
    db.query.lifeEvents.findFirst({ where: and(eq(lifeEvents.id, duplicateId), eq(lifeEvents.projectId, projectId)) }),
  ]);
  if (!keep || !dup) throw new NotFoundError("We couldn't find those events.");
  await db.transaction(async (tx) => {
    const links = await tx.select().from(lifeEventPeople).where(eq(lifeEventPeople.eventId, duplicateId));
    for (const l of links) await tx.insert(lifeEventPeople).values({ eventId: keepId, personId: l.personId }).onConflictDoNothing();
    await tx.delete(lifeEventPeople).where(eq(lifeEventPeople.eventId, duplicateId));
    await tx
      .update(lifeEvents)
      .set({
        description: keep.description.length >= dup.description.length ? keep.description : `${keep.description}\n\n${dup.description}`.trim(),
        location: keep.location ?? dup.location,
        approximateYear: keep.approximateYear ?? dup.approximateYear,
        userVerified: true,
        status: "confirmed",
      })
      .where(eq(lifeEvents.id, keepId));
    await tx.update(memoryFacts).set({ subjectId: keepId }).where(and(eq(memoryFacts.subjectType, "event"), eq(memoryFacts.subjectId, duplicateId)));
    await tx.update(lifeEvents).set({ status: "merged", mergedIntoEventId: keepId }).where(eq(lifeEvents.id, duplicateId));
  });
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "event.merge", targetType: "life_event", targetId: keepId });
}

/** Persists an explicit order; events without a sort key fall back to dates. */
export async function reorderEvents(db: DbClient, userId: string, projectId: string, orderedIds: string[]): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "memory:write");
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i += 1) {
      await tx.update(lifeEvents).set({ sortKey: (i + 1) * 10 }).where(and(eq(lifeEvents.id, orderedIds[i]), eq(lifeEvents.projectId, projectId)));
    }
  });
}

// ------------------------------------------------------------------ review

export type ReviewItem = {
  id: string;
  kind: "fact" | "duplicate_person" | "proposed_person" | "proposed_event" | "conflict";
  statement: string;
  evidence: string | null;
  sourceTurnId: string | null;
  subjectId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

/** Everything waiting for the narrator's decision, oldest first. */
export async function listReviewItems(db: DbClient, projectId: string): Promise<ReviewItem[]> {
  const facts = await db
    .select()
    .from(memoryFacts)
    .where(and(eq(memoryFacts.projectId, projectId), inArray(memoryFacts.verificationStatus, ["needs_confirmation", "conflicting"])))
    .orderBy(asc(memoryFacts.createdAt))
    .limit(100);
  const proposedPeople = await db.select().from(people).where(and(eq(people.projectId, projectId), eq(people.status, "proposed")));
  const proposedEvents = await db.select().from(lifeEvents).where(and(eq(lifeEvents.projectId, projectId), eq(lifeEvents.status, "proposed")));
  const duplicateSubjects = new Set(facts.filter((f) => f.factType === "possible_duplicate").map((f) => f.subjectId));
  const items: ReviewItem[] = [];
  for (const f of facts) {
    items.push({
      id: f.id,
      kind: f.factType === "possible_duplicate" ? "duplicate_person" : f.verificationStatus === "conflicting" ? "conflict" : "fact",
      statement: f.statement,
      evidence: f.evidenceQuote,
      sourceTurnId: f.sourceTurnId,
      subjectId: f.subjectId,
      payload: f.factValue,
      createdAt: f.createdAt,
    });
  }
  for (const p of proposedPeople) {
    if (duplicateSubjects.has(p.id)) continue;
    items.push({ id: p.id, kind: "proposed_person", statement: `Add ${p.preferredName}${p.relationshipToNarrator ? ` (${p.relationshipToNarrator})` : ""} to the people in this story?`, evidence: p.description, sourceTurnId: p.sourceTurnId, subjectId: p.id, payload: {}, createdAt: p.createdAt });
  }
  for (const e of proposedEvents) {
    items.push({ id: e.id, kind: "proposed_event", statement: `Add "${e.title}" to the timeline?`, evidence: e.description, sourceTurnId: e.sourceTurnId, subjectId: e.id, payload: {}, createdAt: e.createdAt });
  }
  return items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function resolveFact(db: DbClient, userId: string, projectId: string, factId: string, decision: "confirm" | "reject"): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "memory:write");
  const fact = await db.query.memoryFacts.findFirst({ where: and(eq(memoryFacts.id, factId), eq(memoryFacts.projectId, projectId)) });
  if (!fact) throw new NotFoundError("We couldn't find that item.");
  await db.transaction(async (tx) => {
    await tx.update(memoryFacts).set({ verificationStatus: decision === "confirm" ? "confirmed" : "rejected" }).where(eq(memoryFacts.id, factId));
    if (decision === "confirm" && fact.conflictsWithFactId) {
      // The newer statement wins; the older one is kept but superseded.
      await tx.update(memoryFacts).set({ verificationStatus: "rejected" }).where(eq(memoryFacts.id, fact.conflictsWithFactId));
    }
    if (decision === "confirm" && fact.factType === "relationship_to_narrator" && fact.subjectId) {
      const value = (fact.factValue as { value?: string }).value;
      if (value) await tx.update(people).set({ relationshipToNarrator: value, userVerified: true }).where(eq(people.id, fact.subjectId));
    }
    if (decision === "confirm" && fact.factType === "event_date" && fact.subjectId) {
      const year = (fact.factValue as { year?: number }).year;
      if (year) await tx.update(lifeEvents).set({ approximateYear: year, userVerified: true }).where(eq(lifeEvents.id, fact.subjectId));
    }
  });
  await recordAudit(db, { projectId, actorUserId: userId, actionType: `fact.${decision}`, targetType: "memory_fact", targetId: factId });
}

export async function countReviewItems(db: DbClient, projectId: string): Promise<number> {
  return (await listReviewItems(db, projectId)).length;
}

// ------------------------------------------------------------------ threads

export async function listThreads(db: DbClient, projectId: string) {
  return db
    .select()
    .from(storyThreads)
    .where(and(eq(storyThreads.projectId, projectId), ne(storyThreads.status, "excluded")))
    .orderBy(desc(storyThreads.importance), asc(storyThreads.status), desc(storyThreads.updatedAt));
}

export async function setThreadStatus(db: DbClient, userId: string, projectId: string, threadId: string, status: "open" | "deferred" | "excluded" | "covered"): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "memory:write");
  const res = await db.update(storyThreads).set({ status }).where(and(eq(storyThreads.id, threadId), eq(storyThreads.projectId, projectId))).returning({ id: storyThreads.id });
  if (res.length === 0) throw new NotFoundError("We couldn't find that thread.");
}
