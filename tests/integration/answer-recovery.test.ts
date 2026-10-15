import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { createTestUser, setupTestDb, teardownTestDb } from "../helpers/db";
import { createProject } from "@/server/projects";
import { ensureCurrentQuestion, skipQuestion, startOrResumeSession, submitAnswer } from "@/server/interviews";
import { __setAiProviderForTests } from "@/server/ai";
import { FixtureProvider } from "@/server/ai/fixture";
import { interviewTurns } from "@/db/schema";

let db: Database;
let user: { id: string };
let projectId: string;
let sessionId: string;

class HangingProvider extends FixtureProvider {
  override generateQuestion(): Promise<never> {
    return new Promise(() => undefined);
  }
}

beforeAll(async () => {
  process.env.AI_PROVIDER = "fixture";
  db = await setupTestDb();
  __setAiProviderForTests(new FixtureProvider());
  user = await createTestUser("Narrator");
  projectId = (await createProject(db, user.id, { title: "Recovery", narratorName: "Ann", narratorIsUser: "yes", intendedScope: "full_life", scopeDescription: "", writingStyle: "warm_literary", topicsToAvoid: [], acknowledgePrivacy: "on" })).id;
  sessionId = (await startOrResumeSession(db, user.id, projectId)).session.id;
});
afterEach(() => {
  delete process.env.AI_QUESTION_TIMEOUT_MS;
  __setAiProviderForTests(new FixtureProvider());
});
afterAll(async () => {
  __setAiProviderForTests(null);
  await teardownTestDb();
});

async function lastTurn() {
  return db.query.interviewTurns.findFirst({ where: eq(interviewTurns.sessionId, sessionId), orderBy: desc(interviewTurns.sequenceNumber) });
}

/** Simulates a request that saved the answer and died before writing the next question. */
async function dropTrailingQuestion() {
  const last = await lastTurn();
  expect(last?.speakerType).toBe("interviewer");
  await db.delete(interviewTurns).where(eq(interviewTurns.id, last!.id));
  expect((await lastTurn())?.speakerType).toBe("narrator");
}

describe("answer route resilience", () => {
  it("falls back to the planner when the AI question call hangs, within the deadline", async () => {
    __setAiProviderForTests(new HangingProvider());
    process.env.AI_QUESTION_TIMEOUT_MS = "50";
    const started = Date.now();
    const result = await submitAnswer(db, user.id, projectId, sessionId, { text: "I grew up by the sea.", inputMode: "text", clientTurnId: "rec-hang-1" });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.nextQuestion).not.toBeNull();
    expect((result.nextQuestion!.metadata as { questionSource?: string }).questionSource).toBe("planner");
    expect(result.nextQuestion!.sequenceNumber).toBe(result.answer.sequenceNumber + 1);
  });

  it("a retried answer whose question was never written gets a question", async () => {
    const first = await submitAnswer(db, user.id, projectId, sessionId, { text: "My father kept bees.", inputMode: "text", clientTurnId: "rec-retry-1" });
    await dropTrailingQuestion();
    const retry = await submitAnswer(db, user.id, projectId, sessionId, { text: "My father kept bees.", inputMode: "text", clientTurnId: "rec-retry-1" });
    expect(retry.duplicate).toBe(true);
    expect(retry.answer.id).toBe(first.answer.id);
    expect(retry.nextQuestion).not.toBeNull();
    expect(retry.nextQuestion!.sequenceNumber).toBe(first.answer.sequenceNumber + 1);
    // A second retry reuses that question instead of adding another.
    const again = await submitAnswer(db, user.id, projectId, sessionId, { text: "My father kept bees.", inputMode: "text", clientTurnId: "rec-retry-1" });
    expect(again.nextQuestion!.id).toBe(retry.nextQuestion!.id);
  });

  it("a retried skip whose question was never written gets a question", async () => {
    await skipQuestion(db, user.id, projectId, sessionId, "rec-skip-1");
    await dropTrailingQuestion();
    const retry = await skipQuestion(db, user.id, projectId, sessionId, "rec-skip-1");
    expect(retry.duplicate).toBe(true);
    expect(retry.nextQuestion?.speakerType).toBe("interviewer");
  });

  it("opening a session left without a question heals it once", async () => {
    await submitAnswer(db, user.id, projectId, sessionId, { text: "We moved twice.", inputMode: "text", clientTurnId: "rec-open-1" });
    await dropTrailingQuestion();
    const healed = await ensureCurrentQuestion(db, user.id, projectId, sessionId);
    expect(healed?.speakerType).toBe("interviewer");
    const again = await ensureCurrentQuestion(db, user.id, projectId, sessionId);
    expect(again?.id).toBe(healed?.id);
    const questions = await db.select().from(interviewTurns).where(and(eq(interviewTurns.sessionId, sessionId), eq(interviewTurns.id, healed!.id)));
    expect(questions).toHaveLength(1);
  });

  it("does not let another user heal someone else's session", async () => {
    const stranger = await createTestUser("Stranger");
    await expect(ensureCurrentQuestion(db, stranger.id, projectId, sessionId)).rejects.toMatchObject({ code: "not_found" });
  });
});
