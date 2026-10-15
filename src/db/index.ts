import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbClient = Database | Transaction;

type DriverKind = "neon" | "pglite";

declare global {
  var __lifestoryDb: { db: Database; kind: DriverKind; close: () => Promise<void> } | undefined;
}

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(`${message} See docs/SETUP.md.`);
    this.name = "DatabaseConfigError";
  }
}

/**
 * Picks the database driver. PGlite is an in-process database whose data is
 * lost when the instance goes away, so it is only used when chosen
 * explicitly or in local development. A deployment without DATABASE_URL
 * fails loudly instead of silently running on throwaway storage.
 */
export function resolveDriverKind(env: NodeJS.ProcessEnv = process.env): DriverKind {
  const explicit = env.DATABASE_DRIVER;
  if (explicit === "neon") return "neon";
  if (explicit === "pglite") {
    if (env.VERCEL) {
      throw new DatabaseConfigError("DATABASE_DRIVER=pglite is not supported on Vercel; set DATABASE_URL.");
    }
    return "pglite";
  }
  if (env.DATABASE_URL) return "neon";
  if (env.VERCEL || env.NODE_ENV === "production") {
    throw new DatabaseConfigError(
      "DATABASE_URL is not configured. Refusing to fall back to temporary in-memory storage in production.",
    );
  }
  return "pglite";
}

export function isDatabaseConfigured(): boolean {
  try {
    return resolveDriverKind() === "pglite" || Boolean(process.env.DATABASE_URL);
  } catch {
    return false;
  }
}

async function createNeon(): Promise<{ db: Database; close: () => Promise<void> }> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not configured. See docs/SETUP.md.");
  }
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  if (typeof globalThis.WebSocket === "undefined") {
    const ws = await import("ws");
    neonConfig.webSocketConstructor = ws.default as unknown as typeof WebSocket;
  }
  const pool = new Pool({ connectionString: url, max: 5 });
  const db = drizzle(pool, { schema }) as unknown as Database;
  return { db, close: () => pool.end() };
}

async function createPglite(): Promise<{ db: Database; close: () => Promise<void> }> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dataDir = process.env.PGLITE_DATA_DIR;
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as Database;
  return { db, close: () => client.close() };
}

let initPromise: Promise<Database> | null = null;

/**
 * Returns the shared database handle. The first call initialises the driver
 * selected by `DATABASE_DRIVER` / `DATABASE_URL`; later calls reuse it.
 * Missing configuration throws a descriptive error rather than crashing at
 * import time, so pages can distinguish "not configured" from runtime failure.
 */
export function getDb(): Promise<Database> {
  if (globalThis.__lifestoryDb) return Promise.resolve(globalThis.__lifestoryDb.db);
  if (!initPromise) {
    initPromise = (async () => {
      const kind = resolveDriverKind();
      const handle = kind === "neon" ? await createNeon() : await createPglite();
      globalThis.__lifestoryDb = { ...handle, kind };
      return handle.db;
    })();
    initPromise.catch(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

export async function closeDb(): Promise<void> {
  const handle = globalThis.__lifestoryDb;
  globalThis.__lifestoryDb = undefined;
  initPromise = null;
  if (handle) await handle.close();
}

export { schema };
