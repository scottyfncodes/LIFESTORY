import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { createTestUser, setupTestDb, teardownTestDb } from "../helpers/db";
import { createProject } from "@/server/projects";
import { correctTurn, startOrResumeSession, submitAnswer } from "@/server/interviews";
import { ensureJobHandlers } from "@/server/jobs/handlers";
import { runQueuedJobs } from "@/server/jobs";
import { __setAiProviderForTests } from "@/server/ai";
import { FixtureProvider } from "@/server/ai/fixture";
import { interviewTurns, lifeEvents, memoryFacts, people, storyThreads } from "@/db/schema";
import { processTurn } from "@/server/memory/pipeline";

let db: Database;
let alice: { id: string };
let projectId: string;
let sessionId: string;

beforeAll(async () => {
  process.env.AI_PROVIDER = "fixture";
  db = await setupTestDb();
  ensureJobHandlers();
  alice = await createTestUser("Alice");
  projectId = (
    await createProject(db, alice.id, {
      title: "Memory",
      narratorName: "Alice",
      narratorIsUser: "yes",
      intendedScope: "full_life",
      scopeDescription: "",
      writingStyle: "warm_literary",
      topicsToAvoid: [],
      acknowledgePrivacy: "on",
    })
  ).id;
  sessionId = (await startOrResumeSession(db, alice.id, projectId)).session.id;
});

afterAll(async () => {
  __setAiProviderForTests(null);
  await teardownTestDb();
});

describe("memory pipeline", () => {
  it("extracts people, events, facts and threads from a saved answer via the job queue", async () => {
    const result = await submitAnswer(db, alice.id, projectId, sessionId, {
      text: "I was born in Leeds in 1954. My grandmother Edith lived with us. I think we moved in 1961, but I'm not sure.",
      inputMode: "text",
      clientTurnId: "mem-1",
    });
    const ran = await runQueuedJobs(db, { projectId });
    expect(ran).toBeGreaterThan(0);

    const turn = await db.query.interviewTurns.findFirst({ where: eq(interviewTurns.id, result.answer.id) });
    expect((turn?.metadata as { processingStatus?: string }).processingStatus).toBe("processed");

    const persons = await db.select().from(people).where(eq(people.projectId, projectId));
    expect(persons.map((p) => p.preferredName)).toContain("Edith");
    expect(persons.find((p) => p.preferredName === "Edith")?.relationshipToNarrator).toBe("grandmother");

    const events = await db.select().from(lifeEvents).where(eq(lifeEvents.projectId, projectId));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.datePrecision !== "exact")).toBe(true);

    const facts = await db.select().from(memoryFacts).where(eq(memoryFacts.projectId, projectId));
    expect(facts.some((f) => f.verificationStatus === "needs_confirmation")).toBe(true);
    expect(facts.every((f) => f.sourceTurnId === result.answer.id)).toBe(true);

    const threads = await db.select().from(storyThreads).where(eq(storyThreads.projectId, projectId));
    expect(threads.some((t) => t.title.includes("Edith"))).toBe(true);
  });

  it("does not create a duplicate for an exact name match and asks a follow-up from the thread", async () => {
    const second = await submitAnswer(db, alice.id, projectId, sessionId, {
      text: "Edith baked bread every Sunday and told stories about the war.",
      inputMode: "text",
      clientTurnId: "mem-2",
    });
    await runQueuedJobs(db, { projectId });
    const persons = await db.select().from(people).where(and(eq(people.projectId, projectId), eq(people.preferredName, "Edith")));
    expect(persons).toHaveLength(1);
    expect(second.nextQuestion?.originalText.toLowerCase()).toContain("edith");
  });

  it("flags a same-first-name person as a possible duplicate instead of merging", async () => {
    await submitAnswer(db, alice.id, projectId, sessionId, {
      text: "Later I met Edith Carter at work, a completely different person.",
      inputMode: "text",
      clientTurnId: "mem-3",
    });
    await runQueuedJobs(db, { projectId });
    const persons = await db.select().from(people).where(eq(people.projectId, projectId));
    const carter = persons.find((p) => p.preferredName === "Edith Carter");
    expect(carter?.status).toBe("proposed");
    const flags = await db.select().from(memoryFacts).where(and(eq(memoryFacts.projectId, projectId), eq(memoryFacts.factType, "possible_duplicate")));
    expect(flags).toHaveLength(1);
  });

  it("re-processes a corrected answer without losing user-verified records", async () => {
    const answer = await db.query.interviewTurns.findFirst({ where: and(eq(interviewTurns.projectId, projectId), eq(interviewTurns.clientTurnId, "mem-1")) });
    const edith = await db.query.people.findFirst({ where: and(eq(people.projectId, projectId), eq(people.preferredName, "Edith")) });
    await db.update(people).set({ userVerified: true, notes: "Confirmed by Alice" }).where(eq(people.id, edith!.id));
    const before = await db.select().from(memoryFacts).where(eq(memoryFacts.sourceTurnId, answer!.id));
    expect(before.length).toBeGreaterThan(0);

    await correctTurn(db, alice.id, projectId, answer!.id, "I was born in Leeds in 1954. My grandmother Edith lived with us. We moved in 1961.");
    await runQueuedJobs(db, { projectId });

    const after = await db.select().from(memoryFacts).where(eq(memoryFacts.sourceTurnId, answer!.id));
    const statements = after.filter((f) => f.factType === "statement");
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.every((f) => (f.factValue as { uncertain?: boolean }).uncertain === false)).toBe(true);
    const still = await db.query.people.findFirst({ where: eq(people.id, edith!.id) });
    expect(still?.notes).toBe("Confirmed by Alice");
  });

  it("is honest when no AI provider is configured", async () => {
    __setAiProviderForTests(null);
    process.env.AI_PROVIDER = "none";
    try {
      const r = await submitAnswer(db, alice.id, projectId, sessionId, { text: "A note with no AI.", inputMode: "text", clientTurnId: "mem-4" });
      const out = await processTurn(db, r.answer.id);
      expect(out).toMatchObject({ processed: false, reason: "no_ai" });
    } finally {
      process.env.AI_PROVIDER = "fixture";
      __setAiProviderForTests(new FixtureProvider());
    }
  });
});
