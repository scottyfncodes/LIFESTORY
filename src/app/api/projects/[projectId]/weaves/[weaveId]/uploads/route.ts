import { handleUpload, handleUploadPresigned, type HandleUploadBody, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { apiHandler, json } from "@/server/api";
import { blobAuthMode, storageProviderName } from "@/server/config";
import { AppError, ValidationError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { assertWeaveEnabled, authorizeDirectUpload, grantPresignedUpload } from "@/server/weave/service";

/**
 * Step 2 (Blob storage): lets the browser upload one reserved recording
 * straight to private storage. Two equivalent flows, chosen by how the store
 * is connected:
 *  - read-write token: a short-lived client token (`handleUpload`);
 *  - OIDC: a presigned upload URL from a write-only delegation (`handleUploadPresigned`).
 * Both are bound to the reserved path, declared type and size, and expire
 * within the hour. Only requests from a signed-in user are accepted. Blob's
 * "upload completed" callbacks are deliberately not used: the browser calls
 * /complete, which verifies the stored object itself.
 */
export const POST = apiHandler<{ projectId: string; weaveId: string }>(async ({ db, user, request }, { projectId, weaveId }) => {
  assertWeaveEnabled();
  await enforceRateLimit(db, "weaveUpload", user.id);
  if (storageProviderName() !== "vercel-blob") throw new AppError("direct_upload_unavailable", "Direct uploads aren't available on this server.", 409);
  let body: HandleUploadBody | HandleUploadPresignedBody;
  try {
    body = (await request.json()) as HandleUploadBody | HandleUploadPresignedBody;
  } catch {
    throw new ValidationError("The request body wasn't valid JSON.");
  }
  if (typeof (body?.payload as { pathname?: unknown } | undefined)?.pathname !== "string") throw new ValidationError("Unsupported upload request.");

  if (body.type === "blob.generate-client-token" && blobAuthMode() === "token") {
    const result = await handleUpload({
      request,
      body,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: (pathname, clientPayload) => authorizeDirectUpload(db, user.id, projectId, weaveId, pathname, clientPayload),
    });
    return json(result);
  }

  if (body.type === "blob.generate-presigned-url" && blobAuthMode() === "oidc") {
    // The SDK insists on this key even though callbacks are never accepted here.
    if (!process.env.BLOB_WEBHOOK_PUBLIC_KEY) throw new AppError("not_configured", "Direct uploads aren't fully configured on this server.", 503);
    const result = await handleUploadPresigned({
      request,
      body,
      getSignedToken: (pathname, clientPayload) => grantPresignedUpload(db, user.id, projectId, weaveId, pathname, clientPayload),
    });
    return json(result);
  }

  throw new ValidationError("Unsupported upload request.");
});
