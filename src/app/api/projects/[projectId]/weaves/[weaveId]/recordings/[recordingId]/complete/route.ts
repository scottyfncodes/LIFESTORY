import { apiHandler, json } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { assertWeaveEnabled, completeRecording } from "@/server/weave/service";

/** Step 3: verify the stored object (exists, size, real format) and mark it uploaded. Idempotent. */
export const POST = apiHandler<{ projectId: string; weaveId: string; recordingId: string }>(async ({ db, user }, { projectId, weaveId, recordingId }) => {
  assertWeaveEnabled();
  await enforceRateLimit(db, "mutation", user.id);
  return json({ recording: await completeRecording(db, user.id, projectId, weaveId, recordingId) });
});
