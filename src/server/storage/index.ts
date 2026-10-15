import { storageProviderName } from "../config";
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
}

let cached: StorageProvider | null = null;

export async function getStorage(): Promise<StorageProvider> {
  if (cached) return cached;
  const name = storageProviderName();
  if (name === "vercel-blob") {
    const { VercelBlobStorage } = await import("./vercel-blob");
    cached = new VercelBlobStorage(process.env.BLOB_READ_WRITE_TOKEN as string);
  } else {
    if (process.env.VERCEL && process.env.STORAGE_PROVIDER !== "local") {
      throw new ConfigurationError("Private media storage is not configured. Recordings can't be uploaded until a Blob store is connected.");
    }
    const { LocalStorage } = await import("./local");
    cached = new LocalStorage(process.env.STORAGE_LOCAL_DIR ?? ".storage");
  }
  return cached;
}

/** Whether uploads can be accepted at all in this environment. */
export function isStorageAvailable(): boolean {
  const name = storageProviderName();
  if (name === "vercel-blob") return true;
  return !(process.env.VERCEL && process.env.STORAGE_PROVIDER !== "local");
}

export function __setStorageForTests(provider: StorageProvider | null): void {
  cached = provider;
}

export function buildMediaKey(projectId: string, assetId: string, extension: string): string {
  return `projects/${projectId}/recordings/${assetId}.${extension}`;
}
