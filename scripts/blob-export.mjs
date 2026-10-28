// Copies every file in the app's Vercel Blob store to a local folder for
// scripts/backup-blobs.sh. Each file is saved once under its SHA-256
// (objects/<sha256>) and manifest.json records what each pathname held, so a
// restore can put every file back exactly where it was. See docs/backups.md.
//
//   BLOB_READ_WRITE_TOKEN   the Production store's token
//   BLOB_ACCESS             optional, "private" (default) or "public"
//
//   node scripts/blob-export.mjs <empty output folder>
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

/**
 * Downloads every blob that `list` returns, checking each one's size, and
 * writes manifest.json. Throws on the first blob that cannot be read whole,
 * so a partial copy is never mistaken for a complete one.
 */
export async function exportBlobs({ list, get }, outDir, { access = 'private' } = {}) {
  const objects = join(outDir, 'objects');
  await mkdir(objects, { recursive: true });
  if ((await readdir(objects)).length > 0) throw new Error(`${objects} is not empty`);

  const blobs = [];
  let cursor;
  do {
    const page = await list({ cursor, limit: 1000 });
    for (const b of page.blobs) {
      const res = await get(b.pathname, { access });
      if (!res || res.statusCode !== 200 || !res.stream) throw new Error(`Could not read ${b.pathname}`);
      const part = join(objects, `.part-${blobs.length}`);
      const hash = createHash('sha256');
      let size = 0;
      const out = createWriteStream(part);
      for await (const chunk of Readable.fromWeb(res.stream)) {
        hash.update(chunk);
        size += chunk.length;
        if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
      }
      out.end();
      await finished(out);
      if (size !== b.size) {
        throw new Error(`${b.pathname} should be ${b.size} bytes but ${size} arrived`);
      }
      const sha256 = hash.digest('hex');
      await rename(part, join(objects, sha256));
      blobs.push({
        pathname: b.pathname,
        size,
        sha256,
        contentType: res.blob?.contentType ?? null,
        uploadedAt: new Date(b.uploadedAt).toISOString(),
      });
    }
    cursor = page.hasMore ? page.cursor : undefined;
    if (page.hasMore && !cursor) throw new Error('The store listing said there was more but gave no cursor');
  } while (cursor);

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    count: blobs.length,
    bytes: blobs.reduce((n, b) => n + b.size, 0),
    blobs,
  };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function main() {
  const outDir = process.argv[2];
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const access = process.env.BLOB_ACCESS || 'private';
  if (!outDir) throw new Error('Usage: node scripts/blob-export.mjs <output folder>');
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not set');
  if (access !== 'private' && access !== 'public') throw new Error('BLOB_ACCESS must be private or public');
  const { list, get } = await import('@vercel/blob');
  try {
    const manifest = await exportBlobs(
      { list: (o) => list({ ...o, token }), get: (p, o) => get(p, { ...o, token }) },
      outDir,
      { access },
    );
    console.log(`Read ${manifest.count} files (${manifest.bytes} bytes) from the store`);
  } catch (error) {
    await rm(join(outDir, 'objects'), { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
