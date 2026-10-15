import { getDb } from "@/db";
import { ensureJobHandlers } from "@/server/jobs/handlers";
import { runQueuedJobs } from "@/server/jobs";
import { errorResponse } from "@/server/errors";

/**
 * Cron-driven drain (see vercel.json). Authenticated with CRON_SECRET so it
 * cannot be triggered by the public.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    ensureJobHandlers();
    const db = await getDb();
    const ran = await runQueuedJobs(db, { limit: 20 });
    return Response.json({ ran });
  } catch (error) {
    return errorResponse(error);
  }
}
