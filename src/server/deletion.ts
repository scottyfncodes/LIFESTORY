import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "@/db";
import { mediaAssets, memoirProjects } from "@/db/schema";
import { recordAudit } from "./audit";
import { requireProjectAccess } from "./authz";
import { enqueueJob } from "./jobs";
import { errorCode, log } from "./logger";
import { storageFor } from "./storage";

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
  const assets = (await db.select().from(mediaAssets).where(and(eq(mediaAssets.projectId, projectId), isNull(mediaAssets.deletedAt)))).filter(
    (a) => a.storageProvider !== "pending",
  );
  // Each file is removed from the store it was saved to. Environments without
  // storage can still delete projects that have no audio; a file whose store
  // isn't configured counts as a failure, so the job retries rather than
  // dropping the only record of where that file is.
  let removed = 0;
  let failed = 0;
  for (const asset of assets) {
    try {
      const storage = await storageFor(asset.storageProvider);
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
    // Retention-exempt originals (Conversation Weave sources) are only ever removed by the user.
    .where(and(isNull(mediaAssets.deletedAt), eq(mediaAssets.retentionStatus, "retained"), eq(mediaAssets.retentionExempt, false)))
    .limit(500);
  const now = Date.now();
  const expired = due.filter((a) => a.retainUntil && a.retainUntil.getTime() < now).slice(0, limit);
  if (expired.length === 0) return 0;
  let count = 0;
  for (const asset of expired) {
    try {
      if (asset.storageProvider !== "pending") await (await storageFor(asset.storageProvider)).delete(asset.storageKey);
      await db.update(mediaAssets).set({ deletedAt: new Date(), retentionStatus: "deleted" }).where(eq(mediaAssets.id, asset.id));
      count += 1;
    } catch (error) {
      log.warn("retention.delete_failed", { assetId: asset.id, code: errorCode(error) });
    }
  }
  log.info("retention.expired_audio", { count });
  return count;
}

/**
 * Account deletion: purge every project the user owns *before* the user row
 * is removed. Deleting the user cascades to projects, their media rows and
 * queued jobs, so anything deferred to a job would lose the storage keys and
 * orphan the recordings. Runs synchronously; if any recording cannot be
 * removed it throws, which aborts the account deletion with nothing lost
 * (projects stay soft-deleted and inaccessible, and a retry resumes).
 */
export async function purgeAllOwnedProjects(db: DbClient, userId: string): Promise<number> {
  const owned = await db.select({ id: memoirProjects.id }).from(memoirProjects).where(eq(memoirProjects.ownerUserId, userId));
  for (const p of owned) {
    await db.update(memoirProjects).set({ deletedAt: new Date(), projectStatus: "deleted" }).where(and(eq(memoirProjects.id, p.id), isNull(memoirProjects.deletedAt)));
    await purgeDeletedProject(db, p.id);
  }
  return owned.length;
}
