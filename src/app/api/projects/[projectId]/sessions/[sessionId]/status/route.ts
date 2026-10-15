import { z } from "zod";
import { apiHandler, json, parseJson } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { setSessionStatus } from "@/server/interviews";

const bodySchema = z.object({ status: z.enum(["paused", "completed", "active"]) });

export const POST = apiHandler<{ projectId: string; sessionId: string }>(async ({ db, user, request }, { projectId, sessionId }) => {
  await enforceRateLimit(db, "mutation", user.id);
  const body = await parseJson(request, bodySchema);
  const session = await setSessionStatus(db, user.id, projectId, sessionId, body.status);
  return json({ session });
});
