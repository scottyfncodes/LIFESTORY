import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { apiHandler, json } from "@/server/api";
import { storageProviderName } from "@/server/config";
import { AppError, ValidationError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { assertWeaveEnabled, authorizeDirectUpload } from "@/server/weave/service";

/**
 * Step 2 (Blob storage): issues a short-lived client token so the browser can
 * upload one reserved recording straight to private storage. Only token
 * requests from a signed-in user are accepted here. Blob's "upload completed"
 * callback is deliberately not used: the browser calls /complete instead,
 * which verifies the stored object itself.
 */
export const POST = apiHandler<{ projectId: string; weaveId: string }>(async ({ db, user, request }, { projectId, weaveId }) => {
  assertWeaveEnabled();
  await enforceRateLimit(db, "weaveUpload", user.id);
  if (storageProviderName() !== "vercel-blob") throw new AppError("direct_upload_unavailable", "Direct uploads aren't available on this server.", 409);
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    throw new ValidationError("The request body wasn't valid JSON.");
  }
  if (body?.type !== "blob.generate-client-token" || typeof body.payload?.pathname !== "string") {
    throw new ValidationError("Unsupported upload request.");
  }
  const result = await handleUpload({
    request,
    body,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    onBeforeGenerateToken: (pathname, clientPayload) => authorizeDirectUpload(db, user.id, projectId, weaveId, pathname, clientPayload),
  });
  return json(result);
});
