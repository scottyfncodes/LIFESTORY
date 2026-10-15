/** Largest slice served for an open-ended range ("bytes=N-"); media elements ask again for the rest. */
export const MAX_RANGE_CHUNK = 4 * 1024 * 1024;

/**
 * Parses a single byte range (all media elements ask for). Returns null when
 * there is no Range header and "invalid" when it can't be satisfied.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? Math.min(start + MAX_RANGE_CHUNK - 1, size - 1) : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}
