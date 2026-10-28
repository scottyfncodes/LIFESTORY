import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { createTestUser, setupTestDb, teardownTestDb } from "../helpers/db";
import { createProject } from "@/server/projects";
import { startOrResumeSession, submitAnswer } from "@/server/interviews";
import { ensureJobHandlers } from "@/server/jobs/handlers";
import { runQueuedJobs } from "@/server/jobs";
import { __setAiProviderForTests, withAiTelemetry } from "@/server/ai";
import { FixtureProvider } from "@/server/ai/fixture";
import { interviewTurns, manuscriptChapters, manuscriptRevisions, processingJobs, rateLimitBuckets, usageEvents } from "@/db/schema";
import { proposeChapters, requestDraft } from "@/server/manuscript/service";
import {
  aiGlobalDailyLimit,
  consumeGlobalAiBudget,
  DEFAULT_AI_GLOBAL_DAILY_LIMIT,
  enforceRateLimit,
} from "@/server/rate-limit";
import { AiPausedError, RateLimitError } from "@/server/errors";

let db: Database;
let alice: { id: string };
let projectId: string;
let sessionId: string;

// Only Date is faked, so each test gets its own UTC day (past dates keep deferred jobs claimable by the DB clock).
function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

const fakeCall = (calls: { n: number }) => async () => {
  calls.n += 1;
  return { data: "ok", usage: { model: "fake", inputTokens: 1, outputTokens: 1 } };
};

async function globalCount(day: string) {
  const row = await db.query.rateLimitBuckets.findFirst({ where: eq(rateLimitBuckets.key, `aiGlobal:${day}`) });
  return row?.count ?? 0;
}

beforeAll(async () => {
  process.env.AI_PROVIDER = "fixture";
  db = await setupTestDb();
  ensureJobHandlers();
  __setAiProviderForTests(new FixtureProvider());
  alice = await createTestUser("Alice");
  projectId = (await createProject(db, alice.id, { title: "Budget", narratorName: "Alice", narratorIsUser: "yes", intendedScope: "full_life", scopeDescription: "", writingStyle: "warm_literary", topicsToAvoid: [], acknowledgePrivacy: "on" })).id;
  sessionId = (await startOrResumeSession(db, alice.id, projectId)).session.id;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.AI_GLOBAL_DAILY_LIMIT;
});

afterAll(async () => {
  __setAiProviderForTests(null);
  await teardownTestDb();
});

