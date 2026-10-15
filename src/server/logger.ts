/**
 * Structured operational logging. Never pass memoir content, transcripts,
 * credentials or raw provider payloads through here; log identifiers,
 * durations, counts and error codes only.
 */
type Level = "debug" | "info" | "warn" | "error";

type Fields = Record<string, string | number | boolean | null | undefined>;

function emit(level: Level, event: string, fields: Fields = {}): void {
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Fields) => emit("debug", event, fields),
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};

/** Reduces an unknown error to a short, content-free code for logs. */
export function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; name?: unknown; status?: unknown };
    if (typeof e.code === "string") return e.code;
    if (typeof e.status === "number") return `http_${e.status}`;
    if (typeof e.name === "string") return e.name;
  }
  return "unknown";
}
