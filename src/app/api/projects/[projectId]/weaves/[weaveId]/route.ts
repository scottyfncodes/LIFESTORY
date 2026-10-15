import { updateWeaveSchema } from "@/lib/validation/weave";
import { apiHandler, json, parseJson } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { assertWeaveEnabled, deleteWeave, getWeaveDetail, updateWeave } from "@/server/weave/service";

type Params = { projectId: string; weaveId: string };

export const GET = apiHandler<Params>(async ({ db, user }, { projectId, weaveId }) => {
  return json(await getWeaveDetail(db, user.id, projectId, weaveId));
});

export const PATCH = apiHandler<Params>(async ({ db, user, request }, { projectId, weaveId }) => {
  assertWeaveEnabled();
  await enforceRateLimit(db, "mutation", user.id);
  const input = await parseJson(request, updateWeaveSchema);
  await updateWeave(db, user.id, projectId, weaveId, input);
  return json({ ok: true });
});

export const DELETE = apiHandler<Params>(async ({ db, user }, { projectId, weaveId }) => {
  assertWeaveEnabled();
  await enforceRateLimit(db, "mutation", user.id);
  const result = await deleteWeave(db, user.id, projectId, weaveId);
  return json({ ok: true, removed: result.removed });
});
