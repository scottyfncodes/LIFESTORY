import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import {
  interviewTurns,
  manuscriptChapters,
  manuscriptRevisions,
  manuscriptSources,
  memoryFacts,
  memoirProjects,
  processingJobs,
  type RevisionFlag,
} from "@/db/schema";
import { getAiProvider, requireAiProvider, withAiTelemetry } from "../ai";
import { PROMPT_VERSION } from "../ai/prompts/v1";
import { recordAudit } from "../audit";
import { requireProjectAccess } from "../authz";
import { AiPausedError, AppError, NotFoundError, ValidationError } from "../errors";
import { isGlobalAiBudgetSpent, nextUtcMidnight } from "../rate-limit";
import { enqueueJob } from "../jobs";

export type Chapter = typeof manuscriptChapters.$inferSelect;
export type Revision = typeof manuscriptRevisions.$inferSelect;

export const MAX_CHAPTER_BODY = 60_000;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function splitParagraphs(body: string): string[] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// ----------------------------------------------------------------- reading

export async function listChapters(db: DbClient, projectId: string) {
  const chapters = await db.select().from(manuscriptChapters).where(eq(manuscriptChapters.projectId, projectId)).orderBy(asc(manuscriptChapters.chapterOrder));
  const revisionIds = chapters.map((c) => c.currentRevisionId).filter((id): id is string => Boolean(id));
  const revisions = revisionIds.length ? await db.select().from(manuscriptRevisions).where(inArray(manuscriptRevisions.id, revisionIds)) : [];
  const byId = new Map(revisions.map((r) => [r.id, r]));
  return chapters.map((c) => {
    const rev = c.currentRevisionId ? byId.get(c.currentRevisionId) : undefined;
    return {
      ...c,
      words: rev ? wordCount(rev.body) : 0,
      flagCount: rev ? rev.flags.length : 0,
      revisionNumber: rev?.revisionNumber ?? 0,
      generationType: rev?.generationType ?? null,
      excerpt: rev ? splitParagraphs(rev.body)[0]?.slice(0, 180) ?? "" : "",
    };
  });
}

export async function getChapterDetail(db: DbClient, projectId: string, chapterId: string) {
  const chapter = await db.query.manuscriptChapters.findFirst({ where: and(eq(manuscriptChapters.id, chapterId), eq(manuscriptChapters.projectId, projectId)) });
  if (!chapter) throw new NotFoundError("We couldn't find that chapter.");
  const revisions = await db.select().from(manuscriptRevisions).where(eq(manuscriptRevisions.chapterId, chapterId)).orderBy(desc(manuscriptRevisions.revisionNumber));
  const current = revisions.find((r) => r.id === chapter.currentRevisionId) ?? null;
  const sourceRows = current
    ? await db
        .select({ turnId: manuscriptSources.sourceTurnId, relationship: manuscriptSources.relationshipType, text: sql<string>`coalesce(${interviewTurns.correctedText}, ${interviewTurns.originalText})`, sessionId: interviewTurns.sessionId, createdAt: interviewTurns.createdAt })
        .from(manuscriptSources)
        .innerJoin(interviewTurns, eq(interviewTurns.id, manuscriptSources.sourceTurnId))
        .where(eq(manuscriptSources.revisionId, current.id))
    : [];
  const plannedIds = chapter.plannedSourceTurnIds.filter((id) => !sourceRows.some((s) => s.turnId === id));
  const planned = plannedIds.length
    ? await db
        .select({ turnId: interviewTurns.id, text: sql<string>`coalesce(${interviewTurns.correctedText}, ${interviewTurns.originalText})`, sessionId: interviewTurns.sessionId, createdAt: interviewTurns.createdAt })
        .from(interviewTurns)
        .where(inArray(interviewTurns.id, plannedIds))
    : [];
  const latestJob = await db.query.processingJobs.findFirst({
    where: and(eq(processingJobs.projectId, projectId), eq(processingJobs.jobType, "draft_chapter"), sql`${processingJobs.payload}->>'chapterId' = ${chapterId}`),
    orderBy: desc(processingJobs.createdAt),
  });
  return {
    chapter,
    current,
    revisions: revisions.map((r) => ({ id: r.id, revisionNumber: r.revisionNumber, generationType: r.generationType, createdAt: r.createdAt, words: wordCount(r.body), flagCount: r.flags.length })),
    sources: sourceRows,
    plannedSources: planned,
    job: latestJob ? { id: latestJob.id, status: latestJob.status, error: latestJob.lastErrorMessage, updatedAt: latestJob.updatedAt } : null,
  };
}

