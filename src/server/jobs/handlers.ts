import { registerJobHandler } from "./index";
import { processTurn } from "../memory/pipeline";

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
}
