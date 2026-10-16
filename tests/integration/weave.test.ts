import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getPayloadFromClientToken, handleUpload } from "@vercel/blob/client";
import type { Database } from "@/db";
import { auditEvents, consentRecords, mediaAssets, memoirProjects, weaveParticipants, weaveRecordings, weaves } from "@/db/schema";
import { createTestUser, setupTestDb, teardownTestDb } from "../helpers/db";
import { createProject } from "@/server/projects";
import { __setStorageForTests, type StorageProvider } from "@/server/storage";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { expireRetainedAudio, purgeAllOwnedProjects, purgeDeletedProject, requestProjectDeletion } from "@/server/deletion";
import { exportProjectData } from "@/server/export/project-data";
import { deleteAssetAudio, readAsset, retryTranscription } from "@/server/media";
import { startOrResumeSession, submitAnswer } from "@/server/interviews";
import {
  authorizeDirectUpload,
  completeRecording,
  createWeave,
  deleteRecording,
  deleteWeave,
  getRecordingPlayback,
  getWeaveDetail,
  grantPresignedUpload,
  listWeaves,
  reserveRecording,
  updateRecordingDetails,
  updateWeave,
  uploadRecordingContent,
} from "@/server/weave/service";

/** In-memory stand-in for private storage. `direct` mimics Vercel Blob (browser uploads + signed reads). */
class MemoryStorage implements StorageProvider {
  readonly name = "memory";
  objects = new Map<string, { body: Uint8Array; contentType: string }>();
  supportsDirectUpload = false;
  failDeletes = false;
  signed: string[] = [];
  async put(key: string, body: Uint8Array, contentType: string) { this.objects.set(key, { body, contentType }); }
  async get(key: string) { const o = this.objects.get(key); return o ? { body: o.body, contentType: o.contentType, size: o.body.length } : null; }
  async delete(key: string) { if (this.failDeletes) throw new Error("storage down"); this.objects.delete(key); }
  async stat(key: string) { const o = this.objects.get(key); return o ? { size: o.body.length, contentType: o.contentType } : null; }
  async readRange(key: string, start: number, end: number) { const o = this.objects.get(key); return o ? o.body.slice(start, end + 1) : null; }
  signedReadUrl?: (key: string, ttl: number) => Promise<string>;
  directUploadFlow?: "client-token" | "presigned";
  uploadGrants: { key: string; limits: { allowedContentTypes: string[]; maximumSizeInBytes: number; validUntil: number } }[] = [];
  async signedUploadToken(key: string, limits: { allowedContentTypes: string[]; maximumSizeInBytes: number; validUntil: number }) {
    this.uploadGrants.push({ key, limits });
    return { delegationToken: `test-delegation-${key}`, clientSigningToken: "test-signing", validUntil: limits.validUntil };
  }
}

const M4A = new Uint8Array([0, 0, 0, 0x20, ...Buffer.from("ftypM4A "), ...new Array(200).fill(7)]);
const MP3 = new Uint8Array([...Buffer.from("ID3"), 4, 0, 0, ...new Array(200).fill(1)]);
const HTML = new Uint8Array(Buffer.from("<!doctype html><script>alert(1)</script>".padEnd(120, " ")));

let db: Database;
let alice: { id: string };
let bob: { id: string };
const storage = new MemoryStorage();
let n = 0;
const uploadId = () => `upload-${Date.now()}-${++n}`;

beforeAll(async () => {
  process.env.STORAGE_PROVIDER = "local";
  db = await setupTestDb();
  __setStorageForTests(storage);
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
});

afterAll(async () => {
  __setStorageForTests(null);
  delete process.env.WEAVE_ENABLED;
  await teardownTestDb();
});

beforeEach(() => {
  process.env.WEAVE_ENABLED = "1";
  storage.supportsDirectUpload = false;
  storage.failDeletes = false;
  storage.signedReadUrl = undefined;
  storage.directUploadFlow = undefined;
  storage.uploadGrants = [];
});

afterEach(() => {
  delete process.env.UPLOAD_SNIFF_DISABLED;
});

