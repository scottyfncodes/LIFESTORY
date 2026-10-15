import { and, asc, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { DbClient } from "@/db";
import { consentRecords, mediaAssets, people, weaveParticipants, weaveRecordings, weaves } from "@/db/schema";
import {
  WEAVE_AUDIO_TYPES,
  resolveWeaveAudioType,
  uploadClientPayloadSchema,
  type CreateWeaveInput,
  type ReserveRecordingInput,
  type UpdateRecordingInput,
  type UpdateWeaveInput,
} from "@/lib/validation/weave";
import { recordAudit } from "../audit";
import { requireProjectAccess, isUuid, type Permission } from "../authz";
import { isWeaveEnabled, weaveLimits } from "../config";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { errorCode, log } from "../logger";
import { buildWeaveMediaKey, getStorage, type StorageProvider } from "../storage";
import { bytesMatchAudioType } from "../upload-sniff";

export const WEAVE_CONSENT_POLICY = "weave-participants-v1";

export type Weave = typeof weaves.$inferSelect;
export type WeaveParticipant = typeof weaveParticipants.$inferSelect;
export type WeaveRecording = typeof weaveRecordings.$inferSelect;

/** Every entry point calls this first: with the flag off the feature does not exist. */
export function assertWeaveEnabled(): void {
  if (!isWeaveEnabled()) throw new NotFoundError("We couldn't find that.");
}

async function requireWeave(db: DbClient, userId: string, projectId: string, weaveId: string, permission: Permission): Promise<Weave> {
  assertWeaveEnabled();
  await requireProjectAccess(db, userId, projectId, permission);
  if (!isUuid(weaveId)) throw new NotFoundError("We couldn't find that conversation.");
  const weave = await db.query.weaves.findFirst({ where: and(eq(weaves.id, weaveId), eq(weaves.projectId, projectId), isNull(weaves.deletedAt)) });
  if (!weave) throw new NotFoundError("We couldn't find that conversation.");
  return weave;
}

async function requireRecording(db: DbClient, weave: Weave, recordingId: string): Promise<{ recording: WeaveRecording; asset: typeof mediaAssets.$inferSelect }> {
  if (!isUuid(recordingId)) throw new NotFoundError("We couldn't find that recording.");
  const recording = await db.query.weaveRecordings.findFirst({
    where: and(eq(weaveRecordings.id, recordingId), eq(weaveRecordings.weaveId, weave.id), eq(weaveRecordings.projectId, weave.projectId), isNull(weaveRecordings.deletedAt)),
  });
  if (!recording) throw new NotFoundError("We couldn't find that recording.");
  const asset = await db.query.mediaAssets.findFirst({ where: and(eq(mediaAssets.id, recording.mediaAssetId), eq(mediaAssets.projectId, weave.projectId)) });
  if (!asset || asset.deletedAt) throw new NotFoundError("We couldn't find that recording.");
  return { recording, asset };
}

// ---------------------------------------------------------------------------
// Weaves
// ---------------------------------------------------------------------------

export async function listWeaves(db: DbClient, userId: string, projectId: string) {
  assertWeaveEnabled();
  await requireProjectAccess(db, userId, projectId, "project:read");
  const rows = await db.select().from(weaves).where(and(eq(weaves.projectId, projectId), isNull(weaves.deletedAt))).orderBy(desc(weaves.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((w) => w.id);
  const [recordingCounts, participantRows] = await Promise.all([
    db
      .select({ weaveId: weaveRecordings.weaveId, n: count() })
      .from(weaveRecordings)
      .where(and(inArray(weaveRecordings.weaveId, ids), isNull(weaveRecordings.deletedAt), ne(weaveRecordings.status, "awaiting_upload")))
      .groupBy(weaveRecordings.weaveId),
    db.select().from(weaveParticipants).where(inArray(weaveParticipants.weaveId, ids)).orderBy(asc(weaveParticipants.position)),
  ]);
  return rows.map((w) => ({
    id: w.id,
    title: w.title,
    status: w.status,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    recordingCount: Number(recordingCounts.find((r) => r.weaveId === w.id)?.n ?? 0),
    participants: participantRows.filter((p) => p.weaveId === w.id).map((p) => p.displayName),
  }));
}

async function assertPeopleInProject(db: DbClient, projectId: string, participants: CreateWeaveInput["participants"]): Promise<void> {
  const personIds = participants.map((p) => p.personId).filter((id): id is string => Boolean(id));
  if (personIds.length === 0) return;
  const found = await db.select({ id: people.id }).from(people).where(and(eq(people.projectId, projectId), inArray(people.id, personIds)));
  if (found.length !== new Set(personIds).size) throw new ValidationError("One of the linked people isn't part of this memoir.");
}

export async function createWeave(db: DbClient, userId: string, projectId: string, input: CreateWeaveInput): Promise<Weave> {
  assertWeaveEnabled();
  await requireProjectAccess(db, userId, projectId, "interview:write");
  await assertPeopleInProject(db, projectId, input.participants);
  const now = new Date();
  const weave = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(weaves)
      .values({ projectId, title: input.title, contextNote: input.contextNote || null, participantConsentAt: now, createdByUserId: userId })
      .returning();
    await tx.insert(weaveParticipants).values(
      input.participants.map((p, position) => ({ weaveId: created.id, projectId, displayName: p.displayName, personId: p.personId ?? null, isAccountHolder: p.isAccountHolder, position })),
    );
    await tx.insert(consentRecords).values({ projectId, subjectUserId: userId, consentType: "audio_recording", consentStatus: "granted", policyVersion: WEAVE_CONSENT_POLICY });
    return created;
  });
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "weave.create", targetType: "weave", targetId: weave.id });
  return weave;
}

