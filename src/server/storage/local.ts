import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageProvider } from "./index";

/** Filesystem storage for development and tests. Not served by the web server. */
export class LocalStorage implements StorageProvider {
  readonly name = "local";
  constructor(private root: string) {}

  private resolve(key: string): string {
    const safe = key.replace(/\.\.+/g, "").replace(/^\/+/, "");
    return path.join(this.root, safe);
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    await writeFile(`${file}.meta.json`, JSON.stringify({ contentType }));
  }

  async get(key: string) {
    const file = this.resolve(key);
    try {
      const [body, meta, info] = await Promise.all([readFile(file), readFile(`${file}.meta.json`, "utf8").catch(() => "{}"), stat(file)]);
      const contentType = (JSON.parse(meta) as { contentType?: string }).contentType ?? "application/octet-stream";
      return { body: new Uint8Array(body), contentType, size: info.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.resolve(key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }
}