async function newProject(userId = alice.id) {
  return (await createProject(db, userId, { title: "Family", narratorName: "Alice", narratorIsUser: "yes", intendedScope: "full_life", scopeDescription: "", writingStyle: "warm_literary", topicsToAvoid: [], acknowledgePrivacy: "on" })).id;
}

async function newWeave(projectId: string, userId = alice.id) {
  return createWeave(db, userId, projectId, {
    title: "Farm years",
    contextNote: "Kitchen table, 1998",
    participantConsent: true,
    participants: [{ displayName: "Alice", isAccountHolder: true }, { displayName: "June", isAccountHolder: false }],
  });
}

/** Reserve -> server upload -> complete, as the local/dev path does it. */
async function addRecording(projectId: string, weaveId: string, bytes = M4A, mimeType = "audio/mp4", filename = "talk.m4a") {
  const clientUploadId = uploadId();
  const { recording } = await reserveRecording(db, alice.id, projectId, weaveId, { clientUploadId, filename, mimeType, size: bytes.length, durationSeconds: 61.4 });
  await uploadRecordingContent(db, alice.id, projectId, weaveId, recording.id, bytes);
  return { clientUploadId, recording: await completeRecording(db, alice.id, projectId, weaveId, recording.id) };
}

async function assetFor(recordingId: string) {
  const rec = await db.query.weaveRecordings.findFirst({ where: eq(weaveRecordings.id, recordingId) });
  return (await db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, rec!.mediaAssetId) }))!;
}

