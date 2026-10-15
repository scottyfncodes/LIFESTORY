import { z } from "zod";
import { apiHandler, json, parseJson } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { requireProjectAccess } from "@/server/authz";
import { MAX_CHAPTER_BODY, deleteChapter, getChapterDetail, saveUserEdit, setChapterSources, updateChapterMeta } from "@/server/manuscript/service";
import { runQueuedJobs } from "@/server/jobs";

export const maxDuration = 300;

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), body: z.string().max(MAX_CHAPTER_BODY), baseRevisionId: z.string().uuid().nullable() }),
  z.object({ action: z.literal("meta"), title: z.string().min(1).max(120), subtitle: z.string().max(160).nullable(), focus: z.string().max(300).nullable() }),
  z.object({ action: z.literal("sources"), turnIds: z.array(z.string().uuid()).max(200) }),
]);

export const GET = apiHandler<{ projectId: string; chapterId: string }>(async ({ db, user, request }, { projectId, chapterId }) => {
  await requireProjectAccess(db, user.id, projectId, "project:read");
  if (new URL(request.url).searchParams.get("drain") === "1") await runQueuedJobs(db, { projectId, limit: 1 });
  const detail = await getChapterDetail(db, projectId, chapterId);
  return json(detail);
});

export const PATCH = apiHandler<{ projectId: string; chapterId: string }>(async ({ db, user, request }, { projectId, chapterId }) => {
  await enforceRateLimit(db, "mutation", user.id);
  const body = await parseJson(request, patchSchema);
  if (body.action === "edit") {
    const revision = await saveUserEdit(db, user.id, projectId, chapterId, body.body, body.baseRevisionId);
    return json({ revision });
  }
  if (body.action === "meta") {
    await updateChapterMeta(db, user.id, projectId, chapterId, body);
    return json({ ok: true });
  }
  await setChapterSources(db, user.id, projectId, chapterId, body.turnIds);
  return json({ ok: true });
});

export const DELETE = apiHandler<{ projectId: string; chapterId: string }>(async ({ db, user }, { projectId, chapterId }) => {
  await enforceRateLimit(db, "mutation", user.id);
  await deleteChapter(db, user.id, projectId, chapterId);
  return json({ ok: true });
});
