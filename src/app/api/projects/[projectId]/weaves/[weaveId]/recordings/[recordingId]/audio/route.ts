import { apiHandler } from "@/server/api";
import { NotFoundError } from "@/server/errors";
import { parseRange } from "@/server/http-range";
import { getStorage } from "@/server/storage";
import { getRecordingPlayback } from "@/server/weave/service";

const NO_STORE = { "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

/**
 * Authenticated playback with seeking. On Blob storage this redirects to a
 * five-minute, object-scoped presigned URL (the media element follows it and
 * seeks with Range requests against storage). Locally it serves Range requests.
 */
export const GET = apiHandler<{ projectId: string; weaveId: string; recordingId: string }>(async ({ db, user, request }, { projectId, weaveId, recordingId }) => {
  const target = await getRecordingPlayback(db, user.id, projectId, weaveId, recordingId);
  if (target.kind === "redirect") {
    return new Response(null, { status: 302, headers: { location: target.url, ...NO_STORE } });
  }
  const storage = await getStorage();
  const { size, contentType, storageKey } = target;
  const common = { "content-type": contentType, "accept-ranges": "bytes", "content-disposition": "inline", ...NO_STORE };
  const range = parseRange(request.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}`, ...NO_STORE } });
  }
  if (!range) {
    const file = await storage.get(storageKey);
    if (!file) throw new NotFoundError("That recording isn't available.");
    const body = file.body instanceof Uint8Array ? Buffer.from(file.body) : file.body;
    return new Response(body, { status: 200, headers: { ...common, "content-length": String(size) } });
  }
  const bytes = (await storage.readRange!(storageKey, range.start, range.end)) ?? new Uint8Array();
  return new Response(Buffer.from(bytes), {
    status: 206,
    headers: { ...common, "content-length": String(bytes.length), "content-range": `bytes ${range.start}-${range.start + bytes.length - 1}/${size}` },
  });
});
