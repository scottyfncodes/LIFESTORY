import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import {
  interviewTurns,
  lifeEventPeople,
  lifeEvents,
  memoirProjects,
  memoryFacts,
  people,
  relationships,
  storyThreadPeople,
  storyThreadSources,
  storyThreads,
  type TurnMetadata,
} from "@/db/schema";
import { AiPausedError } from "../errors";
import { getAiProvider, withAiTelemetry } from "../ai";
import type { ExtractionResult } from "../ai/types";
import { enqueueJob } from "../jobs";
import { log } from "../logger";
import {
  classifyFact,
  factKey,
  matchEvent,
  matchPerson,
  normalizeName,
  resolveDates,
  valuesConflict,
  type KnownPerson,
} from "./reconcile";

/**
 * Processes one narrator answer: extracts candidate memory with the AI
 * provider, reconciles it against existing records, and persists the
 * results. The answer itself is never modified. Without an AI provider the
 * turn is marked as processed with reason "no_ai" so the UI stays honest.
 */
export async function processTurn(db: DbClient, turnId: string): Promise<Record<string, unknown>> {
  const turn = await db.query.interviewTurns.findFirst({ where: eq(interviewTurns.id, turnId) });
  if (!turn || turn.speakerType !== "narrator") return { skipped: "not_an_answer" };
  const meta = turn.metadata as TurnMetadata;
  if (meta.skipped) return { skipped: "skipped_question" };
  const project = await db.query.memoirProjects.findFirst({ where: eq(memoirProjects.id, turn.projectId) });
  if (!project || project.deletedAt) return { skipped: "missing_project" };
  const provider = getAiProvider();
  if (!provider) {
    await setProcessing(db, turn.id, meta, "processed", "no_ai");
    return { processed: false, reason: "no_ai" };
  }

  const answer = (turn.correctedText ?? turn.originalText).trim();
  if (!answer) return { skipped: "empty" };
  const question = await db.query.interviewTurns.findFirst({
    where: and(eq(interviewTurns.sessionId, turn.sessionId), eq(interviewTurns.speakerType, "interviewer"), sql`${interviewTurns.sequenceNumber} < ${turn.sequenceNumber}`),
    orderBy: desc(interviewTurns.sequenceNumber),
  });

  // Re-processing (after a correction) drops what this turn previously
  // produced unless the narrator has verified it.
  await clearUnverifiedExtractions(db, turn.id);

  const knownPeople = await db.select().from(people).where(and(eq(people.projectId, project.id), inArray(people.status, ["confirmed", "proposed"])));
  const knownEvents = await db.select().from(lifeEvents).where(and(eq(lifeEvents.projectId, project.id), inArray(lifeEvents.status, ["confirmed", "proposed"])));
  const openThreads = await db.select().from(storyThreads).where(and(eq(storyThreads.projectId, project.id), inArray(storyThreads.status, ["open", "in_progress"])));

  let extraction: ExtractionResult;
  try {
    const result = await withAiTelemetry(
      db,
      { projectId: project.id, userId: (turn.metadata as { userId?: string }).userId ?? null, operation: "extract_memory", provider: provider.name },
      () =>
        provider.extractMemory({
          narratorName: project.narratorName,
          topicsToAvoid: project.topicsToAvoid,
          question: question?.originalText ?? null,
          answer,
          knownPeople: knownPeople.map((p) => ({ name: p.preferredName, aliases: p.aliases, relationship: p.relationshipToNarrator })),
          knownEvents: knownEvents.map((e) => ({ title: e.title, year: e.approximateYear })),
          openThreads: openThreads.map((t) => ({ title: t.title })),
        }),
    );
    extraction = result.data;
  } catch (error) {
    // Paused for the day: the answer is saved and the job runs again tomorrow.
    if (error instanceof AiPausedError) await setProcessing(db, turn.id, meta, "pending", "ai_paused");
    else await setProcessing(db, turn.id, meta, "failed", "extraction_failed");
    throw error;
  }

  const stats = await db.transaction(async (tx) => {
    const counters = { people: 0, events: 0, facts: 0, relationships: 0, threads: 0, flagged: 0 };
    const known: KnownPerson[] = knownPeople.map((p) => ({ id: p.id, preferredName: p.preferredName, fullName: p.fullName, aliases: p.aliases, relationshipToNarrator: p.relationshipToNarrator }));
    const personIdByName = new Map<string, string>();

    // ---- people
    for (const candidate of extraction.people) {
      if (normalizeName(candidate.name) === normalizeName(project.narratorName)) continue;
      const match = matchPerson(candidate.name, known);
      if (match.kind === "exact") {
        personIdByName.set(normalizeName(candidate.name), match.person.id);
        const updates: Partial<typeof people.$inferInsert> = {};
        const newAliases = candidate.aliases.map((a) => a.trim()).filter((a) => a && !match.person.aliases.map(normalizeName).includes(normalizeName(a)) && normalizeName(a) !== normalizeName(match.person.preferredName));
        if (newAliases.length) updates.aliases = [...match.person.aliases, ...newAliases];
        if (candidate.relationshipToNarrator && !match.person.relationshipToNarrator) updates.relationshipToNarrator = candidate.relationshipToNarrator;
        if (candidate.relationshipToNarrator && match.person.relationshipToNarrator && normalizeName(candidate.relationshipToNarrator) !== normalizeName(match.person.relationshipToNarrator)) {
          await tx.insert(memoryFacts).values({
            projectId: project.id,
            subjectType: "person",
            subjectId: match.person.id,
            factType: "relationship_to_narrator",
            factValue: { value: candidate.relationshipToNarrator, previous: match.person.relationshipToNarrator },
            statement: `${match.person.preferredName} was described as "${candidate.relationshipToNarrator}" but is recorded as "${match.person.relationshipToNarrator}".`,
            confidence: "medium",
            verificationStatus: "conflicting",
            sensitivity: "normal",
            evidenceQuote: candidate.evidenceQuote,
            sourceTurnId: turn.id,
          });
          counters.flagged += 1;
        }
        if (Object.keys(updates).length) await tx.update(people).set(updates).where(eq(people.id, match.person.id));
        continue;
      }
      const [created] = await tx
        .insert(people)
        .values({
          projectId: project.id,
          preferredName: candidate.name.trim(),
          aliases: candidate.aliases.map((a) => a.trim()).filter(Boolean),
          description: candidate.description,
          relationshipToNarrator: candidate.relationshipToNarrator,
          status: match.kind === "possible" ? "proposed" : "confirmed",
          sourceTurnId: turn.id,
        })
        .returning();
      counters.people += 1;
      known.push({ id: created.id, preferredName: created.preferredName, fullName: null, aliases: created.aliases, relationshipToNarrator: created.relationshipToNarrator });
      personIdByName.set(normalizeName(candidate.name), created.id);
      if (match.kind === "possible") {
        await tx.insert(memoryFacts).values({
          projectId: project.id,
          subjectType: "person",
          subjectId: created.id,
          factType: "possible_duplicate",
          factValue: { otherPersonId: match.person.id, otherPersonName: match.person.preferredName },
          statement: `Is "${candidate.name}" the same person as "${match.person.preferredName}"?`,
          confidence: "low",
          verificationStatus: "needs_confirmation",
          sensitivity: "normal",
          evidenceQuote: candidate.evidenceQuote,
          sourceTurnId: turn.id,
        });
        counters.flagged += 1;
      }
    }

    const resolvePersonId = (name: string): string | null => {
      const direct = personIdByName.get(normalizeName(name));
      if (direct) return direct;
      const match = matchPerson(name, known);
      return match.kind === "exact" ? match.person.id : null;
    };

    // ---- events
    const knownEventList = knownEvents.map((e) => ({ id: e.id, title: e.title, approximateYear: e.approximateYear, category: e.category }));
    for (const candidate of extraction.events) {
      const dates = resolveDates(candidate);
      const match = matchEvent({ title: candidate.title, year: dates.approximateYear, category: candidate.category }, knownEventList);
      if (match.kind === "same") {
        const existing = knownEvents.find((e) => e.id === match.event.id)!;
        const updates: Partial<typeof lifeEvents.$inferInsert> = {};
        if (!existing.approximateYear && dates.approximateYear) {
          updates.approximateYear = dates.approximateYear;
          updates.datePrecision = dates.datePrecision;
        }
        if (!existing.location && candidate.location) updates.location = candidate.location;
        if (!existing.userVerified && candidate.description.length > existing.description.length) updates.description = candidate.description;
        if (Object.keys(updates).length) await tx.update(lifeEvents).set(updates).where(eq(lifeEvents.id, existing.id));
        for (const name of candidate.peopleNames) {
          const pid = resolvePersonId(name);
          if (pid) await tx.insert(lifeEventPeople).values({ eventId: existing.id, personId: pid }).onConflictDoNothing();
        }
        continue;
      }
      if (match.kind === "conflict") {
        await tx.insert(memoryFacts).values({
          projectId: project.id,
          subjectType: "event",
          subjectId: match.event.id,
          factType: "event_date",
          factValue: { year: dates.approximateYear, previousYear: match.event.approximateYear, title: candidate.title },
          statement: `"${match.event.title}" was placed around ${dates.approximateYear} this time, but earlier around ${match.event.approximateYear}.`,
          confidence: candidate.confidence,
          verificationStatus: "conflicting",
          sensitivity: "normal",
          evidenceQuote: candidate.evidenceQuote,
          sourceTurnId: turn.id,
        });
        counters.flagged += 1;
        continue;
      }
      const [created] = await tx
        .insert(lifeEvents)
        .values({
          projectId: project.id,
          title: candidate.title.trim(),
          description: candidate.description,
          category: candidate.category,
          startDate: dates.startDate,
          endDate: dates.endDate,
          approximateYear: dates.approximateYear,
          approximateAge: dates.approximateAge,
          datePrecision: dates.datePrecision,
          location: candidate.location,
          confidence: candidate.confidence,
          status: candidate.confidence === "low" ? "proposed" : "confirmed",
          sourceTurnId: turn.id,
        })
        .returning();
      counters.events += 1;
      knownEventList.push({ id: created.id, title: created.title, approximateYear: created.approximateYear, category: created.category });
      for (const name of candidate.peopleNames) {
        const pid = resolvePersonId(name);
        if (pid) await tx.insert(lifeEventPeople).values({ eventId: created.id, personId: pid }).onConflictDoNothing();
      }
    }

    // ---- facts
    const existingFacts = await tx
      .select({ id: memoryFacts.id, factType: memoryFacts.factType, factValue: memoryFacts.factValue, statement: memoryFacts.statement, status: memoryFacts.verificationStatus })
      .from(memoryFacts)
      .where(and(eq(memoryFacts.projectId, project.id), inArray(memoryFacts.verificationStatus, ["auto_accepted", "confirmed"]), ne(memoryFacts.sourceTurnId, turn.id)));
    const byKey = new Map<string, (typeof existingFacts)[number]>();
    for (const f of existingFacts) {
      const subject = (f.factValue as { subject?: string }).subject ?? null;
      byKey.set(factKey(f.factType, subject), f);
    }
    for (const candidate of extraction.facts) {
      const key = factKey(candidate.factType, candidate.subjectName);
      const prior = byKey.get(key);
      const priorValue = prior ? String((prior.factValue as { value?: string }).value ?? "") : "";
      const conflicts = Boolean(prior && candidate.factType !== "statement" && valuesConflict(priorValue, candidate.value));
      const status = classifyFact(candidate, conflicts);
      const subjectPersonId = candidate.subjectName ? resolvePersonId(candidate.subjectName) : null;
      await tx.insert(memoryFacts).values({
        projectId: project.id,
        subjectType: subjectPersonId ? "person" : "narrator",
        subjectId: subjectPersonId,
        factType: candidate.factType,
        factValue: { value: candidate.value, subject: candidate.subjectName, uncertain: candidate.isUncertainRecollection },
        statement: candidate.statement,
        confidence: candidate.confidence,
        verificationStatus: status,
        sensitivity: candidate.sensitivity,
        evidenceQuote: candidate.evidenceQuote,
        conflictsWithFactId: conflicts ? prior!.id : null,
        sourceTurnId: turn.id,
      });
      counters.facts += 1;
      if (status !== "auto_accepted") counters.flagged += 1;
    }

    // ---- relationships between people
    for (const rel of extraction.relationships) {
      const a = resolvePersonId(rel.personName);
      const b = resolvePersonId(rel.relatedPersonName);
      if (!a || !b || a === b) continue;
      await tx
        .insert(relationships)
        .values({ projectId: project.id, personId: a, relatedPersonId: b, relationshipType: rel.relationshipType.toLowerCase().trim(), sourceTurnId: turn.id, confidence: "medium", status: "confirmed" })
        .onConflictDoNothing();
      counters.relationships += 1;
    }

    // ---- threads
    const threadTitles = new Map(openThreads.map((t) => [normalizeName(t.title), t]));
    for (const title of extraction.coveredThreadTitles) {
      const t = threadTitles.get(normalizeName(title));
      if (t) {
        await tx.update(storyThreads).set({ status: "covered" }).where(eq(storyThreads.id, t.id));
        await tx.insert(storyThreadSources).values({ threadId: t.id, turnId: turn.id }).onConflictDoNothing();
      }
    }
    if (meta.threadId) {
      await tx.insert(storyThreadSources).values({ threadId: meta.threadId, turnId: turn.id }).onConflictDoNothing();
      if (extraction.narratorAskedToStopTopic) {
        await tx.update(storyThreads).set({ status: "excluded" }).where(eq(storyThreads.id, meta.threadId));
      }
    }
    for (const candidate of extraction.newThreads) {
      if (threadTitles.has(normalizeName(candidate.title))) continue;
      if (project.topicsToAvoid.some((t) => normalizeName(candidate.title).includes(normalizeName(t)))) continue;
      const [thread] = await tx
        .insert(storyThreads)
        .values({
          projectId: project.id,
          title: candidate.title.trim(),
          summary: candidate.summary,
          suggestedFollowUp: candidate.suggestedFollowUp,
          importance: candidate.importance,
          coverageArea: candidate.coverageArea,
          status: "open",
        })
        .returning();
      await tx.insert(storyThreadSources).values({ threadId: thread.id, turnId: turn.id }).onConflictDoNothing();
      for (const p of extraction.people) {
        const pid = resolvePersonId(p.name);
        if (pid && (normalizeName(candidate.title).includes(normalizeName(p.name)) || normalizeName(candidate.summary).includes(normalizeName(p.name)))) {
          await tx.insert(storyThreadPeople).values({ threadId: thread.id, personId: pid }).onConflictDoNothing();
        }
      }
      counters.threads += 1;
    }

    const coverageArea = meta.coverageArea ?? extraction.coverageAreasTouched[0] ?? null;
    await tx
      .update(interviewTurns)
      .set({ metadata: { ...meta, coverageArea, processingStatus: "processed", processingError: null } })
      .where(eq(interviewTurns.id, turn.id));
    return counters;
  });

  // Refresh the biography summary every few answers.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(interviewTurns)
    .where(and(eq(interviewTurns.projectId, project.id), eq(interviewTurns.speakerType, "narrator"), sql`${interviewTurns.metadata}->>'processingStatus' = 'processed'`));
  const bucket = Math.floor(Number(count) / 3);
  await enqueueJob(db, { projectId: project.id, jobType: "refresh_summary", idempotencyKey: `refresh_summary:${project.id}:${bucket}`, payload: {} });
  await markChaptersNeedingUpdate(db, project.id, turn.id);

  log.info("memory.turn_processed", { turnId: turn.id, ...stats });
  return { processed: true, ...stats };
}