export async function getWeaveDetail(db: DbClient, userId: string, projectId: string, weaveId: string) {
  const weave = await requireWeave(db, userId, projectId, weaveId, "project:read");
  const [participants, recordings] = await Promise.all([
    db.select().from(weaveParticipants).where(eq(weaveParticipants.weaveId, weave.id)).orderBy(asc(weaveParticipants.position)),
    db.select().from(weaveRecordings).where(and(eq(weaveRecordings.weaveId, weave.id), isNull(weaveRecordings.deletedAt))).orderBy(asc(weaveRecordings.position), asc(weaveRecordings.createdAt)),
  ]);
  return {
    weave: { id: weave.id, title: weave.title, contextNote: weave.contextNote, status: weave.status, createdAt: weave.createdAt, updatedAt: weave.updatedAt },
    participants: participants.map((p) => ({ id: p.id, displayName: p.displayName, personId: p.personId, isAccountHolder: p.isAccountHolder })),
    recordings: recordings.map(toRecordingView),
  };
}

export type RecordingView = ReturnType<typeof toRecordingView>;
export function toRecordingView(r: WeaveRecording) {
  return {
    id: r.id,
    clientUploadId: r.clientUploadId,
    status: r.status,
    originalFilename: r.originalFilename,
    mimeType: r.declaredMimeType,
    size: r.declaredSize,
    durationSeconds: r.declaredDurationSeconds,
    recordedOn: r.recordedOn,
    recordedOnPrecision: r.recordedOnPrecision,
    contextNote: r.contextNote,
    failureCode: r.failureCode,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
  };
}

export async function updateWeave(db: DbClient, userId: string, projectId: string, weaveId: string, input: UpdateWeaveInput): Promise<void> {
  const weave = await requireWeave(db, userId, projectId, weaveId, "interview:write");
  if (input.participants) await assertPeopleInProject(db, projectId, input.participants);
  await db.transaction(async (tx) => {
    if (input.title !== undefined || input.contextNote !== undefined) {
      await tx
        .update(weaves)
        .set({ ...(input.title !== undefined ? { title: input.title } : {}), ...(input.contextNote !== undefined ? { contextNote: input.contextNote || null } : {}) })
        .where(eq(weaves.id, weave.id));
    }
    if (input.participants) {
      await tx.delete(weaveParticipants).where(eq(weaveParticipants.weaveId, weave.id));
      await tx.insert(weaveParticipants).values(
        input.participants.map((p, position) => ({ weaveId: weave.id, projectId, displayName: p.displayName, personId: p.personId ?? null, isAccountHolder: p.isAccountHolder, position })),
      );
    }
  });
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "weave.update", targetType: "weave", targetId: weave.id });
}

