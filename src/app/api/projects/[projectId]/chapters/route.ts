import { z } from "zod";
import { apiHandler, json, parseJson } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { createChapter, listChapters, proposeChapters, reorderChapters } from "@/server/manuscript/service";
import { requireProjectAccess } from "@/server/authz";

export const maxDuration = 300;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), title: z.string().min(1).max(120), focus: z.string().max(300).optional() }),
  z.object({ action: z.literal("propose") }),
  z.object({ action: z.literal("reorder"), orderedIds: z.array(z.string().uuid()).max(100) }),
]);

export const GET = apiHandler<{ projectId: string }>(async ({ db, user }, { projectId }) => {
  await requireProjectAccess(db, user.id, projectId, "project:read");
  return json({ chapters: await listChapters(db, projectId) });
});

export const POST = apiHandler<{ projectId: string }>(async ({ db, user, request }, { projectId }) => {
  const body = await parseJson(request, bodySchema);
  if (body.action === "propose") {
    await enforceRateLimit(db, "draft", user.id);
    return json(await proposeChapters(db, user.id, projectId));
  }
  await enforceRateLimit(db, "mutation", user.id);
  if (body.action === "create") {
    const chapter = await createChapter(db, user.id, projectId, body.title, body.focus ?? null);
    return json({ chapter }, { status: 201 });
  }
  await reorderChapters(db, user.id, projectId, body.orderedIds);
  return json({ ok: true });
});