async function setProcessing(db: DbClient, turnId: string, meta: TurnMetadata, status: TurnMetadata["processingStatus"], error: string | null): Promise<void> {
  await db
    .update(interviewTurns)
    .set({ metadata: { ...meta, processingStatus: status, processingError: error } })
    .where(eq(interviewTurns.id, turnId));
}

/** Removes system-generated records sourced from this turn that the narrator has not verified. */
async function clearUnverifiedExtractions(db: DbClient, turnId: string): Promise<void> {
  await db.delete(memoryFacts).where(and(eq(memoryFacts.sourceTurnId, turnId), ne(memoryFacts.verificationStatus, "confirmed")));
  await db.delete(relationships).where(eq(relationships.sourceTurnId, turnId));
  await db.delete(lifeEvents).where(and(eq(lifeEvents.sourceTurnId, turnId), eq(lifeEvents.userVerified, false)));
  await db.delete(people).where(and(eq(people.sourceTurnId, turnId), eq(people.userVerified, false)));
}

/** Chapters built from this answer may now be out of date; flag, never rewrite. */
async function markChaptersNeedingUpdate(db: DbClient, projectId: string, turnId: string): Promise<void> {
  await db.execute(sql`
    update manuscript_chapters c set needs_update = true, needs_update_reason = 'An answer this chapter draws on was added or corrected.'
    where c.project_id = ${projectId}
      and c.current_revision_id in (select revision_id from manuscript_sources where source_turn_id = ${turnId})
  `);
}