/**
 * Deletes a weave and every original recording in it. Storage objects go
 * first; if any removal fails the weave stays visible so the user can retry,
 * and nothing that still exists in storage loses its database reference.
 */
export async function deleteWeave(db: DbClient, userId: string, projectId: string, weaveId: string): Promise<{ removed: number }> {
  const weave = await requireWeave(db, userId, projectId, weaveId, "interview:write");
  const recordings = await db.select().from(weaveRecordings).where(eq(weaveRecordings.weaveId, weave.id));
  const assetIds = recordings.map((r) => r.mediaAssetId);
  const assets = assetIds.length
    ? (await db.select().from(mediaAssets).where(and(inArray(mediaAssets.id, assetIds), isNull(mediaAssets.deletedAt)))).filter((a) => a.storageProvider !== "pending")
    : [];
  const storage = assets.length > 0 ? await getStorage() : null;
  let removed = 0;
  let failed = 0;
  for (const asset of assets) {
    try {
      await storage!.delete(asset.storageKey);
      await db.update(mediaAssets).set({ deletedAt: new Date(), retentionStatus: "deleted" }).where(eq(mediaAssets.id, asset.id));
      removed += 1;
    } catch (error) {
      failed += 1;
      log.warn("weave.delete_media_failed", { assetId: asset.id, code: errorCode(error) });
    }
  }
  if (failed > 0) throw new AppError("delete_incomplete", "Some recordings couldn't be removed yet. Please try again.", 502);
  await db.delete(weaves).where(eq(weaves.id, weave.id));
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "weave.delete", targetType: "weave", targetId: weave.id });
  log.info("weave.deleted", { weaveId: weave.id, recordingsRemoved: removed });
  return { removed };
}

// ---------------------------------------------------------------------------
// Recordings: reserve -> upload (direct or server) -> complete
// ---------------------------------------------------------------------------

export type UploadInstructions =
  | { mode: "direct"; flow: "client-token" | "presigned"; pathname: string; contentType: string; multipart: boolean }
  | { mode: "server"; contentType: string };

/**
 * Reserves a recording slot before any bytes move. Idempotent per
 * (weave, clientUploadId): a retried request returns the same recording.
 */
