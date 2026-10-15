import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { createTestUser, setupTestDb, teardownTestDb } from "../helpers/db";
import { createProject } from "@/server/projects";
import {
  correctTurn,
  findResumableSession,
  getSessionTranscript,
  setSessionStatus,
  skipQuestion,
  startNewSession,
  startOrResumeSession,
  submitAnswer,
} from "@/server/interviews";
import { __setAiProviderForTests } from "@/server/ai";
import { FixtureProvider } from "@/server/ai/fixture";
import { processingJobs } from "@/db/schema";
import { NotFoundError } from "@/server/errors";

let db: Database;
let alice: { id: string };
let bob: { id: string };
let projectId: string;

const baseInput = {
  title: "Alice's Story",
  narratorName: "Alice",
  narratorIsUser: "yes" as const,
  intendedScope: "full_life" as const,
  scopeDescription: "",
  writingStyle: "warm_literary" as const,
  topicsToAvoid: ["my divorce"],
  acknowledgePrivacy: "on" as const,
};

beforeAll(async () => {
  process.env.AI_PROVIDER = "fixture";
  db = await setupTestDb();
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
  projectId = (await createProject(db, alice.id, baseInput)).id;
});

afterAll(async () => {
  __setAiProviderForTests(null);
  await teardownTestDb();
});

describe("interview sessions", () => {
  it("opens a session with an opening question and resumes it later", async () => {
    const first = await startOrResumeSession(db, alice.id, projectId);
    expect(first.created).toBe(true);
    const { turns } = await getSessionTranscript(db, alice.id, projectId, first.session.id);
    expect(turns).toHaveLength(1);
    expect(turns[0].speakerType).toBe("interviewer");
    expect(turns[0].originalText).toContain("Alice");

    const again = await startOrResumeSession(db, alice.id, projectId);
    expect(again.created).toBe(false);
    expect(again.session.id).toBe(first.session.id);
  });

  it("saves an answer, asks a follow-up and keeps ordering stable", async () => {
    const { session } = await startOrResumeSession(db, alice.id, projectId);
    const result = await submitAnswer(db, alice.id, projectId, session.id, {
      text: "I was born in Leeds in 1954. My grandmother Edith lived with us on Elm Street.",
      inputMode: "text",
      clientTurnId: "client-turn-1",
    });
    expect(result.duplicate).toBe(false);
    expect(result.answer.sequenceNumber).toBe(2);
    expect(result.nextQuestion?.sequenceNumber).toBe(3);
    expect(result.nextQuestion?.originalText).toContain("Edith");

    const { turns } = await getSessionTranscript(db, alice.id, projectId, session.id);
    expect(turns.map((t) => t.sequenceNumber)).toEqual([1, 2, 3]);

    const jobs = await db.select().from(processingJobs).where(eq(processingJobs.projectId, projectId));
    expect(jobs.some((j) => j.jobType === "process_turn" && j.idempotencyKey === `process_turn:${result.answer.id}:1`)).toBe(true);
  });

  it("is idempotent for retried submissions with the same client id", async () => {
    const { session } = await startOrResumeSession(db, alice.id, projectId);
    const retry = await submitAnswer(db, alice.id, projectId, session.id, {
      text: "I was born in Leeds in 1954. My grandmother Edith lived with us on Elm Street.",
      inputMode: "text",
      clientTurnId: "client-turn-1",
    });
    expect(retry.duplicate).toBe(true);
    expect(retry.answer.sequenceNumber).toBe(2);
    expect(retry.nextQuestion?.sequenceNumber).toBe(3);
    const { turns } = await getSessionTranscript(db, alice.id, projectId, session.id);
    expect(turns).toHaveLength(3);
  });

  it("keeps the answer and still asks a question when the AI provider fails", async () => {
    class Broken extends FixtureProvider {
      override async generateQuestion(): Promise<never> {
        throw new Error("simulated outage");
      }
    }
    __setAiProviderForTests(new Broken());
    try {
      const { session } = await startOrResumeSession(db, alice.id, projectId);
      const result = await submitAnswer(db, alice.id, projectId, session.id, {
        text: "My father worked at the mill. I think he started there around 1949.",
        inputMode: "text",
        clientTurnId: "client-turn-2",
      });
      expect(result.answer.originalText).toContain("mill");
      expect(result.nextQuestion).not.toBeNull();
      expect((result.nextQuestion?.metadata as { questionSource?: string }).questionSource).toBe("planner");
    } finally {
      __setAiProviderForTests(new FixtureProvider());
    }
  });

  it("never asks the same template question twice and respects avoided topics", async () => {
    const { session } = await startOrResumeSession(db, alice.id, projectId);
    const seen = new Set<string>();
    for (let i = 0; i < 6; i += 1) {
      const result = await skipQuestion(db, alice.id, projectId, session.id, `skip-${i}`);
      const q = result.nextQuestion?.originalText ?? "";
      expect(q.toLowerCase()).not.toContain("divorce");
      expect(seen.has(q)).toBe(false);
      seen.add(q);
    }
  });

  it("records corrections without losing the original words", async () => {
    const { session } = await startOrResumeSession(db, alice.id, projectId);
    const { turns } = await getSessionTranscript(db, alice.id, projectId, session.id);
    const answer = turns.find((t) => t.speakerType === "narrator" && t.originalText.includes("Leeds"))!;
    const updated = await correctTurn(db, alice.id, projectId, answer.id, "I was born in Leeds in 1954. My grandmother Edith Marsh lived with us on Elm Street.");
    expect(updated.originalText).toContain("Edith lived");
    expect(updated.correctedText).toContain("Edith Marsh");
    const jobs = await db.select().from(processingJobs).where(eq(processingJobs.idempotencyKey, `process_turn:${answer.id}:2`));
    expect(jobs).toHaveLength(1);
  });

  it("pauses, resumes and finishes; a finished session rejects answers", async () => {
    const { session } = await startOrResumeSession(db, alice.id, projectId);
    await setSessionStatus(db, alice.id, projectId, session.id, "paused");
    expect((await findResumableSession(db, projectId))?.id).toBe(session.id);
    await setSessionStatus(db, alice.id, projectId, session.id, "completed");
    expect(await findResumableSession(db, projectId)).toBeNull();
    await expect(
      submitAnswer(db, alice.id, projectId, session.id, { text: "late", inputMode: "text", clientTurnId: "client-turn-late" }),
    ).rejects.toMatchObject({ code: "session_closed" });
    const fresh = await startNewSession(db, alice.id, projectId);
    expect(fresh.id).not.toBe(session.id);
    const { turns } = await getSessionTranscript(db, alice.id, projectId, fresh.id);
    expect(turns[0].speakerType).toBe("interviewer");
  });

  it("other users cannot read or write the session", async () => {
    const { session } = await startOrResumeSession(db, alice.id, projectId);
    await expect(getSessionTranscript(db, bob.id, projectId, session.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      submitAnswer(db, bob.id, projectId, session.id, { text: "intruder", inputMode: "text", clientTurnId: "bob-1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(skipQuestion(db, bob.id, projectId, session.id, "bob-skip")).rejects.toBeInstanceOf(NotFoundError);
  });
});
