import { z } from "zod";
import { apiHandler, json, parseJson } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { MAX_ANSWER_LENGTH, correctTurn } from "@/server/interviews";
import { drainJobsAfterResponse } from "@/server/jobs/drain";

const bodySchema = z.object({ correctedText: z.string().max(MAX_ANSWER_LENGTH) });

export const PATCH = apiHandler<{ projectId: string; turnId: string }>(async ({ db, user, request }, { projectId, turnId }) => {
  await enforceRateLimit(db, "mutation", user.id);
  const body = await parseJson(request, bodySchema);
  const turn = await correctTurn(db, user.id, projectId, turnId, body.correctedText);
  drainJobsAfterResponse(projectId);
  return json({ turn });
});
