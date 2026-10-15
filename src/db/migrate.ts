import type { Database } from "./index";

/**
 * Applies the SQL migrations in ./drizzle to the given database using the
 * migrator matching the active driver. Safe to call repeatedly.
 */
export async function runMigrations(db: Database, kind: "neon" | "pglite"): Promise<void> {
  const migrationsFolder = process.env.DRIZZLE_MIGRATIONS_DIR ?? "./drizzle";
  if (kind === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder });
  }
}
