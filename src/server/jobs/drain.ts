import { after } from "next/server";
import { getDb } from "@/db";
import { ensureJobHandlers } from "./handlers";
import { runQueuedJobs } from "./index";
import { errorCode, log } from "../logger";

/**
 * Schedules a drain of this project's queued jobs once the current response
 * has been sent. On Vercel `after()` keeps the function alive; the cron
 * route is the safety net if the instance is reclaimed first.
 */
export function drainJobsAfterResponse(projectId: string): void {
  after(async () => {
    try {
      ensureJobHandlers();
      const db = await getDb();
      await runQueuedJobs(db, { projectId, limit: 5 });
    } catch (error) {
      log.warn("jobs.drain_failed", { code: errorCode(error) });
    }
  });
}
