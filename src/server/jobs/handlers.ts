import { registerJobHandler } from "./index";
import { processTurn, refreshSummary } from "../memory/pipeline";
import { runDraft } from "../manuscript/service";
import { purgeDeletedProject } from "../deletion";

let registered = false;

/** Registers every job handler exactly once per process. */
export function ensureJobHandlers(): void {
  if (registered) return;
  registered = true;
  registerJobHandler("process_turn", async (db, job) => {
    const turnId = String(job.payload.turnId ?? "");
    if (!turnId) return { skipped: "no_turn" };
    return processTurn(db, turnId);
  });
  registerJobHandler("refresh_summary", async (db, job) => refreshSummary(db, job.projectId));
  registerJobHandler("delete_project_media", async (db, job) => purgeDeletedProject(db, job.projectId));
  registerJobHandler("draft_chapter", async (db, job) =>
    runDraft(db, job.projectId, String(job.payload.chapterId ?? ""), (job.payload.userId as string | undefined) ?? null, (job.payload.instructions as string | null | undefined) ?? null),
  );
}
