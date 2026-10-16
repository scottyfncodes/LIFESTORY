import { BlobNotFoundError, del, get, head, issueSignedToken, presignUrl, put, type IssuedSignedToken } from "@vercel/blob";
import type { BlobCredentials } from "../config";
import { ConfigurationError } from "../errors";
import type { StorageProvider } from "./index";

/**
 * Vercel Blob with private access: objects are only readable with credentials.
 * Every call names its store explicitly (a read-write token, or OIDC with a
 * store id), so the SDK never falls back to whichever store the environment
 * happens to describe.
 */
export class VercelBlobStorage implements StorageProvider {
  readonly supportsDirectUpload = true;
  readonly directUploadFlow: "client-token" | "presigned";
  constructor(
    readonly name: string,
    private credentials: BlobCredentials,
    private webhookPublicKey: string | null = null,
  ) {
    // Client tokens are HMAC-signed with the read-write token; OIDC uses presigned URLs instead.
    this.directUploadFlow = "token" in credentials ? "client-token" : "presigned";
  }

  private get auth(): { token: string } | { storeId: string } {
    return "token" in this.credentials ? { token: this.credentials.token } : { storeId: this.credentials.storeId };
  }

  /**
   * What the upload route hands the SDK's upload handler for this store. The
   * presigned handler requires a webhook key even though this app never
   * accepts upload callbacks; passing this store's own key stops the SDK from
   * reading another store's key from the environment.
   */
  directUploadAuth(): { token: string } | { webhookPublicKey: string } {
    if ("token" in this.credentials) return { token: this.credentials.token };
    if (!this.webhookPublicKey) throw new ConfigurationError("Direct uploads aren't fully configured on this server.");
    return { webhookPublicKey: this.webhookPublicKey };
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await put(key, Buffer.from(body), {
      access: "private",
      ...this.auth,
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async get(key: string) {
    const result = await get(key, { access: "private", ...this.auth });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return {
      body: result.stream as ReadableStream<Uint8Array>,
      contentType: result.blob.contentType ?? "application/octet-stream",
      size: result.blob.size ?? null,
    };
  }

  async delete(key: string): Promise<void> {
    await del(key, { ...this.auth });
  }

  async stat(key: string) {
    try {
      const info = await head(key, { ...this.auth });
      return { size: info.size, contentType: info.contentType };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  }

  async readRange(key: string, start: number, endInclusive: number): Promise<Uint8Array | null> {
    const result = await get(key, {
      access: "private",
      ...this.auth,
      useCache: false,
      headers: { range: `bytes=${start}-${endInclusive}` },
    });
    if (!result || !result.stream) return null;
    // Read at most the requested window even if the range header was ignored.
    return readUpTo(result.stream as ReadableStream<Uint8Array>, endInclusive - start + 1);
  }

  async signedReadUrl(key: string, ttlSeconds: number): Promise<string> {
    const validUntil = Date.now() + ttlSeconds * 1000;
    // Scoped to this one object, read-only, short-lived.
    const signed = await issueSignedToken({ ...this.auth, pathname: key, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(signed, { operation: "get", pathname: key, access: "private", validUntil, useCache: false });
    return presignedUrl;
  }

  async signedUploadToken(key: string, limits: { allowedContentTypes: string[]; maximumSizeInBytes: number; validUntil: number }): Promise<IssuedSignedToken> {
    // Write-only delegation for exactly this key, type and size, until validUntil.
    return issueSignedToken({ ...this.auth, pathname: key, operations: ["put"], ...limits });
  }
}

async function readUpTo(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, out.length - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.length) break;
  }
  return out;
}
