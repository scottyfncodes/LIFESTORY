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

/**
 * Global ceiling on AI calls across every account, per UTC day. Sign-up is
 * open and each call is a paid model request, so per-user limits alone don't
 * bound spend. Override with AI_GLOBAL_DAILY_LIMIT; unset or not a whole
 * number means the default, "0" pauses AI. There is no "unlimited" value.
 *
 * Default: one interview answer costs about 2.3 calls (next question, memory
 * extraction, and a biography summary every third answer), so 500 calls is
 * roughly 200 answers a day across everyone, plus some chapter drafting.
 */
export const DEFAULT_AI_GLOBAL_DAILY_LIMIT = 500;

export function aiGlobalDailyLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AI_GLOBAL_DAILY_LIMIT?.trim();
  if (!raw) return DEFAULT_AI_GLOBAL_DAILY_LIMIT;
  return /^\d+$/.test(raw) ? Number(raw) : DEFAULT_AI_GLOBAL_DAILY_LIMIT;
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

const globalAiKey = (now: Date) => `aiGlobal:${utcDay(now)}`;

/**
 * Takes one call from today's global AI budget, using the same bucket table
 * as the per-user limiter with a key per UTC day. Check and increment are one
 * statement (the row is only bumped while under the limit), so parallel
 * requests can't push it past the limit. Not affected by RATE_LIMITS_DISABLED.
 * Returns false when today's budget is spent.
 */
export async function consumeGlobalAiBudget(db: DbClient, now = new Date(), limit = aiGlobalDailyLimit()): Promise<boolean> {
  if (limit <= 0) return false;
  const dayStart = new Date(`${utcDay(now)}T00:00:00Z`);
  const result = await db.execute(sql`
    insert into rate_limit_buckets (key, count, window_started_at)
    values (${globalAiKey(now)}, 1, ${dayStart.toISOString()}::timestamptz)
    on conflict (key) do update set count = rate_limit_buckets.count + 1
    where rate_limit_buckets.count < ${limit}
    returning count
  `);
  // Keep a week of daily totals; drop older ones.
  void db
    .execute(sql`delete from rate_limit_buckets where key like 'aiGlobal:%' and window_started_at < ${new Date(dayStart.getTime() - 7 * 86_400_000).toISOString()}::timestamptz`)
    .catch(() => undefined);
  return rowsOf(result).length > 0;
}

/** Read-only: true when today's global AI budget is already spent. */
export async function isGlobalAiBudgetSpent(db: DbClient, now = new Date(), limit = aiGlobalDailyLimit()): Promise<boolean> {
  if (limit <= 0) return true;
  const result = await db.execute(sql`select count from rate_limit_buckets where key = ${globalAiKey(now)}`);
  const row = rowsOf<{ count: number }>(result)[0];
  return Number(row?.count ?? 0) >= limit;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}
