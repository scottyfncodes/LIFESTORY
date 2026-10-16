import { and, eq } from "drizzle-orm";
import type { DbClient } from "@/db";
import { consentRecords, interviewSessions, mediaAssets } from "@/db/schema";
import { bytesMatchAudioType } from "./upload-sniff";
import { POLICY_VERSION } from "./projects";
import { recordAudit } from "./audit";
import { requireProjectAccess } from "./authz";
import { limits } from "./config";
import { AppError, NotFoundError, ValidationError } from "./errors";
import { errorCode, log } from "./logger";
import { buildMediaKey, getStorage, isStorageAvailable } from "./storage";
import { getTranscriptionProvider } from "./transcription";

export const ALLOWED_AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
};

export function normalizeAudioType(mimeType: string): { base: string; extension: string } | null {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  const extension = ALLOWED_AUDIO_TYPES[base];
  return extension ? { base, extension } : null;
}

export type MediaAsset = typeof mediaAssets.$inferSelect;

/**
 * Stores a recording privately and, when a transcription provider is
 * configured, transcribes it. The upload is durable even if transcription
 * fails; the asset then carries a failed status the user can retry.
 */
export async function storeRecording(
  db: DbClient,
  userId: string,
  projectId: string,
  sessionId: string,
  file: { bytes: Uint8Array; mimeType: string; durationSeconds: number | null },
): Promise<{ asset: MediaAsset; transcript: string | null; transcriptionError: string | null; transcriptionAvailable: boolean }> {
  const access = await requireProjectAccess(db, userId, projectId, "interview:write");
  const session = await db.query.interviewSessions.findFirst({ where: and(eq(interviewSessions.id, sessionId), eq(interviewSessions.projectId, projectId)) });
  if (!session) throw new NotFoundError("We couldn't find that interview session.");
  if (!isStorageAvailable()) {
    throw new AppError("storage_unavailable", "Recordings can't be stored on this server yet. You can still type your answer, or use on-device dictation.", 503);
  }
  const type = normalizeAudioType(file.mimeType);
  if (!type) throw new ValidationError("That recording format isn't supported.");
  const { maxUploadBytes, maxRecordingSeconds } = limits();
  if (file.bytes.length === 0) throw new ValidationError("The recording was empty.");
  if (file.bytes.length > maxUploadBytes) throw new ValidationError("That recording is too large. Try a shorter answer.");
  if (file.durationSeconds !== null && file.durationSeconds > maxRecordingSeconds + 5) {
    throw new ValidationError("That recording is longer than the allowed limit.");
  }
  if (process.env.UPLOAD_SNIFF_DISABLED !== "1" && !bytesMatchAudioType(file.bytes, type.base)) {
    throw new ValidationError("That file doesn't look like a recording we can accept.");
  }
  await recordRecordingConsent(db, projectId, userId);

  const retainDays = access.project.privacySettings.retainAudioDays;
  const retainUntil = retainDays ? new Date(Date.now() + retainDays * 86_400_000) : null;

  const [draft] = await db
    .insert(mediaAssets)
    .values({
      projectId,
      sessionId,
      uploadedByUserId: userId,
      storageKey: `pending/${crypto.randomUUID()}`,
      storageProvider: "pending",
      mediaType: type.base,
      processingStatus: "pending_upload",
      durationSeconds: file.durationSeconds === null ? null : Math.round(file.durationSeconds),
      fileSize: file.bytes.length,
      retainUntil,
    })
    .returning();

  const storage = await getStorage();
  const key = buildMediaKey(projectId, draft.id, type.extension);
  try {
    await storage.put(key, file.bytes, type.base);
  } catch (error) {
    await db.update(mediaAssets).set({ processingStatus: "failed", processingError: "upload_failed" }).where(eq(mediaAssets.id, draft.id));
    log.error("media.upload_failed", { assetId: draft.id, code: errorCode(error) });
    throw new AppError("upload_failed", "We couldn't store the recording. Please try again.", 502);
  }
  let [asset] = await db
    .update(mediaAssets)
    .set({ storageKey: key, storageProvider: storage.name, processingStatus: "uploaded" })
    .where(eq(mediaAssets.id, draft.id))
    .returning();
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "media.upload", targetType: "media_asset", targetId: asset.id });

  const provider = getTranscriptionProvider();
  if (!provider) return { asset, transcript: null, transcriptionError: null, transcriptionAvailable: false };

  const outcome = await transcribeAsset(db, asset, file.bytes, type.base);
  asset = outcome.asset;
  return { asset, transcript: outcome.transcript, transcriptionError: outcome.error, transcriptionAvailable: true };
}

