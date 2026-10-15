import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import {
  interviewTurns,
  lifeEvents,
  memoirProjects,
  memoryFacts,
  people,
  storyThreads,
} from "@/db/schema";
import { getAiProvider, withAiTelemetry } from "../ai";
import type { QuestionContext, QuestionPlan, ThreadSummary } from "../ai/types";
import {
  COVERAGE_AREAS,
  OPENING_QUESTIONS,
  OPENING_TEMPLATE_IDS,
  QUESTION_TEMPLATES,
  areasForScope,
  type CoverageAreaId,
} from "./coverage";

export type PlannedQuestion = {
  question: string;
  coverageArea: CoverageAreaId | null;
  threadId: string | null;
  source: "ai" | "planner" | "opening";
  templateId: string | null;
  intent: QuestionPlan["intent"];
};

type Project = typeof memoirProjects.$inferSelect;

export function normalizeQuestion(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function openingQuestion(project: Pick<Project, "narratorName" | "intendedScope">): PlannedQuestion {
  const make = OPENING_QUESTIONS[project.intendedScope] ?? OPENING_QUESTIONS.full_life;
  const templateId = OPENING_TEMPLATE_IDS[project.intendedScope] ?? OPENING_TEMPLATE_IDS.full_life;
  const template = QUESTION_TEMPLATES.find((t) => t.id === templateId);
  return {
    question: make(project.narratorName),
    coverageArea: template?.area ?? null,
    threadId: null,
    source: "opening",
    templateId,
    intent: "new_topic",
  };
}

/** Builds the bounded context the interviewer reads before each question. */
export async function buildQuestionContext(
  db: DbClient,
  project: Project,
  sessionId: string,
): Promise<QuestionContext & { templateIdsAsked: Set<string>; threadIdByTitle: Map<string, string> }> {
  const sessionTurns = await db
    .select()
    .from(interviewTurns)
    .where(eq(interviewTurns.sessionId, sessionId))
    .orderBy(desc(interviewTurns.sequenceNumber))
    .limit(14);
  sessionTurns.reverse();

  const askedRows = await db
    .select({ text: interviewTurns.originalText, metadata: interviewTurns.metadata })
    .from(interviewTurns)
    .where(and(eq(interviewTurns.projectId, project.id), eq(interviewTurns.speakerType, "interviewer")))
    .orderBy(desc(interviewTurns.createdAt))
    .limit(300);

  const coverageRows = await db
    .select({
      area: sql<string | null>`${interviewTurns.metadata}->>'coverageArea'`,
      count: sql<number>`count(*)`,
    })
    .from(interviewTurns)
    .where(and(eq(interviewTurns.projectId, project.id), eq(interviewTurns.speakerType, "narrator"), sql`coalesce((${interviewTurns.metadata}->>'skipped')::boolean, false) = false`))
    .groupBy(sql`${interviewTurns.metadata}->>'coverageArea'`);
  const answersByArea = new Map<string, number>();
  for (const row of coverageRows) if (row.area) answersByArea.set(row.area, Number(row.count));

  const scopeAreas = new Set(areasForScope(project.intendedScope));
  const coverage = COVERAGE_AREAS.map((a) => {
    const answers = answersByArea.get(a.id) ?? 0;
    const base = scopeAreas.has(a.id) ? 10 : 3;
    return { area: a.id, label: a.label, answers, priority: Math.round((base / (answers + 1)) * 10) / 10 };
  });

  const threads = await db
    .select()
    .from(storyThreads)
    .where(and(eq(storyThreads.projectId, project.id), inArray(storyThreads.status, ["open", "in_progress"])))
    .orderBy(desc(storyThreads.importance), asc(storyThreads.timesAsked), desc(storyThreads.updatedAt))
    .limit(12);

  const persons = await db
    .select({ name: people.preferredName, relationship: people.relationshipToNarrator })
    .from(people)
    .where(and(eq(people.projectId, project.id), inArray(people.status, ["confirmed", "proposed"]), eq(people.isNarrator, false)))
    .orderBy(desc(people.updatedAt))
    .limit(40);

  const events = await db
    .select({ title: lifeEvents.title, year: lifeEvents.approximateYear, age: lifeEvents.approximateAge, precision: lifeEvents.datePrecision })
    .from(lifeEvents)
    .where(and(eq(lifeEvents.projectId, project.id), inArray(lifeEvents.status, ["confirmed", "proposed"])))
    .orderBy(asc(lifeEvents.approximateYear))
    .limit(40);

  const facts = await db
    .select({ statement: memoryFacts.statement, status: memoryFacts.verificationStatus })
    .from(memoryFacts)
    .where(and(eq(memoryFacts.projectId, project.id), inArray(memoryFacts.verificationStatus, ["auto_accepted", "confirmed", "needs_confirmation"]), eq(memoryFacts.sensitivity, "normal")))
    .orderBy(desc(memoryFacts.createdAt))
    .limit(40);

  const templateIdsAsked = new Set<string>();
  for (const row of askedRows) {
    const meta = row.metadata as { templateId?: string } | null;
    if (meta?.templateId) templateIdsAsked.add(meta.templateId);
  }

  const narratorTurns = sessionTurns.filter((t) => t.speakerType === "narrator");
  const last = sessionTurns[sessionTurns.length - 1];
  const threadIdByTitle = new Map(threads.map((t) => [t.title, t.id]));

  return {
    narratorName: project.narratorName,
    mode: project.projectType,
    intendedScope: project.intendedScope,
    scopeDescription: project.scopeDescription,
    topicsToAvoid: project.topicsToAvoid,
    biographySummary: project.biographySummary,
    keyFacts: facts.map((f) => (f.status === "needs_confirmation" ? `${f.statement} (unconfirmed)` : f.statement)),
    people: persons,
    events: events.map((e) => ({
      title: e.title,
      when: e.year ? (e.precision === "approximate" || e.precision === "decade" ? `around ${e.year}` : String(e.year)) : e.age ? `age ${e.age}` : null,
    })),
    openThreads: threads.map<ThreadSummary>((t) => ({
      id: t.id,
      title: t.title,
      summary: t.summary,
      status: t.status,
      suggestedFollowUp: t.suggestedFollowUp,
      coverageArea: t.coverageArea,
      importance: t.importance,
      timesAsked: t.timesAsked,
    })),
    coverage,
    recentTurns: sessionTurns.map((t) => ({
      id: t.id,
      speaker: t.speakerType === "interviewer" ? "interviewer" : "narrator",
      text: t.correctedText ?? t.originalText,
      skipped: Boolean((t.metadata as { skipped?: boolean }).skipped),
    })),
    askedQuestions: askedRows.map((r) => r.text),
    sessionAnswerCount: narratorTurns.filter((t) => !(t.metadata as { skipped?: boolean }).skipped).length,
    lastAnswerWasSkip: Boolean(last && last.speakerType === "narrator" && (last.metadata as { skipped?: boolean }).skipped),
    templateIdsAsked,
    threadIdByTitle,
  };
}

function mentionsAvoidedTopic(question: string, topics: string[]): boolean {
  const q = question.toLowerCase();
  return topics.some((t) => {
    const words = t.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    return words.length > 0 && words.every((w) => q.includes(w));
  });
}

/** Deterministic template-based question when no AI is available or it fails. */
export function templateQuestion(ctx: Awaited<ReturnType<typeof buildQuestionContext>>): PlannedQuestion {
  const asked = new Set(ctx.askedQuestions.map(normalizeQuestion));
  const avoid = ctx.topicsToAvoid.map((t) => t.toLowerCase());

  const thread = ctx.openThreads.find(
    (t) => t.suggestedFollowUp && t.timesAsked === 0 && !asked.has(normalizeQuestion(t.suggestedFollowUp)) && !mentionsAvoidedTopic(t.suggestedFollowUp, avoid),
  );
  if (thread?.suggestedFollowUp && !ctx.lastAnswerWasSkip) {
    return { question: thread.suggestedFollowUp, coverageArea: (thread.coverageArea as CoverageAreaId | null) ?? null, threadId: thread.id, source: "planner", templateId: null, intent: "follow_up" };
  }

  const areasByPriority = [...ctx.coverage].sort((a, b) => b.priority - a.priority);
  for (const area of areasByPriority) {
    const candidates = QUESTION_TEMPLATES.filter(
      (t) =>
        t.area === area.area &&
        !ctx.templateIdsAsked.has(t.id) &&
        !asked.has(normalizeQuestion(t.text(ctx.narratorName))) &&
        !t.tags.some((tag) => avoid.some((a) => a.includes(tag) || tag.includes(a))) &&
        !mentionsAvoidedTopic(t.text(ctx.narratorName), avoid),
    );
    if (candidates.length === 0) continue;
    const pick = (area.answers === 0 && candidates.find((c) => c.opener)) || candidates[0];
    return { question: pick.text(ctx.narratorName), coverageArea: pick.area, threadId: null, source: "planner", templateId: pick.id, intent: "new_topic" };
  }

  const closers = [
    "Is there a story you've been meaning to tell that we haven't reached yet?",
    "What is something about your life that people who know you now might be surprised by?",
    "If you could spend one more ordinary afternoon with someone from your past, who would it be and what would you do?",
  ];
  const closer = closers.find((c) => !asked.has(normalizeQuestion(c))) ?? closers[0];
  return { question: closer, coverageArea: null, threadId: null, source: "planner", templateId: null, intent: "closing" };
}

/**
 * Chooses the next question: the AI interviewer when configured, validated
 * against repetition and avoided topics, otherwise the template planner.
 * Never throws; the template planner is the floor.
 */
export async function planNextQuestion(
  db: DbClient,
  project: Project,
  sessionId: string,
  userId: string | null,
): Promise<PlannedQuestion> {
  const ctx = await buildQuestionContext(db, project, sessionId);
  const provider = getAiProvider();
  if (provider) {
    try {
      const { data } = await withAiTelemetry(
        db,
        { projectId: project.id, userId, operation: "generate_question", provider: provider.name },
        () => provider.generateQuestion(ctx),
      );
      const asked = new Set(ctx.askedQuestions.map(normalizeQuestion));
      const ok =
        data.question.trim().length > 0 &&
        !asked.has(normalizeQuestion(data.question)) &&
        !mentionsAvoidedTopic(data.question, ctx.topicsToAvoid);
      if (ok) {
        const threadId = data.relatedThreadTitle ? (ctx.threadIdByTitle.get(data.relatedThreadTitle) ?? null) : null;
        return {
          question: data.question.trim(),
          coverageArea: data.coverageArea,
          threadId,
          source: "ai",
          templateId: null,
          intent: data.intent,
        };
      }
    } catch {
      // Logged by withAiTelemetry; fall through to the planner.
    }
  }
  return templateQuestion(ctx);
}
