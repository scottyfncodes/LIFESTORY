import { apiHandler, json } from "@/server/api";
import { limits } from "@/server/config";
import { ValidationError } from "@/server/errors";
import { storeRecording } from "@/server/media";
import { enforceRateLimit } from "@/server/rate-limit";

export const POST = apiHandler<{ projectId: string; sessionId: string }>(async ({ db, user, request }, { projectId, sessionId }) => {
  await enforceRateLimit(db, "upload", user.id);
  const { maxUploadBytes } = limits();
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxUploadBytes + 4096) throw new ValidationError("That recording is too large. Try a shorter answer.");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ValidationError("The upload wasn't readable.");
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new ValidationError("No recording was attached.");
  const durationRaw = form.get("durationSeconds");
  const durationSeconds = typeof durationRaw === "string" && durationRaw !== "" && Number.isFinite(Number(durationRaw)) ? Number(durationRaw) : null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await storeRecording(db, user.id, projectId, sessionId, { bytes, mimeType: file.type || "application/octet-stream", durationSeconds });
  return json(
    {
      assetId: result.asset.id,
      status: result.asset.processingStatus,
      transcript: result.transcript,
      transcriptionError: result.transcriptionError,
      transcriptionAvailable: result.transcriptionAvailable,
      durationSeconds: result.asset.durationSeconds,
    },
    { status: 201 },
  );
});
