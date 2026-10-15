import { apiHandler, json } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { startNewSession } from "@/server/interviews";

export const POST = apiHandler<{ projectId: string }>(async ({ db, user }, { projectId }) => {
  await enforceRateLimit(db, "mutation", user.id);
  const session = await startNewSession(db, user.id, projectId);
  return json({ sessionId: session.id }, { status: 201 });
});
