import { closeDb, getDb, type Database } from "@/db";
import { runMigrations } from "@/db/migrate";
import { getAuth } from "@/lib/auth";

/**
 * Creates a fresh in-memory PGlite database with migrations applied. Call in
 * `beforeAll`; call `teardownTestDb` in `afterAll`.
 */
export async function setupTestDb(): Promise<Database> {
  process.env.DATABASE_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
  process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-1234";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
  process.env.RATE_LIMITS_DISABLED ??= "1";
  await closeDb();
  globalThis.__lifestoryAuth = undefined;
  const db = await getDb();
  await runMigrations(db, "pglite");
  return db;
}

export async function teardownTestDb(): Promise<void> {
  await closeDb();
  globalThis.__lifestoryAuth = undefined;
}

let counter = 0;

/** Registers a user through Better Auth and returns its id. */
export async function createTestUser(name = "Test User"): Promise<{ id: string; email: string; headers: Headers }> {
  const auth = await getAuth();
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.test`;
  const result = await auth.api.signUpEmail({
    body: { name, email, password: "correct-horse-battery" },
    returnHeaders: true,
  });
  const cookie = result.headers.get("set-cookie") ?? "";
  const headers = new Headers();
  headers.set("cookie", cookie.split(";")[0]);
  return { id: result.response.user.id, email, headers };
}
