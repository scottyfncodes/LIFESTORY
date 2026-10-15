import { apiHandler, json } from "@/server/api";
import { deleteAssetAudio, readAsset } from "@/server/media";
import { enforceRateLimit } from "@/server/rate-limit";

export const GET = apiHandler<{ projectId: string; assetId: string }>(async ({ db, user }, { projectId, assetId }) => {
  const { file } = await readAsset(db, user.id, projectId, assetId);
  const body = file.body instanceof Uint8Array ? Buffer.from(file.body) : file.body;
  return new Response(body, {
    headers: {
      "content-type": file.contentType,
      ...(file.size ? { "content-length": String(file.size) } : {}),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
});

export const DELETE = apiHandler<{ projectId: string; assetId: string }>(async ({ db, user }, { projectId, assetId }) => {
  await enforceRateLimit(db, "mutation", user.id);
  await deleteAssetAudio(db, user.id, projectId, assetId);
  return json({ ok: true });
});