export async function getManuscript(db: DbClient, projectId: string) {
  const project = await db.query.memoirProjects.findFirst({ where: eq(memoirProjects.id, projectId) });
  if (!project) throw new NotFoundError("We couldn't find that memoir project.");
  const chapters = await listChapters(db, projectId);
  const revisionIds = chapters.map((c) => c.currentRevisionId).filter((id): id is string => Boolean(id));
  const revisions = revisionIds.length ? await db.select().from(manuscriptRevisions).where(inArray(manuscriptRevisions.id, revisionIds)) : [];
  const byId = new Map(revisions.map((r) => [r.id, r]));
  return {
    project,
    chapters: chapters.map((c) => ({ id: c.id, title: c.title, subtitle: c.subtitle, order: c.chapterOrder, body: c.currentRevisionId ? (byId.get(c.currentRevisionId)?.body ?? "") : "", flags: c.currentRevisionId ? (byId.get(c.currentRevisionId)?.flags ?? []) : [] })),
  };
}

// --------------------------------------------------------------- structure

export async function createChapter(db: DbClient, userId: string, projectId: string, title: string, focus: string | null): Promise<Chapter> {
  await requireProjectAccess(db, userId, projectId, "manuscript:write");
  const t = title.trim();
  if (!t) throw new ValidationError("A chapter needs a title.");
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${manuscriptChapters.chapterOrder}), 0)` }).from(manuscriptChapters).where(eq(manuscriptChapters.projectId, projectId));
  const [chapter] = await db.insert(manuscriptChapters).values({ projectId, title: t, focus, chapterOrder: Number(max) + 1 }).returning();
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "chapter.create", targetType: "manuscript_chapter", targetId: chapter.id });
  return chapter;
}

export async function updateChapterMeta(db: DbClient, userId: string, projectId: string, chapterId: string, input: { title: string; subtitle: string | null; focus: string | null }): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "manuscript:write");
  if (!input.title.trim()) throw new ValidationError("A chapter needs a title.");
  const res = await db.update(manuscriptChapters).set({ title: input.title.trim(), subtitle: input.subtitle, focus: input.focus }).where(and(eq(manuscriptChapters.id, chapterId), eq(manuscriptChapters.projectId, projectId))).returning({ id: manuscriptChapters.id });
  if (!res.length) throw new NotFoundError("We couldn't find that chapter.");
}

export async function reorderChapters(db: DbClient, userId: string, projectId: string, orderedIds: string[]): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "manuscript:write");
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i += 1) {
      await tx.update(manuscriptChapters).set({ chapterOrder: i + 1 }).where(and(eq(manuscriptChapters.id, orderedIds[i]), eq(manuscriptChapters.projectId, projectId)));
    }
  });
}

export async function deleteChapter(db: DbClient, userId: string, projectId: string, chapterId: string): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "manuscript:write");
  const res = await db.delete(manuscriptChapters).where(and(eq(manuscriptChapters.id, chapterId), eq(manuscriptChapters.projectId, projectId))).returning({ id: manuscriptChapters.id });
  if (!res.length) throw new NotFoundError("We couldn't find that chapter.");
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "chapter.delete", targetType: "manuscript_chapter", targetId: chapterId });
}

/** Attaches planned source answers to a chapter (what the next draft will draw on). */
export async function setChapterSources(db: DbClient, userId: string, projectId: string, chapterId: string, turnIds: string[]): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "manuscript:write");
  const valid = turnIds.length ? await db.select({ id: interviewTurns.id }).from(interviewTurns).where(and(eq(interviewTurns.projectId, projectId), inArray(interviewTurns.id, turnIds), eq(interviewTurns.speakerType, "narrator"))) : [];
  await db.update(manuscriptChapters).set({ plannedSourceTurnIds: valid.map((v) => v.id) }).where(and(eq(manuscriptChapters.id, chapterId), eq(manuscriptChapters.projectId, projectId)));
}

// ----------------------------------------------------------------- answers

export async function listAnswers(db: DbClient, projectId: string) {
  const turns = await db
    .select()
    .from(interviewTurns)
    .where(and(eq(interviewTurns.projectId, projectId), sql`coalesce((${interviewTurns.metadata}->>'skipped')::boolean, false) = false`))
    .orderBy(asc(interviewTurns.createdAt), asc(interviewTurns.sequenceNumber));
  const out: Array<{ id: string; question: string | null; text: string; createdAt: Date; sessionId: string }> = [];
  let lastQuestion: string | null = null;
  for (const t of turns) {
    if (t.speakerType === "interviewer") lastQuestion = t.originalText;
    else if (t.speakerType === "narrator") {
      const text = (t.correctedText ?? t.originalText).trim();
      if (text) out.push({ id: t.id, question: lastQuestion, text, createdAt: t.createdAt, sessionId: t.sessionId });
    }
  }
  return out;
}

// ---------------------------------------------------------------- planning

/** Proposes chapters from the saved answers. Existing chapters are kept and refreshed, never removed. */
export async function proposeChapters(db: DbClient, userId: string, projectId: string): Promise<{ created: number; updated: number }> {
  const access = await requireProjectAccess(db, userId, projectId, "manuscript:write");
  const provider = requireAiProvider();
  const answers = await listAnswers(db, projectId);
  if (answers.length === 0) throw new AppError("no_answers", "There are no saved answers to build chapters from yet.", 409);
  const existing = await db.select().from(manuscriptChapters).where(eq(manuscriptChapters.projectId, projectId)).orderBy(asc(manuscriptChapters.chapterOrder));
  const { data } = await withAiTelemetry(db, { projectId, userId, operation: "plan_chapters", provider: provider.name }, () =>
    provider.planChapters({
      narratorName: access.project.narratorName,
      intendedScope: access.project.intendedScope,
      writingStyle: access.project.writingStyle,
      answers: answers.map((a) => ({ id: a.id, question: a.question, text: a.text })),
      existingChapters: existing.map((c) => ({ id: c.id, title: c.title, focus: c.focus })),
    }),
  );
  const validIds = new Set(answers.map((a) => a.id));
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    let order = existing.length;
    for (const planned of data.chapters) {
      const sources = planned.sourceTurnIds.filter((id) => validIds.has(id));
      if (sources.length === 0) continue;
      const match = existing.find((c) => c.title.trim().toLowerCase() === planned.title.trim().toLowerCase());
      if (match) {
        const merged = Array.from(new Set([...match.plannedSourceTurnIds, ...sources]));
        await tx.update(manuscriptChapters).set({ plannedSourceTurnIds: merged, focus: match.focus ?? planned.focus }).where(eq(manuscriptChapters.id, match.id));
        updated += 1;
      } else {
        order += 1;
        await tx.insert(manuscriptChapters).values({ projectId, title: planned.title.trim(), focus: planned.focus || null, chapterOrder: order, plannedSourceTurnIds: sources });
        created += 1;
      }
    }
  });
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "chapters.propose", targetType: "memoir_project", targetId: projectId });
  return { created, updated };
}

// ---------------------------------------------------------------- drafting

export async function requestDraft(db: DbClient, userId: string, projectId: string, chapterId: string, instructions: string | null): Promise<{ jobId: string | null }> {
  await requireProjectAccess(db, userId, projectId, "manuscript:write");
  if (!getAiProvider()) throw new AppError("not_configured", "Drafting needs an AI provider, which isn't configured on this server.", 503);
  // Say so now rather than after the job is picked up.
  if (await isGlobalAiBudgetSpent(db)) throw new AiPausedError(nextUtcMidnight(new Date()));
  const chapter = await db.query.manuscriptChapters.findFirst({ where: and(eq(manuscriptChapters.id, chapterId), eq(manuscriptChapters.projectId, projectId)) });
  if (!chapter) throw new NotFoundError("We couldn't find that chapter.");
  const trimmed = instructions?.trim().slice(0, 1000) || null;
  const key = `draft_chapter:${chapterId}:${Date.now()}`;
  const jobId = await enqueueJob(db, { projectId, jobType: "draft_chapter", idempotencyKey: key, payload: { chapterId, userId, instructions: trimmed }, maxAttempts: 2 });
  return { jobId };
}

/** Job handler: produces a new immutable revision from the chapter's sources. */
export async function runDraft(db: DbClient, projectId: string, chapterId: string, userId: string | null, instructions: string | null): Promise<Record<string, unknown>> {
  const provider = requireAiProvider();
  const project = await db.query.memoirProjects.findFirst({ where: eq(memoirProjects.id, projectId) });
  const chapter = await db.query.manuscriptChapters.findFirst({ where: and(eq(manuscriptChapters.id, chapterId), eq(manuscriptChapters.projectId, projectId)) });
  if (!project || !chapter) return { skipped: "missing" };
  const current = chapter.currentRevisionId ? await db.query.manuscriptRevisions.findFirst({ where: eq(manuscriptRevisions.id, chapter.currentRevisionId) }) : null;
  const currentSourceIds = current ? (await db.select({ id: manuscriptSources.sourceTurnId }).from(manuscriptSources).where(eq(manuscriptSources.revisionId, current.id))).map((s) => s.id) : [];
  const sourceIds = Array.from(new Set([...chapter.plannedSourceTurnIds, ...currentSourceIds]));
  const all = await listAnswers(db, projectId);
  const sources = all.filter((a) => sourceIds.includes(a.id));
  if (sources.length === 0) throw new AppError("no_sources", "This chapter has no source answers yet. Choose the answers it should draw on first.", 409);
  const facts = await db
    .select({ statement: memoryFacts.statement })
    .from(memoryFacts)
    .where(and(eq(memoryFacts.projectId, projectId), inArray(memoryFacts.verificationStatus, ["auto_accepted", "confirmed"]), eq(memoryFacts.sensitivity, "normal")))
    .orderBy(desc(memoryFacts.createdAt))
    .limit(60);

  const { data, usage } = await withAiTelemetry(db, { projectId, userId, operation: instructions ? "revise_chapter" : "draft_chapter", provider: provider.name }, () =>
    provider.draftChapter({
      narratorName: project.narratorName,
      writingStyle: project.writingStyle,
      chapterTitle: chapter.title,
      chapterFocus: chapter.focus,
      sources: sources.map((s) => ({ id: s.id, question: s.question, text: s.text })),
      relatedFacts: facts.map((f) => f.statement),
      previousBody: instructions && current ? current.body : null,
      instructions,
    }),
  );
  const usedIds = data.usedTurnIds.filter((id) => sourceIds.includes(id));
  const finalIds = usedIds.length ? usedIds : sources.map((s) => s.id);
  const flags: RevisionFlag[] = [...data.flags, ...data.followUpQuestions.map((q) => ({ kind: "missing" as const, passage: "", note: q }))];
  const revision = await createRevision(db, chapter, {
    body: data.body.trim().slice(0, MAX_CHAPTER_BODY),
    generationType: instructions && current ? "ai_revision" : "ai_draft",
    generationMetadata: { provider: provider.name, model: usage.model, promptVersion: PROMPT_VERSION, instructions: instructions ? "provided" : null, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
    flags,
    createdByUserId: userId,
    sourceTurnIds: finalIds,
  });
  await db
    .update(manuscriptChapters)
    .set({ title: data.title.trim() || chapter.title, chapterStatus: flags.length ? "needs_review" : "drafted", needsUpdate: false, needsUpdateReason: null })
    .where(eq(manuscriptChapters.id, chapterId));
  return { revisionId: revision.id, words: wordCount(revision.body), flags: flags.length };
}

async function createRevision(
  db: DbClient,
  chapter: Chapter,
  input: { body: string; generationType: Revision["generationType"]; generationMetadata: Record<string, unknown>; flags: RevisionFlag[]; createdByUserId: string | null; sourceTurnIds: string[] },
): Promise<Revision> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from manuscript_chapters where id = ${chapter.id} for update`);
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${manuscriptRevisions.revisionNumber}), 0)` }).from(manuscriptRevisions).where(eq(manuscriptRevisions.chapterId, chapter.id));
    const [revision] = await tx
      .insert(manuscriptRevisions)
      .values({
        chapterId: chapter.id,
        projectId: chapter.projectId,
        revisionNumber: Number(max) + 1,
        body: input.body,
        generationType: input.generationType,
        generationMetadata: input.generationMetadata,
        flags: input.flags,
        createdByUserId: input.createdByUserId,
      })
      .returning();
    if (input.sourceTurnIds.length) {
      await tx.insert(manuscriptSources).values(input.sourceTurnIds.map((id) => ({ revisionId: revision.id, sourceTurnId: id, relationshipType: "primary" as const })));
    }
    await tx.update(manuscriptChapters).set({ currentRevisionId: revision.id }).where(eq(manuscriptChapters.id, chapter.id));
    return revision;
  });
}

// ------------------------------------------------------------ user editing

/** Saves the narrator's own edit as a new revision; prior revisions stay restorable. */
export async function saveUserEdit(db: DbClient, userId: string, projectId: string, chapterId: string, body: string, baseRevisionId: string | null): Promise<Revision> {
  await requireProjectAccess(db, userId, projectId, "manuscript:write");
  const chapter = await db.query.manuscriptChapters.findFirst({ where: and(eq(manuscriptChapters.id, chapterId), eq(manuscriptChapters.projectId, projectId)) });
  if (!chapter) throw new NotFoundError("We couldn't find that chapter.");
  const text = body.replace(/\r\n/g, "\n").trim();
  if (!text) throw new ValidationError("A chapter can't be saved empty.");
  if (text.length > MAX_CHAPTER_BODY) throw new ValidationError("That chapter is too long to save in one go.");
  if ((chapter.currentRevisionId ?? null) !== (baseRevisionId ?? null)) {
    throw new AppError("revision_conflict", "This chapter changed since you opened it. Reload to see the latest version before editing.", 409);
  }
  const sourceIds = chapter.currentRevisionId ? (await db.select({ id: manuscriptSources.sourceTurnId }).from(manuscriptSources).where(eq(manuscriptSources.revisionId, chapter.currentRevisionId))).map((s) => s.id) : [];
  const current = chapter.currentRevisionId ? await db.query.manuscriptRevisions.findFirst({ where: eq(manuscriptRevisions.id, chapter.currentRevisionId) }) : null;
  const revision = await createRevision(db, chapter, {
    body: text,
    generationType: "user_edit",
    generationMetadata: { basedOn: baseRevisionId },
    flags: current ? current.flags.filter((f) => f.passage && text.includes(f.passage)) : [],
    createdByUserId: userId,
    sourceTurnIds: sourceIds,
  });
  await db.update(manuscriptChapters).set({ chapterStatus: "edited" }).where(eq(manuscriptChapters.id, chapterId));
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "chapter.edit", targetType: "manuscript_chapter", targetId: chapterId });
  return revision;
}

export async function restoreRevision(db: DbClient, userId: string, projectId: string, chapterId: string, revisionId: string): Promise<Revision> {
  await requireProjectAccess(db, userId, projectId, "manuscript:write");
  const chapter = await db.query.manuscriptChapters.findFirst({ where: and(eq(manuscriptChapters.id, chapterId), eq(manuscriptChapters.projectId, projectId)) });
  const target = await db.query.manuscriptRevisions.findFirst({ where: and(eq(manuscriptRevisions.id, revisionId), eq(manuscriptRevisions.chapterId, chapterId)) });
  if (!chapter || !target) throw new NotFoundError("We couldn't find that revision.");
  const sourceIds = (await db.select({ id: manuscriptSources.sourceTurnId }).from(manuscriptSources).where(eq(manuscriptSources.revisionId, target.id))).map((s) => s.id);
  const revision = await createRevision(db, chapter, {
    body: target.body,
    generationType: "restore",
    generationMetadata: { restoredFrom: target.id, restoredRevisionNumber: target.revisionNumber },
    flags: target.flags,
    createdByUserId: userId,
    sourceTurnIds: sourceIds,
  });
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "chapter.restore", targetType: "manuscript_revision", targetId: revisionId });
  return revision;
}

export async function getRevision(db: DbClient, projectId: string, chapterId: string, revisionId: string): Promise<Revision> {
  const rev = await db.query.manuscriptRevisions.findFirst({ where: and(eq(manuscriptRevisions.id, revisionId), eq(manuscriptRevisions.chapterId, chapterId), eq(manuscriptRevisions.projectId, projectId)) });
  if (!rev) throw new NotFoundError("We couldn't find that revision.");
  return rev;
}
