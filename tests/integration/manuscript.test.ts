import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { createTestUser, setupTestDb, teardownTestDb } from "../helpers/db";
import { createProject } from "@/server/projects";
import { startOrResumeSession, submitAnswer } from "@/server/interviews";
import { __setAiProviderForTests } from "@/server/ai";
import { FixtureProvider } from "@/server/ai/fixture";
import { ensureJobHandlers } from "@/server/jobs/handlers";
import { runQueuedJobs } from "@/server/jobs";
import { manuscriptSources } from "@/db/schema";
import {
  createChapter,
  getChapterDetail,
  getManuscript,
  listChapters,
  proposeChapters,
  requestDraft,
  restoreRevision,
  saveUserEdit,
} from "@/server/manuscript/service";
import { NotFoundError } from "@/server/errors";

let db: Database;
let alice: { id: string };
let bob: { id: string };
let projectId: string;

beforeAll(async () => {
  process.env.AI_PROVIDER = "fixture";
  db = await setupTestDb();
  ensureJobHandlers();
  __setAiProviderForTests(new FixtureProvider());
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
  projectId = (await createProject(db, alice.id, { title: "Book", narratorName: "Alice", narratorIsUser: "yes", intendedScope: "full_life", scopeDescription: "", writingStyle: "warm_literary", topicsToAvoid: [], acknowledgePrivacy: "on" })).id;
  const { session } = await startOrResumeSession(db, alice.id, projectId);
  const answers = [
    "I was born in Leeds in 1954, the youngest of three.",
    "My grandmother Edith lived with us and baked bread on Sundays.",
    "I think we moved to Manchester around 1961, but I'm not sure of the year.",
    "My first job was at the mill, sweeping floors for a man called Harold.",
    "Harold taught me to keep my head down and my eyes open.",
  ];
  for (let i = 0; i < answers.length; i += 1) {
    await submitAnswer(db, alice.id, projectId, session.id, { text: answers[i], inputMode: "text", clientTurnId: `book-${i}` });
  }
  await runQueuedJobs(db, { projectId, limit: 20 });
});

afterAll(async () => {
  __setAiProviderForTests(null);
  await teardownTestDb();
});

describe("manuscript", () => {
  it("proposes chapters from saved answers with sources attached", async () => {
    const result = await proposeChapters(db, alice.id, projectId);
    expect(result.created).toBeGreaterThan(0);
    const chapters = await listChapters(db, projectId);
    expect(chapters.length).toBe(result.created);
    expect(chapters.every((c) => c.plannedSourceTurnIds.length > 0)).toBe(true);
    const again = await proposeChapters(db, alice.id, projectId);
    expect(again.created).toBe(0);
  });

  it("drafts a chapter as an immutable revision traceable to its sources", async () => {
    const [chapter] = await listChapters(db, projectId);
    await requestDraft(db, alice.id, projectId, chapter.id, null);
    await runQueuedJobs(db, { projectId, limit: 5 });
    const detail = await getChapterDetail(db, projectId, chapter.id);
    expect(detail.current).not.toBeNull();
    expect(detail.current?.generationType).toBe("ai_draft");
    expect(detail.sources.length).toBeGreaterThan(0);
    expect(detail.sources.every((s) => chapter.plannedSourceTurnIds.includes(s.turnId))).toBe(true);
    expect(detail.chapter.chapterStatus === "drafted" || detail.chapter.chapterStatus === "needs_review").toBe(true);
  });

  it("keeps user edits as new revisions and never overwrites them", async () => {
    const [chapter] = await listChapters(db, projectId);
    const before = await getChapterDetail(db, projectId, chapter.id);
    const edited = await saveUserEdit(db, alice.id, projectId, chapter.id, `${before.current!.body}\n\nAdded by Alice herself.`, before.current!.id);
    expect(edited.generationType).toBe("user_edit");
    expect(edited.revisionNumber).toBe(before.current!.revisionNumber + 1);

    // A stale editor cannot clobber the newer revision.
    await expect(saveUserEdit(db, alice.id, projectId, chapter.id, "stale text", before.current!.id)).rejects.toMatchObject({ code: "revision_conflict" });

    // A regeneration adds another revision; the user's edit still exists and is restorable.
    await requestDraft(db, alice.id, projectId, chapter.id, "Make it shorter.");
    await runQueuedJobs(db, { projectId, limit: 5 });
    const after = await getChapterDetail(db, projectId, chapter.id);
    expect(after.current?.generationType).toBe("ai_revision");
    expect(after.revisions.map((r) => r.generationType)).toContain("user_edit");
    const sources = await db.select().from(manuscriptSources).where(eq(manuscriptSources.revisionId, edited.id));
    expect(sources.length).toBeGreaterThan(0);

    const restored = await restoreRevision(db, alice.id, projectId, chapter.id, edited.id);
    expect(restored.generationType).toBe("restore");
    expect(restored.body).toContain("Added by Alice herself.");
    const final = await getChapterDetail(db, projectId, chapter.id);
    expect(final.current?.id).toBe(restored.id);
    expect(final.revisions.length).toBeGreaterThanOrEqual(4);
  });

  it("assembles the manuscript from current revisions only", async () => {
    await createChapter(db, alice.id, projectId, "Not drafted yet", null);
    const { chapters } = await getManuscript(db, projectId);
    const drafted = chapters.filter((c) => c.body.trim());
    expect(drafted.length).toBeGreaterThan(0);
    expect(chapters.find((c) => c.title === "Not drafted yet")?.body).toBe("");
  });

  it("is not visible to another user", async () => {
    const [chapter] = await listChapters(db, projectId);
    await expect(saveUserEdit(db, bob.id, projectId, chapter.id, "x", null)).rejects.toBeInstanceOf(NotFoundError);
    await expect(requestDraft(db, bob.id, projectId, chapter.id, null)).rejects.toBeInstanceOf(NotFoundError);
    await expect(proposeChapters(db, bob.id, projectId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
