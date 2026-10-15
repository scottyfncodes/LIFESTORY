import { apiHandler, json } from "@/server/api";
import { retryTranscription } from "@/server/media";
import { enforceRateLimit } from "@/server/rate-limit";

export const POST = apiHandler<{ projectId: string; assetId: string }>(async ({ db, user }, { projectId, assetId }) => {
  await enforceRateLimit(db, "transcription", user.id);
  const result = await retryTranscription(db, user.id, projectId, assetId);
  return json({ assetId, status: result.asset.processingStatus, transcript: result.transcript, transcriptionError: result.error });
});
