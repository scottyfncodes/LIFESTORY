import { z } from "zod";
import { apiHandler, json, parseJson } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { requestDraft } from "@/server/manuscript/service";
import { drainJobsAfterResponse } from "@/server/jobs/drain";

export const maxDuration = 300;

const bodySchema = z.object({ instructions: z.string().max(1000).nullable().optional() });

export const POST = apiHandler<{ projectId: string; chapterId: string }>(async ({ db, user, request }, { projectId, chapterId }) => {
  await enforceRateLimit(db, "draft", user.id);
  const body = await parseJson(request, bodySchema);
  const result = await requestDraft(db, user.id, projectId, chapterId, body.instructions ?? null);
  drainJobsAfterResponse(projectId);
  return json(result, { status: 202 });
});
