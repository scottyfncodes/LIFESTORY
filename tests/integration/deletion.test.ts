import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { createTestUser, setupTestDb, teardownTestDb } from "../helpers/db";
import { createProject } from "@/server/projects";
import { startOrResumeSession, submitAnswer } from "@/server/interviews";
import { storeRecording } from "@/server/media";
import { __setStorageForTests, type StorageProvider } from "@/server/storage";
import { __setTranscriptionForTests, FixtureTranscription } from "@/server/transcription";
import { expireRetainedAudio, purgeDeletedProject, requestProjectDeletion } from "@/server/deletion";
import { getProjectAccess } from "@/server/authz";
import { ensureJobHandlers } from "@/server/jobs/handlers";
import { runQueuedJobs } from "@/server/jobs";
import { interviewTurns, mediaAssets, memoirProjects, processingJobs } from "@/db/schema";
import { NotFoundError } from "@/server/errors";
import { exportProjectData } from "@/server/export/project-data";

class MemoryStorage implements StorageProvider {
  readonly name = "memory";
  objects = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array) { this.objects.set(key, body); }
  async get(key: string) { const b = this.objects.get(key); return b ? { body: b, contentType: "audio/webm", size: b.length } : null; }
  async delete(key: string) { this.objects.delete(key); }
}

let db: Database;
let alice: { id: string };
let bob: { id: string };
const storage = new MemoryStorage();
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from("FIXTURE:I was born in Leeds."), ...new Array(40).fill(0)]);

beforeAll(async () => {
  process.env.AI_PROVIDER = "none";
  process.env.STORAGE_PROVIDER = "local";
  db = await setupTestDb();
  ensureJobHandlers();
  __setStorageForTests(storage);
  __setTranscriptionForTests(new FixtureTranscription());
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
});

afterAll(async () => {
  __setStorageForTests(null);
  __setTranscriptionForTests(null);
  await teardownTestDb();
});

async function seedProject() {
  const projectId = (await createProject(db, alice.id, { title: "Doomed", narratorName: "Alice", narratorIsUser: "yes", intendedScope: "full_life", scopeDescription: "", writingStyle: "warm_literary", topicsToAvoid: [], acknowledgePrivacy: "on" })).id;
  const { session } = await startOrResumeSession(db, alice.id, projectId);
  const rec = await storeRecording(db, alice.id, projectId, session.id, { bytes: webm, mimeType: "audio/webm", durationSeconds: 3 });
  expect(rec.transcript).toContain("Leeds");
  await submitAnswer(db, alice.id, projectId, session.id, { text: rec.transcript!, inputMode: "voice", clientTurnId: "v1", mediaAssetId: rec.asset.id });
  return { projectId, sessionId: session.id, assetKey: rec.asset.storageKey };
}

describe("project deletion", () => {
  it("fails closed immediately and purges recordings and rows afterwards", async () => {
    const { projectId, assetKey } = await seedProject();
    expect(storage.objects.has(assetKey)).toBe(true);
    await expect(requestProjectDeletion(db, bob.id, projectId)).rejects.toBeInstanceOf(NotFoundError);
    await requestProjectDeletion(db, alice.id, projectId);
    expect(await getProjectAccess(db, alice.id, projectId)).toBeNull();
    await expect(exportProjectData(db, alice.id, projectId)).rejects.toBeInstanceOf(NotFoundError);

    await runQueuedJobs(db, { projectId, limit: 10 });
    expect(storage.objects.has(assetKey)).toBe(false);
    expect(await db.query.memoirProjects.findFirst({ where: eq(memoirProjects.id, projectId) })).toBeUndefined();
    expect(await db.select().from(interviewTurns).where(eq(interviewTurns.projectId, projectId))).toHaveLength(0);
    expect(await db.select().from(mediaAssets).where(eq(mediaAssets.projectId, projectId))).toHaveLength(0);
    const jobs = await db.select().from(processingJobs).where(eq(processingJobs.projectId, projectId));
    expect(jobs).toHaveLength(0);
  });

  it("retries the purge when storage deletion fails, leaving nothing half-done", async () => {
    const { projectId, assetKey } = await seedProject();
    const original = storage.delete.bind(storage);
    storage.delete = async () => { throw new Error("storage down"); };
    await requestProjectDeletion(db, alice.id, projectId);
    await expect(purgeDeletedProject(db, projectId)).rejects.toThrow(/retry/);
    expect(await db.query.memoirProjects.findFirst({ where: eq(memoirProjects.id, projectId) })).toBeDefined();
    storage.delete = original;
    await purgeDeletedProject(db, projectId);
    expect(storage.objects.has(assetKey)).toBe(false);
    expect(await db.query.memoirProjects.findFirst({ where: eq(memoirProjects.id, projectId) })).toBeUndefined();
  });
});

describe("audio retention", () => {
  it("expires audio past its retention date but keeps the transcript", async () => {
    const { projectId, assetKey } = await seedProject();
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.projectId, projectId));
    await db.update(mediaAssets).set({ retainUntil: new Date(Date.now() - 1000) }).where(eq(mediaAssets.id, asset.id));
    const expired = await expireRetainedAudio(db);
    expect(expired).toBeGreaterThanOrEqual(1);
    expect(storage.objects.has(assetKey)).toBe(false);
    const [after] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id));
    expect(after.deletedAt).not.toBeNull();
    expect(after.transcriptText).toContain("Leeds");
    const turn = await db.query.interviewTurns.findFirst({ where: eq(interviewTurns.projectId, projectId) });
    const answer = (await db.select().from(interviewTurns).where(eq(interviewTurns.projectId, projectId))).find((t) => t.speakerType === "narrator");
    expect(answer?.originalText).toContain("Leeds");
    expect(turn).toBeDefined();
  });

  it("exports every answer and revision for the owner", async () => {
    const { projectId } = await seedProject();
    const data = await exportProjectData(db, alice.id, projectId);
    expect(data.format).toBe("lifestory.project.v1");
    expect(data.turns.some((t) => t.originalText.includes("Leeds"))).toBe(true);
    expect(data.recordings).toHaveLength(1);
    expect(data.consents.some((c) => c.consentType === "audio_recording")).toBe(true);
  });
});
