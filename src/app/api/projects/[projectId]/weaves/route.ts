import { createWeaveSchema } from "@/lib/validation/weave";
import { apiHandler, json, parseJson } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { assertWeaveEnabled, createWeave, listWeaves } from "@/server/weave/service";

export const GET = apiHandler<{ projectId: string }>(async ({ db, user }, { projectId }) => {
  return json({ weaves: await listWeaves(db, user.id, projectId) });
});

export const POST = apiHandler<{ projectId: string }>(async ({ db, user, request }, { projectId }) => {
  assertWeaveEnabled();
  await enforceRateLimit(db, "mutation", user.id);
  const input = await parseJson(request, createWeaveSchema);
  const weave = await createWeave(db, user.id, projectId, input);
  return json({ id: weave.id }, { status: 201 });
});
