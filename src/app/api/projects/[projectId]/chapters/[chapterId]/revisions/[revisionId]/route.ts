import { apiHandler, json } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { requireProjectAccess } from "@/server/authz";
import { getRevision, restoreRevision } from "@/server/manuscript/service";

export const GET = apiHandler<{ projectId: string; chapterId: string; revisionId: string }>(async ({ db, user }, { projectId, chapterId, revisionId }) => {
  await requireProjectAccess(db, user.id, projectId, "project:read");
  return json({ revision: await getRevision(db, projectId, chapterId, revisionId) });
});

export const POST = apiHandler<{ projectId: string; chapterId: string; revisionId: string }>(async ({ db, user }, { projectId, chapterId, revisionId }) => {
  await enforceRateLimit(db, "mutation", user.id);
  const revision = await restoreRevision(db, user.id, projectId, chapterId, revisionId);
  return json({ revision });
});
