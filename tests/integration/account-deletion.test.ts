import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { createTestUser, setupTestDb, teardownTestDb } from "../helpers/db";
import { getAuth } from "@/lib/auth";
import { createProject } from "@/server/projects";
import { startOrResumeSession } from "@/server/interviews";
import { storeRecording } from "@/server/media";
import { requestProjectDeletion, purgeDeletedProject } from "@/server/deletion";
import { __setStorageForTests, type StorageProvider } from "@/server/storage";
import { __setTranscriptionForTests, FixtureTranscription } from "@/server/transcription";
import { mediaAssets, memoirProjects, users } from "@/db/schema";

class MemoryStorage implements StorageProvider {
  readonly name = "memory";
  objects = new Map<string, Uint8Array>();
  failDeletes = false;
  async put(key: string, body: Uint8Array) { this.objects.set(key, body); }
  async get(key: string) { const b = this.objects.get(key); return b ? { body: b, contentType: "audio/webm", size: b.length } : null; }
  async delete(key: string) { if (this.failDeletes) throw new Error("storage down"); this.objects.delete(key); }
}

const PASSWORD = "correct-horse-battery";
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from("FIXTURE:hello"), ...new Array(40).fill(0)]);
let db: Database;
const storage = new MemoryStorage();

beforeAll(async () => {
  process.env.AI_PROVIDER = "none";
  db = await setupTestDb();
  __setStorageForTests(storage);
  __setTranscriptionForTests(new FixtureTranscription());
});
afterEach(() => {
  storage.failDeletes = false;
  delete process.env.VERCEL;
  process.env.STORAGE_PROVIDER = "local";
  __setStorageForTests(storage);
});
afterAll(async () => {
  __setStorageForTests(null);
  __setTranscriptionForTests(null);
  await teardownTestDb();
});

async function userWithRecordings(projects = 2) {
  const user = await createTestUser("Owner");
  const keys: string[] = [];
  const ids: string[] = [];
  for (let i = 0; i < projects; i += 1) {
    const { id } = await createProject(db, user.id, { title: `P${i}`, narratorName: "Owner", narratorIsUser: "yes", intendedScope: "full_life", scopeDescription: "", writingStyle: "warm_literary", topicsToAvoid: [], acknowledgePrivacy: "on" });
    const { session } = await startOrResumeSession(db, user.id, id);
    const rec = await storeRecording(db, user.id, id, session.id, { bytes: webm, mimeType: "audio/webm", durationSeconds: 2 });
    keys.push(rec.asset.storageKey);
    ids.push(id);
  }
  return { user, keys, ids };
}

async function deleteAccount(headers: Headers) {
  const auth = await getAuth();
  return auth.api.deleteUser({ body: { password: PASSWORD }, headers });
}

describe("account deletion", () => {
  it("removes every recording from storage before the cascade, including already soft-deleted projects", async () => {
    const { user, keys, ids } = await userWithRecordings(2);
    // One project was deleted earlier but its purge job never ran.
    await requestProjectDeletion(db, user.id, ids[0]);
    expect(keys.every((k) => storage.objects.has(k))).toBe(true);

    await deleteAccount(user.headers);

    expect(keys.some((k) => storage.objects.has(k))).toBe(false);
    expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
    for (const id of ids) {
      expect(await db.select().from(memoirProjects).where(eq(memoirProjects.id, id))).toHaveLength(0);
      expect(await db.select().from(mediaAssets).where(eq(mediaAssets.projectId, id))).toHaveLength(0);
    }
  });

  it("aborts without losing references when storage deletion fails, and a retry completes", async () => {
    const { user, keys, ids } = await userWithRecordings(1);
    storage.failDeletes = true;
    await expect(deleteAccount(user.headers)).rejects.toBeTruthy();

    expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(1);
    const [project] = await db.select().from(memoirProjects).where(eq(memoirProjects.id, ids[0]));
    expect(project.deletedAt).not.toBeNull();
    const assets = await db.select().from(mediaAssets).where(eq(mediaAssets.projectId, ids[0]));
    expect(assets.map((a) => a.storageKey)).toEqual(keys);
    expect(storage.objects.has(keys[0])).toBe(true);

    storage.failDeletes = false;
    await deleteAccount(user.headers);
    expect(storage.objects.has(keys[0])).toBe(false);
    expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
  });

  it("works where no storage provider is configured if there are no recordings", async () => {
    const user = await createTestUser("NoAudio");
    const { id } = await createProject(db, user.id, { title: "Typed only", narratorName: "N", narratorIsUser: "yes", intendedScope: "full_life", scopeDescription: "", writingStyle: "warm_literary", topicsToAvoid: [], acknowledgePrivacy: "on" });
    // Simulate production without a Blob store: getStorage() throws.
    process.env.VERCEL = "1";
    process.env.STORAGE_PROVIDER = "vercel-blob";
    __setStorageForTests(null);
    await requestProjectDeletion(db, user.id, id);
    await expect(purgeDeletedProject(db, id)).resolves.toMatchObject({ removed: 0 });
    await deleteAccount(user.headers);
    expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
  });
});