describe("feature flag", () => {
  it("makes every weave entry point not-found while WEAVE_ENABLED is off", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    delete process.env.WEAVE_ENABLED;
    await expect(listWeaves(db, alice.id, projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(newWeave(projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getWeaveDetail(db, alice.id, projectId, weave.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "a.m4a", mimeType: "audio/mp4", size: 10 })).rejects.toBeInstanceOf(NotFoundError);
    process.env.WEAVE_ENABLED = "false";
    await expect(listWeaves(db, alice.id, projectId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("weaves", () => {
  it("creates a weave with participants, a consent record and an audit entry", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const detail = await getWeaveDetail(db, alice.id, projectId, weave.id);
    expect(detail.participants.map((p) => p.displayName)).toEqual(["Alice", "June"]);
    const consents = await db.select().from(consentRecords).where(and(eq(consentRecords.projectId, projectId), eq(consentRecords.policyVersion, "weave-participants-v1")));
    expect(consents).toHaveLength(1);
    const audits = await db.select().from(auditEvents).where(and(eq(auditEvents.projectId, projectId), eq(auditEvents.actionType, "weave.create")));
    expect(audits).toHaveLength(1);
    await updateWeave(db, alice.id, projectId, weave.id, { title: "Farm years, part one", participants: [{ displayName: "Alice", isAccountHolder: true }, { displayName: "June", isAccountHolder: false }, { displayName: "Ray", isAccountHolder: false }] });
    const updated = await getWeaveDetail(db, alice.id, projectId, weave.id);
    expect(updated.weave.title).toBe("Farm years, part one");
    expect(updated.participants).toHaveLength(3);
  });

  it("refuses to link people from another project", async () => {
    const projectId = await newProject();
    await expect(
      createWeave(db, alice.id, projectId, { title: "x", contextNote: "", participantConsent: true, participants: [{ displayName: "A", isAccountHolder: true }, { displayName: "B", personId: crypto.randomUUID(), isAccountHolder: false }] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("authorization isolation", () => {
  it("hides one user's weaves, recordings and audio from another user", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await addRecording(projectId, weave.id);
    await expect(listWeaves(db, bob.id, projectId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getWeaveDetail(db, bob.id, projectId, weave.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(newWeave(projectId, bob.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reserveRecording(db, bob.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "a.m4a", mimeType: "audio/mp4", size: 10 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(completeRecording(db, bob.id, projectId, weave.id, recording.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRecordingPlayback(db, bob.id, projectId, weave.id, recording.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteRecording(db, bob.id, projectId, weave.id, recording.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteWeave(db, bob.id, projectId, weave.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(authorizeDirectUpload(db, bob.id, projectId, weave.id, "x", JSON.stringify({ recordingId: recording.id }))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not resolve a weave or recording through another project's id", async () => {
    const projectA = await newProject();
    const weaveA = await newWeave(projectA);
    const { recording } = await addRecording(projectA, weaveA.id);
    // Bob owns project B; Alice's ids must not work there even for Bob.
    const projectB = await newProject(bob.id);
    const weaveB = await newWeave(projectB, bob.id);
    await expect(getWeaveDetail(db, bob.id, projectB, weaveA.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRecordingPlayback(db, bob.id, projectB, weaveB.id, recording.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getWeaveDetail(db, alice.id, projectA, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("separation from interview recordings", () => {
  it("keeps weave originals out of the interview media routes", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await addRecording(projectId, weave.id);
    const asset = await assetFor(recording.id);
    await expect(readAsset(db, alice.id, projectId, asset.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(retryTranscription(db, alice.id, projectId, asset.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteAssetAudio(db, alice.id, projectId, asset.id)).rejects.toBeInstanceOf(NotFoundError);
    const { session } = await startOrResumeSession(db, alice.id, projectId);
    await expect(submitAnswer(db, alice.id, projectId, session.id, { text: "hello", inputMode: "voice", clientTurnId: "weave-attach-1", mediaAssetId: asset.id })).rejects.toBeInstanceOf(NotFoundError);
    const after = await assetFor(recording.id);
    expect(after.deletedAt).toBeNull();
    expect(after.interviewTurnId).toBeNull();
    expect(storage.objects.has(asset.storageKey)).toBe(true);
  });
});

describe("uploads", () => {
  it("stores a verified original that is retention-exempt and immutable", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await addRecording(projectId, weave.id);
    expect(recording.status).toBe("uploaded");
    expect(recording.durationSeconds).toBe(61);
    const asset = await assetFor(recording.id);
    expect(asset.purpose).toBe("weave_source");
    expect(asset.retentionExempt).toBe(true);
    expect(asset.retainUntil).toBeNull();
    expect(asset.processingStatus).toBe("uploaded");
    expect(asset.storageKey).toBe(`projects/${projectId}/weaves/${weave.id}/${asset.id}.m4a`);
    // No overwrite after completion, by either path.
    await expect(uploadRecordingContent(db, alice.id, projectId, weave.id, recording.id, MP3)).rejects.toMatchObject({ code: "already_uploaded" });
    await expect(authorizeDirectUpload(db, alice.id, projectId, weave.id, asset.storageKey, JSON.stringify({ recordingId: recording.id }))).rejects.toMatchObject({ code: "already_uploaded" });
    expect(storage.objects.get(asset.storageKey)?.body).toEqual(M4A);
  });

  it("rejects spoofed formats, deletes the object and allows a clean retry", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const clientUploadId = uploadId();
    const { recording } = await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId, filename: "talk.m4a", mimeType: "audio/mp4", size: HTML.length });
    await uploadRecordingContent(db, alice.id, projectId, weave.id, recording.id, HTML);
    await expect(completeRecording(db, alice.id, projectId, weave.id, recording.id)).rejects.toBeInstanceOf(ValidationError);
    const asset = await assetFor(recording.id);
    expect(storage.objects.has(asset.storageKey)).toBe(false);
    expect(asset.processingStatus).toBe("failed");
    const failed = await db.query.weaveRecordings.findFirst({ where: eq(weaveRecordings.id, recording.id) });
    expect(failed?.status).toBe("failed");
    expect(failed?.failureCode).toBe("unrecognized_format");
    await expect(getRecordingPlayback(db, alice.id, projectId, weave.id, recording.id)).rejects.toBeInstanceOf(NotFoundError);

    // Retrying the same file id resumes the same slot.
    const again = await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId, filename: "talk.m4a", mimeType: "audio/mp4", size: HTML.length });
    expect(again.recording.id).toBe(recording.id);
    expect(again.upload).toEqual({ mode: "server", contentType: "audio/mp4" });
    const real = M4A.slice(0, HTML.length);
    await uploadRecordingContent(db, alice.id, projectId, weave.id, recording.id, real);
    const done = await completeRecording(db, alice.id, projectId, weave.id, recording.id);
    expect(done.status).toBe("uploaded");
    expect(done.failureCode).toBeNull();
  });

  it("rejects disallowed types, oversize files and objects larger than declared", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    await expect(reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "page.html", mimeType: "text/html", size: 10 })).rejects.toBeInstanceOf(ValidationError);
    await expect(reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "big.m4a", mimeType: "audio/mp4", size: 3000 * 1024 * 1024 })).rejects.toBeInstanceOf(ValidationError);
    const { recording } = await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "small.m4a", mimeType: "audio/mp4", size: 20 });
    await expect(uploadRecordingContent(db, alice.id, projectId, weave.id, recording.id, M4A)).rejects.toBeInstanceOf(ValidationError);
    // An object that grew past its declaration (e.g. written with a stolen token) is rejected on completion.
    const asset = await assetFor(recording.id);
    await storage.put(asset.storageKey, M4A, "audio/mp4");
    await expect(completeRecording(db, alice.id, projectId, weave.id, recording.id)).rejects.toThrow(/larger than allowed/);
    expect(storage.objects.has(asset.storageKey)).toBe(false);
  });

  it("reports an incomplete upload without changing state", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "a.mp3", mimeType: "audio/mpeg", size: MP3.length });
    await expect(completeRecording(db, alice.id, projectId, weave.id, recording.id)).rejects.toMatchObject({ code: "upload_incomplete", status: 409 });
    const row = await db.query.weaveRecordings.findFirst({ where: eq(weaveRecordings.id, recording.id) });
    expect(row?.status).toBe("awaiting_upload");
  });

  it("is idempotent for repeated reservations and completions", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { clientUploadId, recording } = await addRecording(projectId, weave.id, MP3, "audio/mpeg", "a.mp3");
    const again = await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId, filename: "a.mp3", mimeType: "audio/mpeg", size: MP3.length });
    expect(again.recording.id).toBe(recording.id);
    expect(again.upload).toBeNull();
    const [c1, c2] = await Promise.all([
      completeRecording(db, alice.id, projectId, weave.id, recording.id),
      completeRecording(db, alice.id, projectId, weave.id, recording.id),
    ]);
    expect(c1.status).toBe("uploaded");
    expect(c2.status).toBe("uploaded");
    const rows = await db.select().from(weaveRecordings).where(eq(weaveRecordings.weaveId, weave.id));
    expect(rows).toHaveLength(1);
    const audits = await db.select().from(auditEvents).where(and(eq(auditEvents.targetId, recording.id), eq(auditEvents.actionType, "weave.recording_uploaded")));
    expect(audits).toHaveLength(1);
  });

  it("enforces the per-conversation recording limit", async () => {
    process.env.MAX_WEAVE_RECORDINGS = "2";
    try {
      const projectId = await newProject();
      const weave = await newWeave(projectId);
      await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "1.m4a", mimeType: "audio/mp4", size: 10 });
      await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "2.m4a", mimeType: "audio/mp4", size: 10 });
      await expect(reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "3.m4a", mimeType: "audio/mp4", size: 10 })).rejects.toThrow(/up to 2 recordings/);
    } finally {
      delete process.env.MAX_WEAVE_RECORDINGS;
    }
  });
});

describe("direct uploads (Blob-style storage)", () => {
  it("issues a client token bound to the reserved path, type and size", async () => {
    storage.supportsDirectUpload = true;
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording, upload } = await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "Voice Memo.m4a", mimeType: "", size: M4A.length });
    expect(upload?.mode).toBe("direct");
    const pathname = upload!.mode === "direct" ? upload!.pathname : "";
    const asset = await assetFor(recording.id);
    expect(pathname).toBe(asset.storageKey);

    // Real SDK token generation (local HMAC) with a test-only token; no network.
    const result = await handleUpload({
      request: new Request("http://localhost/api/x", { method: "POST" }),
      token: "vercel_blob_rw_teststore_notarealsecret",
      body: { type: "blob.generate-client-token", payload: { pathname, clientPayload: JSON.stringify({ recordingId: recording.id }), multipart: false } },
      onBeforeGenerateToken: (p, payload) => authorizeDirectUpload(db, alice.id, projectId, weave.id, p, payload),
    });
    expect(result.type).toBe("blob.generate-client-token");
    const decoded = getPayloadFromClientToken((result as { clientToken: string }).clientToken);
    expect(decoded.pathname).toBe(asset.storageKey);
    expect(decoded.allowedContentTypes).toEqual(["audio/mp4"]);
    expect(decoded.maximumSizeInBytes).toBe(M4A.length);
    expect(decoded.addRandomSuffix).toBe(false);
    expect(decoded.onUploadCompleted).toBeUndefined();
    expect(decoded.validUntil).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);

    // The server path is refused when storage takes direct uploads.
    await expect(uploadRecordingContent(db, alice.id, projectId, weave.id, recording.id, M4A)).rejects.toMatchObject({ code: "direct_upload_required" });
    // Simulate the browser's direct upload, then complete.
    await storage.put(asset.storageKey, M4A, "audio/mp4");
    expect((await completeRecording(db, alice.id, projectId, weave.id, recording.id)).status).toBe("uploaded");
  });

  it("refuses tokens for other paths or malformed payloads", async () => {
    storage.supportsDirectUpload = true;
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "a.m4a", mimeType: "audio/mp4", size: 100 });
    const payload = JSON.stringify({ recordingId: recording.id });
    await expect(authorizeDirectUpload(db, alice.id, projectId, weave.id, `projects/${projectId}/recordings/other.m4a`, payload)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(authorizeDirectUpload(db, alice.id, projectId, weave.id, "anything", "not json")).rejects.toBeInstanceOf(ValidationError);
    await expect(authorizeDirectUpload(db, alice.id, projectId, weave.id, "anything", null)).rejects.toBeInstanceOf(ValidationError);
    const other = await newWeave(projectId);
    await expect(authorizeDirectUpload(db, alice.id, projectId, other.id, "anything", payload)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("OIDC flow: issues a write-only delegation bound to the reserved path, type and size", async () => {
    storage.supportsDirectUpload = true;
    storage.directUploadFlow = "presigned";
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording, upload } = await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "memo.m4a", mimeType: "audio/x-m4a", size: M4A.length });
    expect(upload).toMatchObject({ mode: "direct", flow: "presigned" });
    const asset = await assetFor(recording.id);
    const payload = JSON.stringify({ recordingId: recording.id });
    const before = Date.now();
    const grant = await grantPresignedUpload(db, alice.id, projectId, weave.id, asset.storageKey, payload);
    expect(storage.uploadGrants).toHaveLength(1);
    expect(storage.uploadGrants[0].key).toBe(asset.storageKey);
    expect(storage.uploadGrants[0].limits).toMatchObject({ allowedContentTypes: ["audio/x-m4a"], maximumSizeInBytes: M4A.length });
    expect(grant.urlOptions).toMatchObject({ allowedContentTypes: ["audio/x-m4a"], maximumSizeInBytes: M4A.length, addRandomSuffix: false, allowOverwrite: true, tokenPayload: recording.id });
    expect(grant.urlOptions.validUntil).toBeGreaterThan(before);
    expect(grant.urlOptions.validUntil).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);

    // Same refusals as the client-token flow; no delegation is issued for them.
    await expect(grantPresignedUpload(db, alice.id, projectId, weave.id, `projects/${projectId}/recordings/x.m4a`, payload)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(grantPresignedUpload(db, bob.id, projectId, weave.id, asset.storageKey, payload)).rejects.toBeInstanceOf(NotFoundError);
    await storage.put(asset.storageKey, M4A, "audio/x-m4a");
    await completeRecording(db, alice.id, projectId, weave.id, recording.id);
    await expect(grantPresignedUpload(db, alice.id, projectId, weave.id, asset.storageKey, payload)).rejects.toMatchObject({ code: "already_uploaded" });
    expect(storage.uploadGrants).toHaveLength(1);
  });

  it("refuses a presigned grant when storage uses client tokens", async () => {
    storage.supportsDirectUpload = true;
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording, upload } = await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "a.m4a", mimeType: "audio/mp4", size: 100 });
    expect(upload).toMatchObject({ mode: "direct", flow: "client-token" });
    const asset = await assetFor(recording.id);
    await expect(grantPresignedUpload(db, alice.id, projectId, weave.id, asset.storageKey, JSON.stringify({ recordingId: recording.id }))).rejects.toMatchObject({ code: "direct_upload_unavailable" });
  });

  it("plays back through a short-lived signed link when storage offers one", async () => {
    storage.supportsDirectUpload = true;
    storage.signedReadUrl = async (key, ttl) => `https://store.private.blob.example/${key}?ttl=${ttl}`;
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "a.m4a", mimeType: "audio/mp4", size: M4A.length });
    const asset = await assetFor(recording.id);
    await storage.put(asset.storageKey, M4A, "audio/mp4");
    await completeRecording(db, alice.id, projectId, weave.id, recording.id);
    const target = await getRecordingPlayback(db, alice.id, projectId, weave.id, recording.id);
    expect(target).toEqual({ kind: "redirect", url: `https://store.private.blob.example/${asset.storageKey}?ttl=300` });
  });
});

