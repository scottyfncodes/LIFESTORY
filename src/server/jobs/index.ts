import { and, eq, lte, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import { processingJobs } from "@/db/schema";
import { errorCode, log } from "../logger";
import { AiPausedError, ProviderError } from "../errors";

export type JobType = (typeof processingJobs.$inferSelect)["jobType"];
export type Job = typeof processingJobs.$inferSelect;

export type JobHandler = (db: DbClient, job: Job) => Promise<Record<string, unknown> | void>;

const handlers = new Map<JobType, JobHandler>();

export function registerJobHandler(type: JobType, handler: JobHandler): void {
  handlers.set(type, handler);
}

/**
 * Inserts a job unless one with the same idempotency key already exists.
 * Jobs are durable rows; they survive the request that created them.
 */
export async function enqueueJob(
  db: DbClient,
  input: { projectId: string; jobType: JobType; idempotencyKey: string; payload?: Record<string, unknown>; maxAttempts?: number; runAfter?: Date },
): Promise<string | null> {
  const rows = await db
    .insert(processingJobs)
    .values({
      projectId: input.projectId,
      jobType: input.jobType,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? {},
      maxAttempts: input.maxAttempts ?? 3,
      runAfter: input.runAfter ?? new Date(),
    })
    .onConflictDoNothing({ target: processingJobs.idempotencyKey })
    .returning({ id: processingJobs.id });
  return rows[0]?.id ?? null;
}

const STALE_LOCK_MS = 10 * 60 * 1000;

/** Claims up to `limit` runnable jobs. Uses SKIP LOCKED so concurrent drains don't collide. */
async function claimJobs(db: DbClient, limit: number, projectId?: string): Promise<Job[]> {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
  const projectFilter = projectId ? sql`and project_id = ${projectId}` : sql``;
  const result = await db.execute(sql`
    update processing_jobs set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
    where id in (
      select id from processing_jobs
      where (status = 'queued' and run_after <= now())
         or (status = 'running' and locked_at < ${staleBefore})
      ${projectFilter}
      order by created_at asc
      limit ${limit}
      for update skip locked
    )
    returning *
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Record<string, unknown>[];
  return rows.map(rowToJob);
}

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    jobType: row.job_type as JobType,
    idempotencyKey: row.idempotency_key as string,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as Job["status"],
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    lastErrorCode: (row.last_error_code as string | null) ?? null,
    lastErrorMessage: (row.last_error_message as string | null) ?? null,
    runAfter: new Date(row.run_after as string),
    lockedAt: row.locked_at ? new Date(row.locked_at as string) : null,
    finishedAt: row.finished_at ? new Date(row.finished_at as string) : null,
    result: (row.result as Record<string, unknown> | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export async function runJob(db: DbClient, job: Job): Promise<void> {
  const handler = handlers.get(job.jobType);
  const started = Date.now();
  if (!handler) {
    await db.update(processingJobs).set({ status: "failed", lastErrorCode: "no_handler", finishedAt: new Date() }).where(eq(processingJobs.id, job.id));
    return;
  }
  try {
    const result = await handler(db, job);
    await db
      .update(processingJobs)
      .set({ status: "succeeded", finishedAt: new Date(), result: result ?? null, lastErrorCode: null, lastErrorMessage: null })
      .where(eq(processingJobs.id, job.id));
    log.info("job.succeeded", { jobType: job.jobType, jobId: job.id, durationMs: Date.now() - started, attempts: job.attempts });
  } catch (error) {
    const code = errorCode(error);
    if (error instanceof AiPausedError && job.jobType !== "draft_chapter") {
      // Background AI work waits for tomorrow's budget and doesn't use up an attempt.
      await db
        .update(processingJobs)
        .set({ status: "queued", runAfter: error.resumesAt, lockedAt: null, attempts: sql`greatest(${processingJobs.attempts} - 1, 0)`, lastErrorCode: code, lastErrorMessage: error.message })
        .where(eq(processingJobs.id, job.id));
      log.info("job.deferred", { jobType: job.jobType, jobId: job.id, code });
      return;
    }
    // A draft someone is waiting on fails at once with the paused message.
    const retryable = error instanceof AiPausedError ? false : !(error instanceof ProviderError) || error.retryable;
    const exhausted = job.attempts >= job.maxAttempts || !retryable;
    const backoffMs = Math.min(15 * 60 * 1000, 30_000 * 2 ** (job.attempts - 1));
    await db
      .update(processingJobs)
      .set({
        status: exhausted ? "failed" : "queued",
        runAfter: exhausted ? job.runAfter : new Date(Date.now() + backoffMs),
        lockedAt: null,
        finishedAt: exhausted ? new Date() : null,
        lastErrorCode: code,
        lastErrorMessage: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      })
      .where(eq(processingJobs.id, job.id));
    log.warn("job.failed", { jobType: job.jobType, jobId: job.id, code, attempts: job.attempts, exhausted, durationMs: Date.now() - started });
  }
}

/** Drains queued jobs. Safe to call from `after()`, a cron route, or tests. */
export async function runQueuedJobs(db: DbClient, opts: { limit?: number; projectId?: string } = {}): Promise<number> {
  const jobs = await claimJobs(db, opts.limit ?? 5, opts.projectId);
  for (const job of jobs) await runJob(db, job);
  return jobs.length;
}

export async function getJobStatus(db: DbClient, projectId: string, idempotencyKey: string): Promise<Job | null> {
  const job = await db.query.processingJobs.findFirst({
    where: and(eq(processingJobs.projectId, projectId), eq(processingJobs.idempotencyKey, idempotencyKey)),
  });
  return job ?? null;
}

export async function countPendingJobs(db: DbClient, projectId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(processingJobs)
    .where(and(eq(processingJobs.projectId, projectId), sql`${processingJobs.status} in ('queued','running')`, lte(processingJobs.runAfter, new Date(Date.now() + 3600_000))));
  return Number(row?.count ?? 0);
}
