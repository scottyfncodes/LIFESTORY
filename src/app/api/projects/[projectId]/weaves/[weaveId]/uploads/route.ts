import { handleUpload, handleUploadPresigned, type HandleUploadBody, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { apiHandler, json } from "@/server/api";
import { AppError, ValidationError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { getWeaveStorage } from "@/server/storage";
import { assertWeaveEnabled, authorizeDirectUpload, grantPresignedUpload } from "@/server/weave/service";

/**
 * Step 2 (Blob storage): lets the browser upload one reserved recording
 * straight to Conversation Weave's private store (never the interview store).
 * Two equivalent flows, chosen by how that store is connected:
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
  const storage = await getWeaveStorage();
  if (!storage.supportsDirectUpload || !storage.directUploadAuth) throw new AppError("direct_upload_unavailable", "Direct uploads aren't available on this server.", 409);
  let body: HandleUploadBody | HandleUploadPresignedBody;
  try {
    body = (await request.json()) as HandleUploadBody | HandleUploadPresignedBody;
  } catch {
    throw new ValidationError("The request body wasn't valid JSON.");
  }
  if (typeof (body?.payload as { pathname?: unknown } | undefined)?.pathname !== "string") throw new ValidationError("Unsupported upload request.");

  // This store's own credentials, passed explicitly so the SDK can't fall
  // back to the interview store's environment variables.
  const auth = storage.directUploadAuth();

  if (body.type === "blob.generate-client-token" && "token" in auth) {
    const result = await handleUpload({
      request,
      body,
      token: auth.token,
      onBeforeGenerateToken: (pathname, clientPayload) => authorizeDirectUpload(db, user.id, projectId, weaveId, pathname, clientPayload),
    });
    return json(result);
  }

  if (body.type === "blob.generate-presigned-url" && "webhookPublicKey" in auth) {
    // The SDK insists on a webhook key even though callbacks are never accepted here.
    const result = await handleUploadPresigned({
      request,
      body,
      webhookPublicKey: auth.webhookPublicKey,
      getSignedToken: (pathname, clientPayload) => grantPresignedUpload(db, user.id, projectId, weaveId, pathname, clientPayload),
    });
    return json(result);
  }

  throw new ValidationError("Unsupported upload request.");
});
