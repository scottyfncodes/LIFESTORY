import { apiHandler, json } from "@/server/api";
import { requireProjectAccess } from "@/server/authz";
import { countPendingJobs, runQueuedJobs } from "@/server/jobs";

/** Pending-work indicator for the UI; also nudges the queue for this project. */
export const GET = apiHandler<{ projectId: string }>(async ({ db, user }, { projectId }) => {
  await requireProjectAccess(db, user.id, projectId, "project:read");
  const ran = await runQueuedJobs(db, { projectId, limit: 2 });
  const pending = await countPendingJobs(db, projectId);
  return json({ pending, ran });
});