export async function reserveRecording(
  db: DbClient,
  userId: string,
  projectId: string,
  weaveId: string,
  input: ReserveRecordingInput,
): Promise<{ recording: RecordingView; upload: UploadInstructions | null }> {
  const weave = await requireWeave(db, userId, projectId, weaveId, "interview:write");
  const contentType = resolveWeaveAudioType(input.mimeType, input.filename);
  if (!contentType) throw new ValidationError("That file type isn't supported. Use M4A, MP3, WAV, AAC, WebM or Ogg audio.");
  const { maxUploadBytes, maxRecordingsPerWeave } = weaveLimits();
  if (input.size > maxUploadBytes) {
    throw new ValidationError(`That recording is larger than ${Math.round(maxUploadBytes / 1024 / 1024)} MB.`);
  }

  const existing = await db.query.weaveRecordings.findFirst({ where: and(eq(weaveRecordings.weaveId, weave.id), eq(weaveRecordings.clientUploadId, input.clientUploadId)) });
  if (existing) {
    if (existing.deletedAt) throw new ValidationError("That upload was removed. Choose the file again to add it.");
    const storage = await getStorage();
    const asset = await db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, existing.mediaAssetId) });
    return { recording: toRecordingView(existing), upload: existing.status === "awaiting_upload" || existing.status === "failed" ? instructions(storage, asset!.storageKey, existing.declaredMimeType, existing.declaredSize) : null };
  }

  const [{ n }] = await db.select({ n: count() }).from(weaveRecordings).where(and(eq(weaveRecordings.weaveId, weave.id), isNull(weaveRecordings.deletedAt)));
  if (Number(n) >= maxRecordingsPerWeave) throw new ValidationError(`A conversation can hold up to ${maxRecordingsPerWeave} recordings.`);

  // Fails with a clear "not configured" error on a deployment without private storage.
  const storage = await getStorage();
  const extension = WEAVE_AUDIO_TYPES[contentType].extension;
  const assetId = crypto.randomUUID();
  const storageKey = buildWeaveMediaKey(projectId, weave.id, assetId, extension);
  const durationSeconds = input.durationSeconds == null ? null : Math.round(input.durationSeconds);

  const recording = await db.transaction(async (tx) => {
    // The storage key is fixed up front so project, account and weave deletion
    // remove the object even if the browser uploaded it but never completed.
    await tx.insert(mediaAssets).values({
      id: assetId,
      projectId,
      uploadedByUserId: userId,
      storageKey,
      storageProvider: storage.name,
      mediaType: contentType,
      processingStatus: "pending_upload",
      durationSeconds,
      fileSize: input.size,
      purpose: "weave_source",
      originalFilename: input.filename,
      retentionExempt: true,
      retainUntil: null,
    });
    const [{ maxPos }] = await tx.select({ maxPos: count() }).from(weaveRecordings).where(eq(weaveRecordings.weaveId, weave.id));
    const inserted = await tx
      .insert(weaveRecordings)
      .values({
        weaveId: weave.id,
        projectId,
        mediaAssetId: assetId,
        clientUploadId: input.clientUploadId,
        position: Number(maxPos),
        originalFilename: input.filename,
        declaredMimeType: contentType,
        declaredSize: input.size,
        declaredDurationSeconds: durationSeconds,
        uploadedByUserId: userId,
      })
      .onConflictDoNothing({ target: [weaveRecordings.weaveId, weaveRecordings.clientUploadId] })
      .returning();
    if (inserted.length === 0) throw new AppError("conflict", "That upload is already being prepared. Please try again.", 409);
    return inserted[0];
  });
  return { recording: toRecordingView(recording), upload: instructions(storage, storageKey, contentType, input.size) };
}

function instructions(storage: StorageProvider, storageKey: string, contentType: string, size: number): UploadInstructions {
  if (storage.supportsDirectUpload) {
    return { mode: "direct", flow: storage.directUploadFlow ?? "client-token", pathname: storageKey, contentType, multipart: size > 8 * 1024 * 1024 };
  }
  return { mode: "server", contentType };
}

/**
 * Authorizes one direct browser upload. The token is bound to exactly this
 * recording's storage path, its declared type and size, and expires within
 * the hour. Completed recordings never get a token (originals are immutable).
 */
export async function authorizeDirectUpload(
  db: DbClient,
  userId: string,
  projectId: string,
  weaveId: string,
  pathname: string,
  clientPayload: string | null,
): Promise<{ allowedContentTypes: string[]; maximumSizeInBytes: number; validUntil: number; addRandomSuffix: boolean; allowOverwrite: boolean; tokenPayload: string }> {
  const weave = await requireWeave(db, userId, projectId, weaveId, "interview:write");
  let recordingId: string;
  try {
    recordingId = uploadClientPayloadSchema.parse(JSON.parse(clientPayload ?? "")).recordingId;
  } catch {
    throw new ValidationError("The upload request was incomplete.");
  }
  const { recording, asset } = await requireRecording(db, weave, recordingId);
  if (asset.storageKey !== pathname) throw new ForbiddenError("That upload path isn't allowed.");
  if (recording.status !== "awaiting_upload" && recording.status !== "failed") {
    throw new AppError("already_uploaded", "This recording is already stored. Originals can't be replaced.", 409);
  }
  return {
    allowedContentTypes: [recording.declaredMimeType],
    maximumSizeInBytes: Math.min(recording.declaredSize, weaveLimits().maxUploadBytes),
    validUntil: Date.now() + 60 * 60 * 1000,
    addRandomSuffix: false,
    // Only a not-yet-completed path can be rewritten (a retry after a failed upload).
    allowOverwrite: true,
    tokenPayload: recording.id,
  };
}

/**
 * OIDC flow: the same authorization as `authorizeDirectUpload`, then a
 * write-only delegation from Blob for exactly this path, type and size. The
 * presigned URL built from it carries the same limits.
 */
