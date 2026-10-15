import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import {
  interviewSessions,
  interviewTurns,
  mediaAssets,
  storyThreads,
  type TurnMetadata,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { requireProjectAccess, type ProjectAccess } from "./authz";
import { AppError, NotFoundError, ValidationError } from "./errors";
import { enqueueJob } from "./jobs";
import { openingQuestion, planNextQuestion, type PlannedQuestion } from "./interviewer/planner";
import { touchProject } from "./projects";

export type Session = typeof interviewSessions.$inferSelect;
export type Turn = typeof interviewTurns.$inferSelect;

export const MAX_ANSWER_LENGTH = 20_000;

async function requireSession(db: DbClient, projectId: string, sessionId: string): Promise<Session> {
  const session = await db.query.interviewSessions.findFirst({
    where: and(eq(interviewSessions.id, sessionId), eq(interviewSessions.projectId, projectId)),
  });
  if (!session) throw new NotFoundError("We couldn't find that interview session.");
  return session;
}

/** Latest resumable session for the project, or null. */
export async function findResumableSession(db: DbClient, projectId: string): Promise<Session | null> {
  const session = await db.query.interviewSessions.findFirst({
    where: and(eq(interviewSessions.projectId, projectId), inArray(interviewSessions.sessionStatus, ["active", "paused"])),
    orderBy: desc(interviewSessions.lastActivityAt),
  });
  return session ?? null;
}

async function appendTurn(
  db: DbClient,
  session: Session,
  input: {
    speakerType: "interviewer" | "narrator" | "system";
    inputMode: "text" | "voice" | "generated";
    originalText: string;
    transcriptionStatus?: Turn["transcriptionStatus"];
    clientTurnId?: string | null;
    metadata?: TurnMetadata;
    /** When set, the turn is only appended if the previous speaker differs. */
    requirePreviousSpeaker?: "interviewer" | "narrator" | null;
  },
): Promise<{ turn: Turn; created: boolean }> {
  return db.transaction(async (tx) => {
    // Serialise appends per session.
    await tx.execute(sql`select id from interview_sessions where id = ${session.id} for update`);

    if (input.clientTurnId) {
      const existing = await tx.query.interviewTurns.findFirst({
        where: and(eq(interviewTurns.sessionId, session.id), eq(interviewTurns.clientTurnId, input.clientTurnId)),
      });
      if (existing) return { turn: existing, created: false };
    }

    const last = await tx.query.interviewTurns.findFirst({
      where: eq(interviewTurns.sessionId, session.id),
      orderBy: desc(interviewTurns.sequenceNumber),
    });
    if (input.requirePreviousSpeaker !== undefined && input.requirePreviousSpeaker !== null) {
      if (last && last.speakerType !== input.requirePreviousSpeaker) {
        return { turn: last, created: false };
      }
    }
    const sequenceNumber = (last?.sequenceNumber ?? 0) + 1;
    const [turn] = await tx
      .insert(interviewTurns)
      .values({
        sessionId: session.id,
        projectId: session.projectId,
        sequenceNumber,
        speakerType: input.speakerType,
        inputMode: input.inputMode,
        originalText: input.originalText,
        transcriptionStatus: input.transcriptionStatus ?? null,
        clientTurnId: input.clientTurnId ?? null,
        metadata: input.metadata ?? {},
      })
      .returning();
    await tx
      .update(interviewSessions)
      .set({ lastActivityAt: new Date(), sessionStatus: "active" })
      .where(eq(interviewSessions.id, session.id));
    return { turn, created: true };
  });
}

async function appendQuestion(db: DbClient, session: Session, plan: PlannedQuestion): Promise<Turn> {
  const { turn } = await appendTurn(db, session, {
    speakerType: "interviewer",
    inputMode: "generated",
    originalText: plan.question,
    metadata: {
      questionSource: plan.source,
      coverageArea: plan.coverageArea,
      threadId: plan.threadId,
      templateId: plan.templateId,
      intent: plan.intent,
    } as TurnMetadata,
    requirePreviousSpeaker: "narrator",
  });
  if (plan.threadId) {
    await db
      .update(storyThreads)
      .set({ timesAsked: sql`${storyThreads.timesAsked} + 1`, lastAskedAt: new Date(), status: "in_progress" })
      .where(eq(storyThreads.id, plan.threadId));
  }
  return turn;
}

/**
 * Guarantees the session ends with an interviewer question. If a previous
 * request saved an answer but died before asking the next question (timeout,
 * crash, provider failure), this asks it now. Idempotent: returns the
 * existing question when there already is one.
 */
async function ensureQuestionAfterLatest(db: DbClient, project: ProjectAccess["project"], session: Session, userId: string): Promise<Turn | null> {
  const last = await db.query.interviewTurns.findFirst({
    where: eq(interviewTurns.sessionId, session.id),
    orderBy: desc(interviewTurns.sequenceNumber),
  });
  if (!last) return null;
  if (last.speakerType === "interviewer") return last;
  const plan = await planNextQuestion(db, project, session.id, userId);
  return appendQuestion(db, session, plan);
}

/** Heals a session left without a current question (called when it is opened). */
export async function ensureCurrentQuestion(db: DbClient, userId: string, projectId: string, sessionId: string): Promise<Turn | null> {
  const access = await requireProjectAccess(db, userId, projectId, "interview:write");
  const session = await requireSession(db, projectId, sessionId);
  if (session.sessionStatus !== "active" && session.sessionStatus !== "paused") return null;
  return ensureQuestionAfterLatest(db, access.project, session, userId);
}

/**
 * Returns the session the narrator should continue, creating one (with its
 * opening question) if none is open.
 */
export async function startOrResumeSession(
  db: DbClient,
  userId: string,
  projectId: string,
): Promise<{ access: ProjectAccess; session: Session; created: boolean }> {
  const access = await requireProjectAccess(db, userId, projectId, "interview:write");
  const existing = await findResumableSession(db, projectId);
  if (existing) return { access, session: existing, created: false };
  const session = await createSession(db, access, userId);
  return { access, session, created: true };
}

export async function createSession(db: DbClient, access: ProjectAccess, userId: string): Promise<Session> {
  const { project } = access;
  const [session] = await db
    .insert(interviewSessions)
    .values({
      projectId: project.id,
      interviewerUserId: userId,
      narratorUserId: project.narratorUserId,
      mode: project.projectType,
      sessionStatus: "active",
    })
    .returning();

  const hasHistory = await db.query.interviewTurns.findFirst({ where: eq(interviewTurns.projectId, project.id) });
  const plan = hasHistory ? await planNextQuestion(db, project, session.id, userId) : openingQuestion(project);
  await appendTurn(db, session, {
    speakerType: "interviewer",
    inputMode: "generated",
    originalText: plan.question,
    metadata: { questionSource: plan.source, coverageArea: plan.coverageArea, threadId: plan.threadId, templateId: plan.templateId, intent: plan.intent } as TurnMetadata,
  });
  await recordAudit(db, { projectId: project.id, actorUserId: userId, actionType: "session.create", targetType: "interview_session", targetId: session.id });
  return session;
}

export async function startNewSession(db: DbClient, userId: string, projectId: string): Promise<Session> {
  const access = await requireProjectAccess(db, userId, projectId, "interview:write");
  const open = await findResumableSession(db, projectId);
  if (open) {
    await db.update(interviewSessions).set({ sessionStatus: "completed", endedAt: new Date() }).where(eq(interviewSessions.id, open.id));
  }
  return createSession(db, access, userId);
}

export type TranscriptTurn = Turn & {
  media: Array<{ id: string; processingStatus: string; durationSeconds: number | null; deletedAt: Date | null }>;
};

export async function getSessionTranscript(
  db: DbClient,
  userId: string,
  projectId: string,
  sessionId: string,
): Promise<{ access: ProjectAccess; session: Session; turns: TranscriptTurn[] }> {
  const access = await requireProjectAccess(db, userId, projectId, "project:read");
  const session = await requireSession(db, projectId, sessionId);
  const turns = await db.select().from(interviewTurns).where(eq(interviewTurns.sessionId, sessionId)).orderBy(asc(interviewTurns.sequenceNumber));
  const media = turns.length
    ? await db
        .select({ id: mediaAssets.id, turnId: mediaAssets.interviewTurnId, processingStatus: mediaAssets.processingStatus, durationSeconds: mediaAssets.durationSeconds, deletedAt: mediaAssets.deletedAt })
        .from(mediaAssets)
        .where(inArray(mediaAssets.interviewTurnId, turns.map((t) => t.id)))
    : [];
  const byTurn = new Map<string, TranscriptTurn["media"]>();
  for (const m of media) {
    if (!m.turnId) continue;
    (byTurn.get(m.turnId) ?? byTurn.set(m.turnId, []).get(m.turnId)!).push({ id: m.id, processingStatus: m.processingStatus, durationSeconds: m.durationSeconds, deletedAt: m.deletedAt });
  }
  return { access, session, turns: turns.map((t) => ({ ...t, media: byTurn.get(t.id) ?? [] })) };
}

export async function listSessions(db: DbClient, projectId: string) {
  const rows = await db
    .select({
      id: interviewSessions.id,
      status: interviewSessions.sessionStatus,
      startedAt: interviewSessions.startedAt,
      endedAt: interviewSessions.endedAt,
      lastActivityAt: interviewSessions.lastActivityAt,
      answerCount: sql<number>`(select count(*) from interview_turns t where t.session_id = ${interviewSessions.id} and t.speaker_type = 'narrator' and coalesce((t.metadata->>'skipped')::boolean, false) = false)`,
    })
    .from(interviewSessions)
    .where(eq(interviewSessions.projectId, projectId))
    .orderBy(desc(interviewSessions.lastActivityAt));
  return rows.map((r) => ({ ...r, answerCount: Number(r.answerCount) }));
}

export type SubmitAnswerInput = {
  text: string;
  inputMode: "text" | "voice";
  clientTurnId: string;
  mediaAssetId?: string | null;
  transcriptEdited?: boolean;
};

export type SubmitAnswerResult = {
  answer: Turn;
  nextQuestion: Turn | null;
  duplicate: boolean;
};

/**
 * Persists a narrator answer durably, then asks the next question. The
 * answer is committed before any AI call; if question planning fails the
 * template planner still produces a question, and memory extraction runs
 * as a separate job so nothing downstream can lose the answer.
 */
export async function submitAnswer(
  db: DbClient,
  userId: string,
  projectId: string,
  sessionId: string,
  input: SubmitAnswerInput,
): Promise<SubmitAnswerResult> {
  const access = await requireProjectAccess(db, userId, projectId, "interview:write");
  const session = await requireSession(db, projectId, sessionId);
  if (session.sessionStatus === "completed" || session.sessionStatus === "abandoned") {
    throw new AppError("session_closed", "This session has been finished. Start a new conversation to continue.", 409);
  }
  const text = input.text.trim();
  if (!text) throw new ValidationError("Please write or record an answer first.", { text: ["An answer is required."] });
  if (text.length > MAX_ANSWER_LENGTH) throw new ValidationError("That answer is too long to save in one go.", { text: ["Please split it into two answers."] });

  const lastQuestion = await db.query.interviewTurns.findFirst({
    where: and(eq(interviewTurns.sessionId, sessionId), eq(interviewTurns.speakerType, "interviewer")),
    orderBy: desc(interviewTurns.sequenceNumber),
  });
  const questionMeta = (lastQuestion?.metadata ?? {}) as TurnMetadata;

  let asset: typeof mediaAssets.$inferSelect | null = null;
  if (input.mediaAssetId) {
    asset = (await db.query.mediaAssets.findFirst({ where: and(eq(mediaAssets.id, input.mediaAssetId), eq(mediaAssets.projectId, projectId), eq(mediaAssets.purpose, "interview_answer")) })) ?? null;
    if (!asset) throw new NotFoundError("We couldn't find that recording.");
  }

  const { turn: answer, created } = await appendTurn(db, session, {
    speakerType: "narrator",
    inputMode: input.inputMode,
    originalText: asset?.transcriptText && input.transcriptEdited ? asset.transcriptText : text,
    transcriptionStatus: input.inputMode === "voice" ? (input.transcriptEdited ? "corrected" : "completed") : null,
    clientTurnId: input.clientTurnId,
    metadata: {
      coverageArea: questionMeta.coverageArea ?? null,
      threadId: questionMeta.threadId ?? null,
      processingStatus: "pending",
    },
  });
  if (created && asset?.transcriptText && input.transcriptEdited) {
    await db.update(interviewTurns).set({ correctedText: text }).where(eq(interviewTurns.id, answer.id));
    answer.correctedText = text;
  }
  if (!created) {
    const next = await db.query.interviewTurns.findFirst({
      where: and(eq(interviewTurns.sessionId, sessionId), eq(interviewTurns.speakerType, "interviewer"), sql`${interviewTurns.sequenceNumber} > ${answer.sequenceNumber}`),
      orderBy: asc(interviewTurns.sequenceNumber),
    });
    // A retry of an answer whose follow-up question was never written asks it now.
    return { answer, nextQuestion: next ?? (await ensureQuestionAfterLatest(db, access.project, session, userId)), duplicate: true };
  }

  if (asset) {
    await db.update(mediaAssets).set({ interviewTurnId: answer.id, sessionId }).where(eq(mediaAssets.id, asset.id));
  }

  await enqueueJob(db, {
    projectId,
    jobType: "process_turn",
    idempotencyKey: `process_turn:${answer.id}:1`,
    payload: { turnId: answer.id, userId },
  });
  await touchProject(db, projectId);

  const plan = await planNextQuestion(db, access.project, sessionId, userId);
  const nextQuestion = await appendQuestion(db, session, plan);
  return { answer, nextQuestion, duplicate: false };
}

export async function skipQuestion(
  db: DbClient,
  userId: string,
  projectId: string,
  sessionId: string,
  clientTurnId: string,
): Promise<SubmitAnswerResult> {
  const access = await requireProjectAccess(db, userId, projectId, "interview:write");
  const session = await requireSession(db, projectId, sessionId);
  const lastQuestion = await db.query.interviewTurns.findFirst({
    where: and(eq(interviewTurns.sessionId, sessionId), eq(interviewTurns.speakerType, "interviewer")),
    orderBy: desc(interviewTurns.sequenceNumber),
  });
  const meta = (lastQuestion?.metadata ?? {}) as TurnMetadata;
  const { turn, created } = await appendTurn(db, session, {
    speakerType: "narrator",
    inputMode: "text",
    originalText: "",
    clientTurnId,
    metadata: { skipped: true, coverageArea: meta.coverageArea ?? null, threadId: meta.threadId ?? null, processingStatus: "skipped" },
  });
  if (!created) return { answer: turn, nextQuestion: await ensureQuestionAfterLatest(db, access.project, session, userId), duplicate: true };
  if (meta.threadId) {
    await db.update(storyThreads).set({ status: "deferred" }).where(eq(storyThreads.id, meta.threadId));
  }
  const plan = await planNextQuestion(db, access.project, sessionId, userId);
  const nextQuestion = await appendQuestion(db, session, plan);
  return { answer: turn, nextQuestion, duplicate: false };
}

export async function setSessionStatus(
  db: DbClient,
  userId: string,
  projectId: string,
  sessionId: string,
  status: "paused" | "completed" | "active",
): Promise<Session> {
  await requireProjectAccess(db, userId, projectId, "interview:write");
  const session = await requireSession(db, projectId, sessionId);
  const [updated] = await db
    .update(interviewSessions)
    .set({
      sessionStatus: status,
      endedAt: status === "completed" ? new Date() : null,
      lastActivityAt: new Date(),
    })
    .where(eq(interviewSessions.id, session.id))
    .returning();
  await recordAudit(db, { projectId, actorUserId: userId, actionType: `session.${status}`, targetType: "interview_session", targetId: sessionId });
  return updated;
}

/**
 * Stores a correction to a narrator answer. The original text is kept; the
 * corrected text becomes the source for memory and drafting, and the turn
 * is queued for re-extraction.
 */
export async function correctTurn(
  db: DbClient,
  userId: string,
  projectId: string,
  turnId: string,
  correctedText: string,
): Promise<Turn> {
  await requireProjectAccess(db, userId, projectId, "interview:write");
  const turn = await db.query.interviewTurns.findFirst({ where: and(eq(interviewTurns.id, turnId), eq(interviewTurns.projectId, projectId)) });
  if (!turn || turn.speakerType !== "narrator") throw new NotFoundError("We couldn't find that answer.");
  const text = correctedText.trim();
  if (!text) throw new ValidationError("A corrected answer can't be empty.");
  if (text.length > MAX_ANSWER_LENGTH) throw new ValidationError("That correction is too long.");
  const version = Number((turn.metadata as { correctionVersion?: number }).correctionVersion ?? 1) + 1;
  const [updated] = await db
    .update(interviewTurns)
    .set({
      correctedText: text,
      transcriptionStatus: turn.inputMode === "voice" ? "corrected" : turn.transcriptionStatus,
      metadata: { ...(turn.metadata as TurnMetadata), correctionVersion: version, processingStatus: "pending" } as TurnMetadata,
    })
    .where(eq(interviewTurns.id, turnId))
    .returning();
  await enqueueJob(db, {
    projectId,
    jobType: "process_turn",
    idempotencyKey: `process_turn:${turnId}:${version}`,
    payload: { turnId, userId, reprocess: true },
  });
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "turn.correct", targetType: "interview_turn", targetId: turnId });
  return updated;
}

export function turnText(turn: Pick<Turn, "originalText" | "correctedText">): string {
  return turn.correctedText ?? turn.originalText;
}

export async function getProjectForInterview(db: DbClient, userId: string, projectId: string) {
  return requireProjectAccess(db, userId, projectId, "project:read");
}
