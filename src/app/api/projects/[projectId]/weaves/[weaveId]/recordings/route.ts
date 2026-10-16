import { reserveRecordingSchema } from "@/lib/validation/weave";
import { apiHandler, json, parseJson } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { assertWeaveEnabled, reserveRecording } from "@/server/weave/service";

/** Step 1 of an upload: reserve a slot. Idempotent per clientUploadId, so retries are safe. */
export const POST = apiHandler<{ projectId: string; weaveId: string }>(async ({ db, user, request }, { projectId, weaveId }) => {
  assertWeaveEnabled();
  await enforceRateLimit(db, "weaveUpload", user.id);
  const input = await parseJson(request, reserveRecordingSchema);
  return json(await reserveRecording(db, user.id, projectId, weaveId, input), { status: 201 });
});
