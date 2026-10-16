import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SDK is replaced so these tests can see exactly which credentials each call carries.
const sdk = vi.hoisted(() => ({
  put: vi.fn(async () => ({})),
  get: vi.fn(async () => null),
  del: vi.fn(async () => undefined),
  head: vi.fn(async () => ({ size: 1, contentType: "audio/mp4" })),
  issueSignedToken: vi.fn(async () => ({ delegationToken: "d", clientSigningToken: "c", validUntil: 0 })),
  presignUrl: vi.fn(async () => ({ presignedUrl: "https://example.test/signed" })),
}));
vi.mock("@vercel/blob", () => ({ ...sdk, BlobNotFoundError: class extends Error {} }));

import { blobAuthMode, defaultBlobCredentials, storageProviderName, weaveBlobCredentials, weaveStorageProviderName } from "@/server/config";
import { ConfigurationError } from "@/server/errors";
import { __setStorageForTests, getStorage, getWeaveStorage, isStorageAvailable, storageFor } from "@/server/storage";
import { VercelBlobStorage } from "@/server/storage/vercel-blob";

const KEYS = [
  "STORAGE_PROVIDER",
  "VERCEL",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_STORE_ID",
  "BLOB_WEBHOOK_PUBLIC_KEY",
  "WEAVE_BLOB_READ_WRITE_TOKEN",
  "WEAVE_BLOB_STORE_ID",
  "WEAVE_BLOB_WEBHOOK_PUBLIC_KEY",
] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

/** The options object (last argument) of one recorded SDK call. */
const optionsOf = (call: unknown) => (call as unknown[]).at(-1) as Record<string, unknown>;

function set(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  __setStorageForTests(null); // also clears cached providers
}

beforeEach(() => {
  for (const fn of Object.values(sdk)) fn.mockClear();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __setStorageForTests(null);
});

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
    expect(new VercelBlobStorage("vercel-blob", { token: "vercel_blob_rw_test_x" }).directUploadFlow).toBe("client-token");
    expect(new VercelBlobStorage("vercel-blob", { storeId: "store_x" }).directUploadFlow).toBe("presigned");
  });
});

