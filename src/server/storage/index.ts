import type { IssuedSignedToken } from "@vercel/blob";
import { defaultBlobCredentials, storageProviderName, weaveBlobCredentials, weaveStorageProviderName, type BlobCredentials } from "../config";
import { ConfigurationError } from "../errors";

/**
 * Private media storage. Keys are opaque; nothing here ever produces a
 * public URL. Reads go through authenticated route handlers.
 */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array> | Uint8Array; contentType: string; size: number | null } | null>;
  delete(key: string): Promise<void>;
  /** True when browsers upload straight to private storage (no file bytes pass through our functions). */
  readonly supportsDirectUpload?: boolean;
  /** Size and stored type of an object, or null when it does not exist. */
  stat?(key: string): Promise<{ size: number; contentType: string } | null>;
  /** Reads bytes `start..endInclusive` (used to verify a file's real format). */
  readRange?(key: string, start: number, endInclusive: number): Promise<Uint8Array | null>;
  /** A short-lived, object-scoped, read-only URL. Never a public URL. */
  signedReadUrl?(key: string, ttlSeconds: number): Promise<string>;
  /**
   * How browsers get permission for a direct upload: a client token signed
   * with the read-write token, or a presigned URL (works with OIDC).
   */
  readonly directUploadFlow?: "client-token" | "presigned";
  /** Delegation for one presigned upload, scoped to exactly this key and these limits. */
  signedUploadToken?(key: string, limits: { allowedContentTypes: string[]; maximumSizeInBytes: number; validUntil: number }): Promise<IssuedSignedToken>;
  /** Credentials the SDK's upload handler needs for this store (a token, or the presigned flow's webhook key). */
  directUploadAuth?(): { token: string } | { webhookPublicKey: string };
}

/**
 * Provider names recorded on each media asset (`storage_provider`), so a file
 * is always read and deleted in the store it was saved to:
 *  - "vercel-blob": the default store (interview audio, and Weave originals
 *    saved before Weave had its own store);
 *  - "vercel-blob:weave": Conversation Weave's own store;
 *  - "local": files on disk (development and tests).
 */
export const DEFAULT_BLOB = "vercel-blob";
export const WEAVE_BLOB = "vercel-blob:weave";

const cache = new Map<string, StorageProvider>();
let testOverride: StorageProvider | { default?: StorageProvider; weave?: StorageProvider } | null = null;

async function blobStorage(name: string, credentials: BlobCredentials, webhookPublicKey: string | undefined): Promise<StorageProvider> {
  const hit = cache.get(name);
  if (hit) return hit;
  const { VercelBlobStorage } = await import("./vercel-blob");
  const storage = new VercelBlobStorage(name, credentials, webhookPublicKey || null);
  cache.set(name, storage);
  return storage;
}

async function diskStorage(): Promise<StorageProvider> {
  const hit = cache.get("local");
  if (hit) return hit;
  const { LocalStorage } = await import("./local");
  const storage = new LocalStorage(process.env.STORAGE_LOCAL_DIR ?? ".storage");
  cache.set("local", storage);
  return storage;
}

function overrideFor(purpose: "default" | "weave"): StorageProvider | null | undefined {
  if (!testOverride) return undefined;
  if ("put" in testOverride) return testOverride;
  return testOverride[purpose] ?? null;
}

/** Storage for new interview recordings. */
export async function getStorage(): Promise<StorageProvider> {
  const override = overrideFor("default");
  if (override !== undefined) {
    if (!override) throw new ConfigurationError("Private media storage is not configured.");
    return override;
  }
  if (storageProviderName() === "vercel-blob") {
    return blobStorage(DEFAULT_BLOB, defaultBlobCredentials()!, process.env.BLOB_WEBHOOK_PUBLIC_KEY);
  }
  if (process.env.VERCEL && process.env.STORAGE_PROVIDER !== "local") {
    throw new ConfigurationError("Private media storage is not configured. Recordings can't be uploaded until a Blob store is connected.");
  }
  return diskStorage();
}

/**
 * Storage for new Conversation Weave originals. Never the interview store:
 * without its own store on a deployment it refuses, and interview audio is
 * unaffected either way.
 */
export async function getWeaveStorage(): Promise<StorageProvider> {
  const override = overrideFor("weave");
  if (override !== undefined) {
    if (!override) throw new ConfigurationError("Private storage for conversation recordings is not configured.");
    return override;
  }
  const name = weaveStorageProviderName();
  if (name === "vercel-blob:weave") return blobStorage(WEAVE_BLOB, weaveBlobCredentials()!, process.env.WEAVE_BLOB_WEBHOOK_PUBLIC_KEY);
  if (name === "local") return diskStorage();
  throw new ConfigurationError("Private storage for conversation recordings is not configured.");
}

/**
 * The store a saved file lives in, from the provider recorded with it. Fails
 * closed when that store isn't configured here, rather than trying another one.
 */
export async function storageFor(provider: string): Promise<StorageProvider> {
  if (testOverride) {
    if ("put" in testOverride) return testOverride;
    const match = [testOverride.default, testOverride.weave].find((s) => s?.name === provider);
    if (!match) throw new ConfigurationError("The storage holding this recording isn't configured on this server.");
    return match;
  }
  if (provider === DEFAULT_BLOB) {
    const credentials = defaultBlobCredentials();
    if (credentials) return blobStorage(DEFAULT_BLOB, credentials, process.env.BLOB_WEBHOOK_PUBLIC_KEY);
  } else if (provider === WEAVE_BLOB) {
    const credentials = weaveBlobCredentials();
    if (credentials) return blobStorage(WEAVE_BLOB, credentials, process.env.WEAVE_BLOB_WEBHOOK_PUBLIC_KEY);
  } else if (provider === "local") {
    return diskStorage();
  }
  throw new ConfigurationError("The storage holding this recording isn't configured on this server.");
}

/** Whether uploads can be accepted at all in this environment. */
export function isStorageAvailable(): boolean {
  const name = storageProviderName();
  if (name === "vercel-blob") return true;
  return !(process.env.VERCEL && process.env.STORAGE_PROVIDER !== "local");
}

/**
 * Tests: one provider for everything, or separate default and Weave
 * providers (matched to saved files by their `name`). Null restores the real ones.
 */
export function __setStorageForTests(provider: StorageProvider | { default?: StorageProvider; weave?: StorageProvider } | null): void {
  testOverride = provider;
  cache.clear();
}

export function buildMediaKey(projectId: string, assetId: string, extension: string): string {
  return `projects/${projectId}/recordings/${assetId}.${extension}`;
}

export function buildWeaveMediaKey(projectId: string, weaveId: string, assetId: string, extension: string): string {
  return `projects/${projectId}/weaves/${weaveId}/${assetId}.${extension}`;
}
