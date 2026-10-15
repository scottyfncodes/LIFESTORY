import { afterEach, describe, expect, it } from "vitest";
import { blobAuthMode, storageProviderName } from "@/server/config";
import { VercelBlobStorage } from "@/server/storage/vercel-blob";

const KEYS = ["STORAGE_PROVIDER", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function set(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
}

describe("Blob credentials", () => {
  it("prefers a read-write token, falls back to OIDC (store id), else none", () => {
    set({ STORAGE_PROVIDER: "vercel-blob", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_x", BLOB_STORE_ID: "store_x" });
    expect(blobAuthMode()).toBe("token");
    set({ STORAGE_PROVIDER: "vercel-blob", BLOB_STORE_ID: "store_x" });
    expect(blobAuthMode()).toBe("oidc");
    expect(storageProviderName()).toBe("vercel-blob");
    set({ STORAGE_PROVIDER: "vercel-blob" });
    expect(blobAuthMode()).toBeNull();
    expect(storageProviderName()).toBe("local");
  });

  it("never selects Blob unless STORAGE_PROVIDER asks for it", () => {
    set({ BLOB_STORE_ID: "store_x" });
    expect(storageProviderName()).toBe("local");
  });

  it("uses client tokens with a read-write token and presigned URLs with OIDC", () => {
    expect(new VercelBlobStorage("vercel_blob_rw_test_x").directUploadFlow).toBe("client-token");
    expect(new VercelBlobStorage(null).directUploadFlow).toBe("presigned");
  });
});