/** Regenerates the bounded biography summary from current memory. */
export async function refreshSummary(db: DbClient, projectId: string): Promise<Record<string, unknown>> {
  const provider = getAiProvider();
  const project = await db.query.memoirProjects.findFirst({ where: eq(memoirProjects.id, projectId) });
  if (!project || !provider) return { skipped: provider ? "missing_project" : "no_ai" };
  const facts = await db
    .select({ statement: memoryFacts.statement, status: memoryFacts.verificationStatus })
    .from(memoryFacts)
    .where(and(eq(memoryFacts.projectId, projectId), inArray(memoryFacts.verificationStatus, ["auto_accepted", "confirmed", "needs_confirmation"]), eq(memoryFacts.sensitivity, "normal")))
    .orderBy(asc(memoryFacts.createdAt))
    .limit(120);
  const events = await db
    .select()
    .from(lifeEvents)
    .where(and(eq(lifeEvents.projectId, projectId), eq(lifeEvents.status, "confirmed")))
    .orderBy(asc(lifeEvents.approximateYear))
    .limit(60);
  const persons = await db.select().from(people).where(and(eq(people.projectId, projectId), eq(people.status, "confirmed"), eq(people.isNarrator, false))).limit(60);
  const recent = await db
    .select({ text: sql<string>`coalesce(${interviewTurns.correctedText}, ${interviewTurns.originalText})` })
    .from(interviewTurns)
    .where(and(eq(interviewTurns.projectId, projectId), eq(interviewTurns.speakerType, "narrator")))
    .orderBy(desc(interviewTurns.createdAt))
    .limit(6);
  const { data } = await withAiTelemetry(db, { projectId, userId: null, operation: "summarize_biography", provider: provider.name }, () =>
    provider.summarizeBiography({
      narratorName: project.narratorName,
      previousSummary: project.biographySummary,
      facts: facts.map((f) => (f.status === "needs_confirmation" ? `${f.statement} (uncertain)` : f.statement)),
      events: events.map((e) => ({ title: e.title, when: e.approximateYear ? `${e.datePrecision === "approximate" || e.datePrecision === "decade" ? "around " : ""}${e.approximateYear}` : null, description: e.description })),
      people: persons.map((p) => ({ name: p.preferredName, relationship: p.relationshipToNarrator, description: p.description })),
      recentAnswers: recent.map((r) => r.text).reverse(),
    }),
  );
  await db.update(memoirProjects).set({ biographySummary: data.summary, biographySummaryUpdatedAt: new Date() }).where(eq(memoirProjects.id, projectId));
  return { refreshed: true, chars: data.summary.length };
}
