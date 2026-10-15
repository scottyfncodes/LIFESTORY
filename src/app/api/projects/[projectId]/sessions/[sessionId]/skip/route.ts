import { z } from "zod";
import { apiHandler, json, parseJson } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { skipQuestion } from "@/server/interviews";

export const maxDuration = 60;

const bodySchema = z.object({ clientTurnId: z.string().min(8).max(64) });

export const POST = apiHandler<{ projectId: string; sessionId: string }>(async ({ db, user, request }, { projectId, sessionId }) => {
  await enforceRateLimit(db, "answer", user.id);
  const body = await parseJson(request, bodySchema);
  const result = await skipQuestion(db, user.id, projectId, sessionId, body.clientTurnId);
  return json({ answer: result.answer, nextQuestion: result.nextQuestion, duplicate: result.duplicate });
});