describe("playback without signed links", () => {
  it("returns a local target for Range streaming", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await addRecording(projectId, weave.id);
    const target = await getRecordingPlayback(db, alice.id, projectId, weave.id, recording.id);
    expect(target).toMatchObject({ kind: "local", size: M4A.length, contentType: "audio/mp4" });
  });
});

describe("retention", () => {
  it("never expires weave originals while interview audio still expires", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await addRecording(projectId, weave.id);
    const weaveAsset = await assetFor(recording.id);
    const past = new Date(Date.now() - 86_400_000);
    // Even a past retainUntil (which weave assets never get) must not expire an exempt original.
    await db.update(mediaAssets).set({ retainUntil: past }).where(eq(mediaAssets.id, weaveAsset.id));
    const interviewKey = `projects/${projectId}/recordings/expiring.webm`;
    await storage.put(interviewKey, new Uint8Array([1]), "audio/webm");
    const [interviewAsset] = await db
      .insert(mediaAssets)
      .values({ projectId, uploadedByUserId: alice.id, storageKey: interviewKey, storageProvider: "memory", mediaType: "audio/webm", processingStatus: "uploaded", retainUntil: past })
      .returning();
    expect(interviewAsset.purpose).toBe("interview_answer");
    expect(interviewAsset.retentionExempt).toBe(false);

    await expireRetainedAudio(db, 500);
    expect((await db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, interviewAsset.id) }))?.deletedAt).not.toBeNull();
    expect(storage.objects.has(interviewKey)).toBe(false);
    expect((await db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, weaveAsset.id) }))?.deletedAt).toBeNull();
    expect(storage.objects.has(weaveAsset.storageKey)).toBe(true);
  });
});

