import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/db";
import { aiProviderName, storageProviderName, transcriptionProviderName, weaveStorageProviderName } from "@/server/config";
import { isAuthConfigured } from "@/lib/auth";

/** Operational status without secrets: which capabilities are configured and whether the database answers. */
export async function GET() {
  let database: "ok" | "unconfigured" | "error" = "unconfigured";
  if (isDatabaseConfigured()) {
    try {
      const db = await getDb();
      await db.execute(sql`select 1`);
      database = "ok";
    } catch {
      database = "error";
    }
  }
  const body = {
    status: database === "ok" && isAuthConfigured() ? "ok" : "degraded",
    database,
    auth: isAuthConfigured() ? "ok" : "unconfigured",
    ai: aiProviderName(),
    transcription: transcriptionProviderName(),
    storage: storageProviderName(),
    // Conversation Weave originals have their own store; "none" means their uploads are refused.
    weaveStorage: weaveStorageProviderName(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  };
  return Response.json(body, { status: body.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
}
