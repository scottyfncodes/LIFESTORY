import { del, get, put } from "@vercel/blob";
import type { StorageProvider } from "./index";

/** Vercel Blob with private access: objects are only readable with the token. */
export class VercelBlobStorage implements StorageProvider {
  readonly name = "vercel-blob";
  constructor(private token: string) {}

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await put(key, Buffer.from(body), {
      access: "private",
      token: this.token,
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async get(key: string) {
    const result = await get(key, { access: "private", token: this.token });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return {
      body: result.stream as ReadableStream<Uint8Array>,
      contentType: result.blob.contentType ?? "application/octet-stream",
      size: result.blob.size ?? null,
    };
  }

  async delete(key: string): Promise<void> {
    await del(key, { token: this.token });
  }
}