export async function grantPresignedUpload(
  db: DbClient,
  userId: string,
  projectId: string,
  weaveId: string,
  pathname: string,
  clientPayload: string | null,
) {
  const grant = await authorizeDirectUpload(db, userId, projectId, weaveId, pathname, clientPayload);
  const storage = await getStorage();
  if (storage.directUploadFlow !== "presigned" || !storage.signedUploadToken) {
    throw new AppError("direct_upload_unavailable", "Direct uploads aren't available on this server.", 409);
  }
  const limits = { allowedContentTypes: grant.allowedContentTypes, maximumSizeInBytes: grant.maximumSizeInBytes, validUntil: grant.validUntil };
  const token = await storage.signedUploadToken(pathname, limits);
  return {
    token,
    urlOptions: { ...limits, addRandomSuffix: grant.addRandomSuffix, allowOverwrite: grant.allowOverwrite, tokenPayload: grant.tokenPayload },
  };
}

/** Local/dev storage only: the bytes come through this server, then `completeRecording` verifies them. */
export async function uploadRecordingContent(
  db: DbClient,
  userId: string,
  projectId: string,
  weaveId: string,
  recordingId: string,
  bytes: Uint8Array,
): Promise<void> {
  const weave = await requireWeave(db, userId, projectId, weaveId, "interview:write");
  const { recording, asset } = await requireRecording(db, weave, recordingId);
  const storage = await getStorage();
  if (storage.supportsDirectUpload) throw new AppError("direct_upload_required", "Upload this recording directly to storage.", 409);
  if (recording.status !== "awaiting_upload" && recording.status !== "failed") {
    throw new AppError("already_uploaded", "This recording is already stored. Originals can't be replaced.", 409);
  }
  if (bytes.length > recording.declaredSize || bytes.length > weaveLimits().maxUploadBytes) {
    throw new ValidationError("The file is larger than declared.");
  }
  await storage.put(asset.storageKey, bytes, recording.declaredMimeType);
}

const FAILURE_MESSAGES: Record<string, string> = {
  empty: "The recording was empty.",
  too_large: "That recording is larger than allowed.",
  unrecognized_format: "That file doesn't look like the audio type it claims to be.",
};

/**
 * Verifies an upload actually landed in private storage and is the audio it
 * claims to be, then marks it uploaded. Safe to call any number of times:
 * a completed recording is returned unchanged.
 */
export async function completeRecording(db: DbClient, userId: string, projectId: string, weaveId: string, recordingId: string): Promise<RecordingView> {
  const weave = await requireWeave(db, userId, projectId, weaveId, "interview:write");
  const { recording, asset } = await requireRecording(db, weave, recordingId);
  if (recording.status !== "awaiting_upload" && recording.status !== "failed") return toRecordingView(recording);

  const storage = await getStorage();
  if (!storage.stat || !storage.readRange) throw new AppError("not_configured", "This storage provider can't verify uploads.", 503);
  const info = await storage.stat(asset.storageKey);
  if (!info) throw new AppError("upload_incomplete", "We haven't received this recording yet. Please try uploading it again.", 409);

  let failure: string | null = null;
  if (info.size === 0) failure = "empty";
  else if (info.size > weaveLimits().maxUploadBytes || info.size > recording.declaredSize) failure = "too_large";
  else {
    const head = await storage.readRange(asset.storageKey, 0, 63);
    if (process.env.UPLOAD_SNIFF_DISABLED !== "1" && (!head || !bytesMatchAudioType(head, recording.declaredMimeType))) failure = "unrecognized_format";
  }

  if (failure) {
    // A rejected file must not linger in storage.
    await storage.delete(asset.storageKey).catch((error) => log.warn("weave.reject_cleanup_failed", { assetId: asset.id, code: errorCode(error) }));
    await db.update(mediaAssets).set({ processingStatus: "failed", processingError: failure }).where(eq(mediaAssets.id, asset.id));
    await db.update(weaveRecordings).set({ status: "failed", failureCode: failure }).where(eq(weaveRecordings.id, recording.id));
    await recordAudit(db, { projectId, actorUserId: userId, actionType: "weave.recording_rejected", targetType: "weave_recording", targetId: recording.id });
    log.warn("weave.recording_rejected", { recordingId: recording.id, code: failure });
    throw new ValidationError(FAILURE_MESSAGES[failure]);
  }

  const now = new Date();
  // Conditional update: two concurrent completions can't both "win".
  const updated = await db
    .update(weaveRecordings)
    .set({ status: "uploaded", failureCode: null, completedAt: now })
    .where(and(eq(weaveRecordings.id, recording.id), inArray(weaveRecordings.status, ["awaiting_upload", "failed"])))
    .returning();
  if (updated.length === 0) {
    const current = await db.query.weaveRecordings.findFirst({ where: eq(weaveRecordings.id, recording.id) });
    return toRecordingView(current!);
  }
  await db.update(mediaAssets).set({ processingStatus: "uploaded", processingError: null, fileSize: info.size }).where(eq(mediaAssets.id, asset.id));
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "weave.recording_uploaded", targetType: "weave_recording", targetId: recording.id });
  log.info("weave.recording_uploaded", { recordingId: recording.id, bytes: info.size });
  return toRecordingView(updated[0]);
}