describe("global daily AI limit", () => {
  it("defaults to a fixed number when unset and never means unlimited", () => {
    expect(aiGlobalDailyLimit({})).toBe(DEFAULT_AI_GLOBAL_DAILY_LIMIT);
    expect(aiGlobalDailyLimit({ AI_GLOBAL_DAILY_LIMIT: "" })).toBe(DEFAULT_AI_GLOBAL_DAILY_LIMIT);
    expect(aiGlobalDailyLimit({ AI_GLOBAL_DAILY_LIMIT: "40" })).toBe(40);
    expect(aiGlobalDailyLimit({ AI_GLOBAL_DAILY_LIMIT: "0" })).toBe(0);
    for (const bad of ["-1", "lots", "2.5", "Infinity"]) expect(aiGlobalDailyLimit({ AI_GLOBAL_DAILY_LIMIT: bad })).toBe(DEFAULT_AI_GLOBAL_DAILY_LIMIT);
  });

  it("allows calls under the limit and blocks at the limit without calling the model", async () => {
    at("2024-02-01T09:00:00Z");
    process.env.AI_GLOBAL_DAILY_LIMIT = "2";
    const calls = { n: 0 };
    const meta = { projectId, userId: alice.id, operation: "generate_question", provider: "fake" };
    await withAiTelemetry(db, meta, fakeCall(calls));
    await withAiTelemetry(db, meta, fakeCall(calls));
    const blocked = withAiTelemetry(db, meta, fakeCall(calls));
    await expect(blocked).rejects.toBeInstanceOf(AiPausedError);
    await expect(blocked).rejects.toMatchObject({ status: 503, code: "ai_paused" });
    expect(calls.n).toBe(2);
    expect(await globalCount("2024-02-01")).toBe(2);
    // No usage row is written for a call that was never made.
    const events = await db.select().from(usageEvents).where(eq(usageEvents.provider, "fake"));
    expect(events).toHaveLength(2);
    const error = (await blocked.catch((e: unknown) => e)) as AiPausedError;
    expect(error.message).not.toMatch(/—/);
    expect(error.resumesAt.toISOString()).toBe("2024-02-02T00:00:00.000Z");
  });

  it("an env override of 0 pauses AI", async () => {
    at("2024-02-02T09:00:00Z");
    process.env.AI_GLOBAL_DAILY_LIMIT = "0";
    const calls = { n: 0 };
    await expect(withAiTelemetry(db, { projectId, userId: alice.id, operation: "plan_chapters", provider: "fake" }, fakeCall(calls))).rejects.toBeInstanceOf(AiPausedError);
    expect(calls.n).toBe(0);
    expect(await globalCount("2024-02-02")).toBe(0);
  });

  it("keeps the per-user limit and doesn't share its bucket", async () => {
    const saved = process.env.RATE_LIMITS_DISABLED;
    process.env.RATE_LIMITS_DISABLED = "0";
    try {
      at("2024-02-03T09:00:00Z");
      const rule = { limit: 2, windowSeconds: 60 };
      await enforceRateLimit(db, "answer", alice.id, rule);
      await enforceRateLimit(db, "answer", alice.id, rule);
      await expect(enforceRateLimit(db, "answer", alice.id, rule)).rejects.toBeInstanceOf(RateLimitError);
      expect(await globalCount("2024-02-03")).toBe(0);
      expect(await consumeGlobalAiBudget(db, new Date(), 10)).toBe(true);
    } finally {
      process.env.RATE_LIMITS_DISABLED = saved;
    }
  });

  it("starts a fresh budget at midnight UTC", async () => {
    expect(await consumeGlobalAiBudget(db, new Date("2024-02-04T23:59:00Z"), 1)).toBe(true);
    expect(await consumeGlobalAiBudget(db, new Date("2024-02-04T23:59:59Z"), 1)).toBe(false);
    expect(await consumeGlobalAiBudget(db, new Date("2024-02-05T00:00:01Z"), 1)).toBe(true);
  });

  it("never lets parallel calls past the limit", async () => {
    const now = new Date("2024-02-06T12:00:00Z");
    const results = await Promise.all(Array.from({ length: 25 }, () => consumeGlobalAiBudget(db, now, 7)));
    expect(results.filter(Boolean)).toHaveLength(7);
    expect(await globalCount("2024-02-06")).toBe(7);
  });

  it("keeps the answer, asks a built-in question and defers memory work to the next day", async () => {
    at("2024-02-07T15:00:00Z");
    process.env.AI_GLOBAL_DAILY_LIMIT = "0";
    const result = await submitAnswer(db, alice.id, projectId, sessionId, { text: "My grandmother Edith baked bread on Sundays.", inputMode: "text", clientTurnId: "budget-1" });
    expect(result.answer.originalText).toContain("Edith");
    expect((result.nextQuestion?.metadata as { questionSource?: string }).questionSource).toBe("planner");

    await runQueuedJobs(db, { projectId });
    const job = await db.query.processingJobs.findFirst({ where: eq(processingJobs.idempotencyKey, `process_turn:${result.answer.id}:1`) });
    expect(job).toMatchObject({ status: "queued", attempts: 0, lastErrorCode: "ai_paused" });
    expect(job?.runAfter.toISOString()).toBe("2024-02-08T00:00:00.000Z");
    const turn = await db.query.interviewTurns.findFirst({ where: eq(interviewTurns.id, result.answer.id) });
    expect(turn?.metadata).toMatchObject({ processingStatus: "pending", processingError: "ai_paused" });

    // Next day, with budget again, the same job finishes the work.
    at("2024-02-08T08:00:00Z");
    delete process.env.AI_GLOBAL_DAILY_LIMIT;
    await runQueuedJobs(db, { projectId, limit: 10 });
    const done = await db.query.processingJobs.findFirst({ where: eq(processingJobs.id, job!.id) });
    expect(done?.status).toBe("succeeded");
    const processed = await db.query.interviewTurns.findFirst({ where: eq(interviewTurns.id, result.answer.id) });
    expect(processed?.metadata).toMatchObject({ processingStatus: "processed" });
  });

  it("tells the writer at once when drafting is paused and leaves the chapter untouched", async () => {
    at("2024-02-09T10:00:00Z");
    await proposeChapters(db, alice.id, projectId);
    const chapter = await db.query.manuscriptChapters.findFirst({ where: eq(manuscriptChapters.projectId, projectId) });
    expect(chapter).toBeTruthy();

    // Budget spent before the request: refused up front.
    process.env.AI_GLOBAL_DAILY_LIMIT = "1";
    await expect(requestDraft(db, alice.id, projectId, chapter!.id, null)).rejects.toBeInstanceOf(AiPausedError);

    // Budget spent between the request and the job: the job fails with the same message, no retry.
    at("2024-02-10T10:00:00Z");
    const { jobId } = await requestDraft(db, alice.id, projectId, chapter!.id, null);
    await consumeGlobalAiBudget(db, new Date(), 1);
    await runQueuedJobs(db, { projectId, limit: 5 });
    const job = await db.query.processingJobs.findFirst({ where: eq(processingJobs.id, jobId!) });
    expect(job?.status).toBe("failed");
    expect(job?.lastErrorMessage).toMatch(/paused for today/);
    expect(job?.lastErrorMessage).toMatch(/safe/);
    const revisions = await db.select().from(manuscriptRevisions).where(eq(manuscriptRevisions.chapterId, chapter!.id));
    expect(revisions).toHaveLength(0);
  });
});
