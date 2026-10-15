import { z } from "zod";
import { apiHandler, json, parseJson } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { MAX_ANSWER_LENGTH, submitAnswer } from "@/server/interviews";
import { drainJobsAfterResponse } from "@/server/jobs/drain";

const bodySchema = z.object({
  text: z.string().max(MAX_ANSWER_LENGTH),
  inputMode: z.enum(["text", "voice"]),
  clientTurnId: z.string().min(8).max(64),
  mediaAssetId: z.string().uuid().nullable().optional(),
  transcriptEdited: z.boolean().optional(),
});

export const POST = apiHandler<{ projectId: string; sessionId: string }>(async ({ db, user, request }, { projectId, sessionId }) => {
  await enforceRateLimit(db, "answer", user.id);
  const body = await parseJson(request, bodySchema);
  const result = await submitAnswer(db, user.id, projectId, sessionId, body);
  if (!result.duplicate) drainJobsAfterResponse(projectId);
  return json({ answer: result.answer, nextQuestion: result.nextQuestion, duplicate: result.duplicate });
});
