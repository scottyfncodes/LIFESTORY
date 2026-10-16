import { updateRecordingSchema } from "@/lib/validation/weave";
import { apiHandler, json, parseJson } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { assertWeaveEnabled, deleteRecording, updateRecordingDetails } from "@/server/weave/service";

type Params = { projectId: string; weaveId: string; recordingId: string };

export const PATCH = apiHandler<Params>(async ({ db, user, request }, { projectId, weaveId, recordingId }) => {
  assertWeaveEnabled();
  await enforceRateLimit(db, "mutation", user.id);
  const input = await parseJson(request, updateRecordingSchema);
  return json({ recording: await updateRecordingDetails(db, user.id, projectId, weaveId, recordingId, input) });
});

export const DELETE = apiHandler<Params>(async ({ db, user }, { projectId, weaveId, recordingId }) => {
  assertWeaveEnabled();
  await enforceRateLimit(db, "mutation", user.id);
  await deleteRecording(db, user.id, projectId, weaveId, recordingId);
  return json({ ok: true });
});