describe("Conversation Weave has its own store", () => {
  it("reads Weave credentials only from WEAVE_BLOB_* and never from the default store", () => {
    set({ STORAGE_PROVIDER: "vercel-blob", BLOB_STORE_ID: "store_interview", VERCEL: "1" });
    expect(defaultBlobCredentials()).toEqual({ storeId: "store_interview" });
    expect(weaveBlobCredentials()).toBeNull();
    expect(weaveStorageProviderName()).toBe("none");

    set({ WEAVE_BLOB_STORE_ID: "store_weave", VERCEL: "1" });
    expect(weaveBlobCredentials()).toEqual({ storeId: "store_weave" });
    expect(defaultBlobCredentials()).toBeNull();
    expect(weaveStorageProviderName()).toBe("vercel-blob:weave");

    set({ WEAVE_BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_weave_secret", WEAVE_BLOB_STORE_ID: "store_weave" });
    expect(weaveBlobCredentials()).toEqual({ token: "vercel_blob_rw_weave_secret" });
  });

  it("connecting the Weave store doesn't switch on interview uploads", () => {
    // Only Weave variables: interview audio stays unavailable on a deployment.
    set({ STORAGE_PROVIDER: "vercel-blob", VERCEL: "1", WEAVE_BLOB_STORE_ID: "store_weave", WEAVE_BLOB_WEBHOOK_PUBLIC_KEY: "k" });
    expect(storageProviderName()).toBe("local");
    expect(isStorageAvailable()).toBe(false);

    // The Weave store connected with Vercel's default names as well: still no interview uploads.
    set({ STORAGE_PROVIDER: "vercel-blob", VERCEL: "1", BLOB_STORE_ID: "store_weave", WEAVE_BLOB_STORE_ID: "weave" });
    expect(storageProviderName()).toBe("local");
    expect(isStorageAvailable()).toBe(false);
    set({ STORAGE_PROVIDER: "vercel-blob", VERCEL: "1", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_shared_a", WEAVE_BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_shared_b" });
    expect(storageProviderName()).toBe("local");

    // A separate interview store is used as before.
    set({ STORAGE_PROVIDER: "vercel-blob", VERCEL: "1", BLOB_STORE_ID: "store_interview", WEAVE_BLOB_STORE_ID: "store_weave" });
    expect(storageProviderName()).toBe("vercel-blob");
  });

  it("refuses Weave over OIDC while a default read-write token could take over", () => {
    set({ VERCEL: "1", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_interview_s", WEAVE_BLOB_STORE_ID: "store_weave" });
    expect(weaveBlobCredentials()).toBeNull();
    expect(weaveStorageProviderName()).toBe("none");
  });

  it("uses local files in development and when STORAGE_PROVIDER=local", () => {
    set({});
    expect(weaveStorageProviderName()).toBe("local");
    set({ STORAGE_PROVIDER: "local", VERCEL: "1", WEAVE_BLOB_STORE_ID: "store_weave" });
    expect(weaveStorageProviderName()).toBe("local");
  });

  it("without its own store on a deployment, Weave fails closed and interview storage is unaffected", async () => {
    set({ STORAGE_PROVIDER: "vercel-blob", VERCEL: "1", BLOB_STORE_ID: "store_interview" });
    await expect(getWeaveStorage()).rejects.toBeInstanceOf(ConfigurationError);
    await expect(storageFor("vercel-blob:weave")).rejects.toBeInstanceOf(ConfigurationError);
    expect((await getStorage()).name).toBe("vercel-blob");
    expect(isStorageAvailable()).toBe(true);
  });

  it("finds each saved file's own store, and fails closed for one that isn't configured", async () => {
    set({ STORAGE_PROVIDER: "vercel-blob", VERCEL: "1", BLOB_STORE_ID: "store_interview", WEAVE_BLOB_STORE_ID: "store_weave" });
    expect((await storageFor("vercel-blob")).name).toBe("vercel-blob");
    expect((await storageFor("vercel-blob:weave")).name).toBe("vercel-blob:weave");
    await expect(storageFor("pending")).rejects.toBeInstanceOf(ConfigurationError);
    await expect(storageFor("something-else")).rejects.toBeInstanceOf(ConfigurationError);

    // Legacy Weave originals ("vercel-blob") stay reachable in the default
    // store even when that store no longer takes new interview uploads.
    set({ STORAGE_PROVIDER: "vercel-blob", VERCEL: "1", BLOB_STORE_ID: "store_weave", WEAVE_BLOB_STORE_ID: "store_weave" });
    expect(storageProviderName()).toBe("local");
    expect((await storageFor("vercel-blob")).name).toBe("vercel-blob");
  });

  it("sends the Weave store id on every SDK call, never relying on BLOB_STORE_ID", async () => {
    set({ STORAGE_PROVIDER: "vercel-blob", VERCEL: "1", BLOB_STORE_ID: "store_interview", WEAVE_BLOB_STORE_ID: "store_weave", WEAVE_BLOB_WEBHOOK_PUBLIC_KEY: "weave-key" });
    const weave = await getWeaveStorage();
    await weave.put("k", new Uint8Array([1]), "audio/mp4");
    await weave.get("k");
    await weave.delete("k");
    await weave.stat!("k");
    await weave.readRange!("k", 0, 3);
    await weave.signedReadUrl!("k", 300);
    await weave.signedUploadToken!("k", { allowedContentTypes: ["audio/mp4"], maximumSizeInBytes: 10, validUntil: Date.now() + 1000 });
    const calls = [sdk.put, sdk.get, sdk.del, sdk.head, sdk.issueSignedToken].flatMap((fn) => fn.mock.calls);
    expect(calls.length).toBeGreaterThanOrEqual(7);
    for (const call of calls) {
      const options = optionsOf(call);
      expect(options.storeId).toBe("store_weave");
      expect(options.token).toBeUndefined();
    }
    expect(weave.directUploadAuth!()).toEqual({ webhookPublicKey: "weave-key" });

    // And the interview store gets its own id.
    await (await getStorage()).put("i", new Uint8Array([1]), "audio/webm");
    expect(optionsOf(sdk.put.mock.calls.at(-1)).storeId).toBe("store_interview");
  });

  it("uses the Weave store's own token for client-token uploads", async () => {
    set({ VERCEL: "1", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_interview_s", WEAVE_BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_weave_s" });
    const weave = await getWeaveStorage();
    expect(weave.directUploadFlow).toBe("client-token");
    expect(weave.directUploadAuth!()).toEqual({ token: "vercel_blob_rw_weave_s" });
    await weave.delete("k");
    expect(optionsOf(sdk.del.mock.calls.at(-1)).token).toBe("vercel_blob_rw_weave_s");
  });

  it("won't hand the presigned upload handler another store's webhook key", async () => {
    set({ VERCEL: "1", BLOB_STORE_ID: "store_interview", BLOB_WEBHOOK_PUBLIC_KEY: "interview-key", WEAVE_BLOB_STORE_ID: "store_weave" });
    const weave = await getWeaveStorage();
    expect(() => weave.directUploadAuth!()).toThrow(ConfigurationError);
  });
});