describe("recording details and deletion", () => {
  it("updates date and notes", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await addRecording(projectId, weave.id);
    const updated = await updateRecordingDetails(db, alice.id, projectId, weave.id, recording.id, { recordedOn: "1998-07-04", recordedOnPrecision: "month", contextNote: "After the harvest" });
    expect(updated).toMatchObject({ recordedOn: "1998-07-04", recordedOnPrecision: "month", contextNote: "After the harvest" });
  });

  it("deletes one recording from storage, and keeps the row when storage fails", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await addRecording(projectId, weave.id);
    const asset = await assetFor(recording.id);
    storage.failDeletes = true;
    await expect(deleteRecording(db, alice.id, projectId, weave.id, recording.id)).rejects.toMatchObject({ code: "delete_failed" });
    expect((await getWeaveDetail(db, alice.id, projectId, weave.id)).recordings).toHaveLength(1);
    storage.failDeletes = false;
    await deleteRecording(db, alice.id, projectId, weave.id, recording.id);
    expect(storage.objects.has(asset.storageKey)).toBe(false);
    expect((await getWeaveDetail(db, alice.id, projectId, weave.id)).recordings).toHaveLength(0);
    expect((await assetFor(recording.id)).deletedAt).not.toBeNull();
  });

  it("deletes a weave with all originals, including abandoned uploads", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await addRecording(projectId, weave.id);
    // Uploaded by the browser but never completed.
    const abandoned = await reserveRecording(db, alice.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "b.m4a", mimeType: "audio/mp4", size: M4A.length });
    const abandonedAsset = await assetFor(abandoned.recording.id);
    await storage.put(abandonedAsset.storageKey, M4A, "audio/mp4");
    const keys = [(await assetFor(recording.id)).storageKey, abandonedAsset.storageKey];

    storage.failDeletes = true;
    await expect(deleteWeave(db, alice.id, projectId, weave.id)).rejects.toBeInstanceOf(AppError);
    expect(await getWeaveDetail(db, alice.id, projectId, weave.id)).toBeTruthy();
    storage.failDeletes = false;

    const result = await deleteWeave(db, alice.id, projectId, weave.id);
    expect(result.removed).toBe(2);
    for (const key of keys) expect(storage.objects.has(key)).toBe(false);
    expect(await db.query.weaves.findFirst({ where: eq(weaves.id, weave.id) })).toBeUndefined();
    expect(await db.select().from(weaveParticipants).where(eq(weaveParticipants.weaveId, weave.id))).toHaveLength(0);
    expect(await db.select().from(weaveRecordings).where(eq(weaveRecordings.weaveId, weave.id))).toHaveLength(0);
  });

  it("purges weave originals when the project is deleted", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await addRecording(projectId, weave.id);
    const key = (await assetFor(recording.id)).storageKey;
    await requestProjectDeletion(db, alice.id, projectId);
    await purgeDeletedProject(db, projectId);
    expect(storage.objects.has(key)).toBe(false);
    expect(await db.query.memoirProjects.findFirst({ where: eq(memoirProjects.id, projectId) })).toBeUndefined();
    expect(await db.select().from(weaves).where(eq(weaves.projectId, projectId))).toHaveLength(0);
  });

  it("purges weave originals when the account is deleted, even with the flag off", async () => {
    const carol = await createTestUser("Carol");
    const projectId = await newProject(carol.id);
    const weave = await newWeave(projectId, carol.id);
    const { recording } = await reserveRecording(db, carol.id, projectId, weave.id, { clientUploadId: uploadId(), filename: "a.m4a", mimeType: "audio/mp4", size: M4A.length });
    await uploadRecordingContent(db, carol.id, projectId, weave.id, recording.id, M4A);
    await completeRecording(db, carol.id, projectId, weave.id, recording.id);
    const key = (await assetFor(recording.id)).storageKey;
    delete process.env.WEAVE_ENABLED;
    await purgeAllOwnedProjects(db, carol.id);
    expect(storage.objects.has(key)).toBe(false);
  });
});

describe("export", () => {
  it("includes weaves, participants and recording metadata, never storage keys", async () => {
    const projectId = await newProject();
    const weave = await newWeave(projectId);
    const { recording } = await addRecording(projectId, weave.id);
    const data = await exportProjectData(db, alice.id, projectId);
    expect(data.weaves).toHaveLength(1);
    expect(data.weaves[0]).toMatchObject({ id: weave.id, title: "Farm years", contextNote: "Kitchen table, 1998" });
    expect(data.weaves[0].participants.map((p) => p.displayName)).toEqual(["Alice", "June"]);
    expect(data.weaves[0].recordings[0]).toMatchObject({ id: recording.id, originalFilename: "talk.m4a", mimeType: "audio/mp4", status: "uploaded" });
    const media = data.recordings.find((r) => r.purpose === "weave_source");
    expect(media).toMatchObject({ originalFilename: "talk.m4a", retentionExempt: true });
    expect(JSON.stringify(data)).not.toContain(`/weaves/${weave.id}/`);
    // Still exported after the feature is switched off: nothing the user made is withheld.
    delete process.env.WEAVE_ENABLED;
    expect((await exportProjectData(db, alice.id, projectId)).weaves).toHaveLength(1);
  });
});