export async function updateRecordingDetails(
  db: DbClient,
  userId: string,
  projectId: string,
  weaveId: string,
  recordingId: string,
  input: UpdateRecordingInput,
): Promise<RecordingView> {
  const weave = await requireWeave(db, userId, projectId, weaveId, "interview:write");
  const { recording } = await requireRecording(db, weave, recordingId);
  const [updated] = await db
    .update(weaveRecordings)
    .set({
      ...(input.recordedOn !== undefined ? { recordedOn: input.recordedOn } : {}),
      ...(input.recordedOnPrecision !== undefined ? { recordedOnPrecision: input.recordedOnPrecision } : {}),
      ...(input.contextNote !== undefined ? { contextNote: input.contextNote || null } : {}),
    })
    .where(eq(weaveRecordings.id, recording.id))
    .returning();
  return toRecordingView(updated);
}

/** Removes one original recording at the user's request: storage first, then the rows. */
export async function deleteRecording(db: DbClient, userId: string, projectId: string, weaveId: string, recordingId: string): Promise<void> {
  const weave = await requireWeave(db, userId, projectId, weaveId, "interview:write");
  const { recording, asset } = await requireRecording(db, weave, recordingId);
  if (asset.storageProvider !== "pending") {
    const storage = await getStorage();
    try {
      await storage.delete(asset.storageKey);
    } catch (error) {
      log.warn("weave.recording_delete_failed", { recordingId: recording.id, code: errorCode(error) });
      throw new AppError("delete_failed", "We couldn't remove that recording yet. Please try again.", 502);
    }
  }
  const now = new Date();
  await db.update(mediaAssets).set({ deletedAt: now, retentionStatus: "deleted" }).where(eq(mediaAssets.id, asset.id));
  await db.update(weaveRecordings).set({ deletedAt: now }).where(eq(weaveRecordings.id, recording.id));
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "weave.recording_deleted", targetType: "weave_recording", targetId: recording.id });
}

export type PlaybackTarget =
  | { kind: "redirect"; url: string }
  | { kind: "local"; storageKey: string; size: number; contentType: string };

/** Where the browser should fetch audio from. Never a public URL. */
export async function getRecordingPlayback(db: DbClient, userId: string, projectId: string, weaveId: string, recordingId: string): Promise<PlaybackTarget> {
  const weave = await requireWeave(db, userId, projectId, weaveId, "project:read");
  const { recording, asset } = await requireRecording(db, weave, recordingId);
  if (recording.status === "awaiting_upload" || recording.status === "failed") throw new NotFoundError("That recording isn't available yet.");
  const storage = await getStorage();
  if (storage.signedReadUrl) {
    return { kind: "redirect", url: await storage.signedReadUrl(asset.storageKey, weaveLimits().playbackUrlTtlSeconds) };
  }
  if (!storage.stat) throw new AppError("not_configured", "Playback isn't available on this server.", 503);
  const info = await storage.stat(asset.storageKey);
  if (!info) throw new NotFoundError("That recording isn't available.");
  return { kind: "local", storageKey: asset.storageKey, size: info.size, contentType: recording.declaredMimeType };
}
