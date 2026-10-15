import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import { mediaAssets, memoirProjects } from "@/db/schema";
import { recordAudit } from "./audit";
import { requireProjectAccess } from "./authz";
import { enqueueJob } from "./jobs";
import { errorCode, log } from "./logger";
import { getStorage } from "./storage";

/**
 * Deleting a project is two-phase so it fails closed and never leaves
 * orphaned recordings:
 *  1. mark the project deleted (every access check now returns not-found);
 *  2. a durable job removes every stored recording, then hard-deletes the
 *     project row, which cascades to sessions, turns, memory and manuscript.
 * Database point-in-time history and provider-side backups may hold copies
 * for their retention window (documented in docs/PRIVACY.md).
 */
export async function requestProjectDeletion(db: DbClient, userId: string, projectId: string): Promise<void> {
  await requireProjectAccess(db, userId, projectId, "project:delete");
  await db.update(memoirProjects).set({ deletedAt: new Date(), projectStatus: "deleted" }).where(eq(memoirProjects.id, projectId));
  await recordAudit(db, { projectId, actorUserId: userId, actionType: "project.delete_requested", targetType: "memoir_project", targetId: projectId });
  await enqueueJob(db, { projectId, jobType: "delete_project_media", idempotencyKey: `delete_project:${projectId}`, payload: { userId }, maxAttempts: 10 });
}

/** Job handler: purge recordings, then the project row. Idempotent and resumable. */
export async function purgeDeletedProject(db: DbClient, projectId: string): Promise<Record<string, unknown>> {
  const project = await db.query.memoirProjects.findFirst({ where: eq(memoirProjects.id, projectId) });
  if (!project) return { alreadyGone: true };
  if (!project.deletedAt) return { skipped: "not_marked_deleted" };
  const assets = await db.select().from(mediaAssets).where(and(eq(mediaAssets.projectId, projectId), isNull(mediaAssets.deletedAt)));
  const storage = await getStorage();
  let removed = 0;
  let failed = 0;
  for (const asset of assets) {
    if (asset.storageProvider === "pending") continue;
    try {
      await storage.delete(asset.storageKey);
      await db.update(mediaAssets).set({ deletedAt: new Date(), retentionStatus: "deleted" }).where(eq(mediaAssets.id, asset.id));
      removed += 1;
    } catch (error) {
      failed += 1;
      log.warn("deletion.media_failed", { assetId: asset.id, code: errorCode(error) });
    }
  }
  if (failed > 0) throw new Error(`Could not remove ${failed} recording(s); will retry.`);
  await db.delete(memoirProjects).where(eq(memoirProjects.id, projectId));
  await recordAudit(db, { projectId, actorUserId: null, actionType: "project.purged", targetType: "memoir_project", targetId: projectId });
  log.info("deletion.project_purged", { projectId, recordingsRemoved: removed });
  return { removed };
}

/** Deletes audio past its retention date while keeping transcripts. Called by the cron drain. */
export async function expireRetainedAudio(db: DbClient, limit = 50): Promise<number> {
  const due = await db
    .select()
    .from(mediaAssets)
    .where(and(isNull(mediaAssets.deletedAt), eq(mediaAssets.retentionStatus, "retained")))
    .limit(500);
  const now = Date.now();
  const expired = due.filter((a) => a.retainUntil && a.retainUntil.getTime() < now).slice(0, limit);
  if (expired.length === 0) return 0;
  const storage = await getStorage();
  let count = 0;
  for (const asset of expired) {
    try {
      if (asset.storageProvider !== "pending") await storage.delete(asset.storageKey);
      await db.update(mediaAssets).set({ deletedAt: new Date(), retentionStatus: "deleted" }).where(eq(mediaAssets.id, asset.id));
      count += 1;
    } catch (error) {
      log.warn("retention.delete_failed", { assetId: asset.id, code: errorCode(error) });
    }
  }
  log.info("retention.expired_audio", { count });
  return count;
}

/** Deletes everything a user owns, for account deletion. Projects shared with others are left to their owners. */
export async function deleteAllOwnedProjects(db: DbClient, userId: string): Promise<number> {
  const owned = await db.select({ id: memoirProjects.id }).from(memoirProjects).where(and(eq(memoirProjects.ownerUserId, userId), isNull(memoirProjects.deletedAt)));
  for (const p of owned) {
    await db.update(memoirProjects).set({ deletedAt: new Date(), projectStatus: "deleted" }).where(eq(memoirProjects.id, p.id));
    await enqueueJob(db, { projectId: p.id, jobType: "delete_project_media", idempotencyKey: `delete_project:${p.id}`, payload: { userId }, maxAttempts: 10 });
  }
  return owned.length;
}
