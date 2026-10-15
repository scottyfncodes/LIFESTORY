import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });

import { getDb, closeDb, resolveDriverKind } from "../src/db";
import { runMigrations } from "../src/db/migrate";

async function main() {
  const kind = resolveDriverKind();
  if (kind === "neon" && !process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set; nothing to migrate.");
    process.exit(1);
  }
  const db = await getDb();
  await runMigrations(db, kind);
  console.log(`Migrations applied (${kind}).`);
  await closeDb();
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
