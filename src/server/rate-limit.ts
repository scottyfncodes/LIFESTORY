import { sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import { RateLimitError } from "./errors";

export type RateLimitRule = { limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  answer: { limit: 60, windowSeconds: 60 },
  aiQuestion: { limit: 30, windowSeconds: 60 },
  upload: { limit: 20, windowSeconds: 60 },
  weaveUpload: { limit: 120, windowSeconds: 3600 },
  transcription: { limit: 20, windowSeconds: 60 },
  draft: { limit: 10, windowSeconds: 300 },
  export: { limit: 6, windowSeconds: 300 },
  projectCreate: { limit: 10, windowSeconds: 3600 },
  mutation: { limit: 240, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitScope = keyof typeof RATE_LIMITS;

/**
 * Fixed-window limiter backed by Postgres so it works across serverless
 * instances. One atomic upsert per check.
 */
export async function enforceRateLimit(
  db: DbClient,
  scope: RateLimitScope,
  subject: string,
  override?: RateLimitRule,
): Promise<void> {
  if (process.env.RATE_LIMITS_DISABLED === "1") return;
  const rule = override ?? RATE_LIMITS[scope];
  const key = `${scope}:${subject}`;
  const windowInterval = `${rule.windowSeconds} seconds`;
  const result = await db.execute(sql`
    insert into rate_limit_buckets (key, count, window_started_at)
    values (${key}, 1, now())
    on conflict (key) do update set
      count = case
        when rate_limit_buckets.window_started_at < now() - ${windowInterval}::interval then 1
        else rate_limit_buckets.count + 1
      end,
      window_started_at = case
        when rate_limit_buckets.window_started_at < now() - ${windowInterval}::interval then now()
        else rate_limit_buckets.window_started_at
      end
    returning count, window_started_at
  `);
  const row = rowsOf<{ count: number; window_started_at: Date }>(result)[0];
  const count = Number(row?.count ?? 0);
  if (count > rule.limit) {
    const started = row?.window_started_at ? new Date(row.window_started_at).getTime() : Date.now();
    const retryAfter = Math.max(1, Math.ceil((started + rule.windowSeconds * 1000 - Date.now()) / 1000));
    throw new RateLimitError(retryAfter);
  }
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}
