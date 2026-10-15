import { apiHandler, json } from "@/server/api";
import { weaveLimits } from "@/server/config";
import { ValidationError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { assertWeaveEnabled, uploadRecordingContent } from "@/server/weave/service";

/**
 * Step 2 (local/development storage only): the raw file body comes through
 * this server. Production uses direct uploads to private Blob storage, which
 * this route refuses.
 */
export const PUT = apiHandler<{ projectId: string; weaveId: string; recordingId: string }>(async ({ db, user, request }, { projectId, weaveId, recordingId }) => {
  assertWeaveEnabled();
  await enforceRateLimit(db, "weaveUpload", user.id);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > weaveLimits().maxUploadBytes) throw new ValidationError("That recording is larger than allowed.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) throw new ValidationError("The recording was empty.");
  await uploadRecordingContent(db, user.id, projectId, weaveId, recordingId, bytes);
  return json({ ok: true });
});