/** First recording in a project records the narrator's recording consent once. */
async function recordRecordingConsent(db: DbClient, projectId: string, userId: string): Promise<void> {
  const existing = await db.query.consentRecords.findFirst({ where: and(eq(consentRecords.projectId, projectId), eq(consentRecords.subjectUserId, userId), eq(consentRecords.consentType, "audio_recording")) });
  if (!existing) {
    await db.insert(consentRecords).values({ projectId, subjectUserId: userId, consentType: "audio_recording", consentStatus: "granted", policyVersion: POLICY_VERSION });
  }
}

export async function transcribeAsset(
  db: DbClient,
  asset: MediaAsset,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ asset: MediaAsset; transcript: string | null; error: string | null }> {
  const provider = getTranscriptionProvider();
  if (!provider) return { asset, transcript: null, error: "Transcription is not configured." };
  await db.update(mediaAssets).set({ processingStatus: "transcribing", processingError: null }).where(eq(mediaAssets.id, asset.id));
  const started = Date.now();
  try {
    const result = await provider.transcribe({ bytes, mimeType, filename: `recording.${normalizeAudioType(mimeType)?.extension ?? "bin"}` });
    const [updated] = await db
      .update(mediaAssets)
      .set({
        processingStatus: "transcribed",
        transcriptText: result.text,
        transcriptionProvider: result.provider,
        durationSeconds: asset.durationSeconds ?? (result.durationSeconds ? Math.round(result.durationSeconds) : null),
      })
      .where(eq(mediaAssets.id, asset.id))
      .returning();
    log.info("media.transcribed", { assetId: asset.id, provider: result.provider, durationMs: Date.now() - started, chars: result.text.length });
    return { asset: updated, transcript: result.text, error: null };
  } catch (error) {
    const code = errorCode(error);
    const [updated] = await db
      .update(mediaAssets)
      .set({ processingStatus: "failed", processingError: code })
      .where(eq(mediaAssets.id, asset.id))
      .returning();
    log.warn("media.transcription_failed", { assetId: asset.id, provider: provider.name, code, durationMs: Date.now() - started });
    const message = error instanceof AppError ? error.message : "Transcription failed. Your recording is saved; you can retry or type the answer.";
    return { asset: updated, transcript: null, error: message };
  }
}

export async function retryTranscription(db: DbClient, userId: string, projectId: string, assetId: string) {
  await requireProjectAccess(db, userId, projectId, "interview:write");
  const asset = await getAssetForProject(db, projectId, assetId);
  const storage = await getStorage();
  const file = await storage.get(asset.storageKey);
  if (!file) throw new NotFoundError("The recording is no longer available.");
  const bytes = file.body instanceof Uint8Array ? file.body : new Uint8Array(await new Response(file.body).arrayBuffer());
  return transcribeAsset(db, asset, bytes, asset.mediaType);
}

/**
 * Interview recordings only. Conversation Weave originals are reachable solely
 * through the weave routes, which enforce the feature flag and immutability.
 */
export async function getAssetForProject(db: DbClient, projectId: string, assetId: string): Promise<MediaAsset> {
  const asset = await db.query.mediaAssets.findFirst({ where: and(eq(mediaAssets.id, assetId), eq(mediaAssets.projectId, projectId), eq(mediaAssets.purpose, "interview_answer")) });
  if (!asset || asset.deletedAt) throw new NotFoundError("We couldn't find that recording.");
  return asset;
}

export async function readAsset(db: DbClient, userId: string, projectId: string, assetId: string) {
  await requireProjectAccess(db, userId, projectId, "project:read");
  const asset = await getAssetForProject(db, projectId, assetId);
  if (asset.processingStatus === "pending_upload") throw new NotFoundError("The recording is not available.");
  const storage = await getStorage();
  const file = await storage.get(asset.storageKey);
  if (!file) throw new NotFoundError("The recording is no longer available.");
  return { asset, file };
}

/** Deletes the audio while keeping any confirmed transcript on the turn. */
export async function deleteAssetAudio(db: DbClient, userId: string, projectId: string, assetId: string): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "interview:write");
  const asset = await getAssetForProject(db, projectId, assetId);
  if (asset.storageProvider !== "pending") {
    const storage = await getStorage();
    await storage.delete(asset.storageKey).catch((error) => log.warn("media.delete_failed", { assetId, code: errorCode(error) }));
  }
  await db.update(mediaAssets).set({ deletedAt: new Date(), retentionStatus: "deleted" }).where(eq(mediaAssets.id, assetId));
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "media.delete", targetType: "media_asset", targetId: assetId });
}
