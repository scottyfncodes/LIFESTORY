import { z } from "zod";
import { getDb, type Database } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { ForbiddenError, ValidationError, errorResponse } from "./errors";
import { errorCode, log } from "./logger";
import { requireUserOrThrow } from "./session";
import { ensureJobHandlers } from "./jobs/handlers";
import { flattenIssues } from "@/lib/validation/project";

/**
 * Mutating route handlers must come from our own origin. Browsers always
 * send Origin (or at least Sec-Fetch-Site) on cross-site POSTs, so a
 * mismatch means a forged request.
 */
export function assertSameOrigin(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "none") return;
  if (!origin) {
    if (fetchSite === null) return; // non-browser client; cookies alone won't be sent by browsers without Origin
    throw new ForbiddenError("Cross-site requests are not allowed.");
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("Cross-site requests are not allowed.");
  }
  if (!host || originHost !== host) throw new ForbiddenError("Cross-site requests are not allowed.");
}

export type ApiContext = { db: Database; user: SessionUser; request: Request };

export function apiHandler<P extends Record<string, string>>(
  fn: (ctx: ApiContext, params: P) => Promise<Response>,
) {
  return async (request: Request, routeCtx: { params: Promise<P> }): Promise<Response> => {
    try {
      ensureJobHandlers();
      assertSameOrigin(request);
      const user = await requireUserOrThrow();
      const db = await getDb();
      const params = await routeCtx.params;
      return await fn({ db, user, request }, params);
    } catch (error) {
      if (!(error && typeof error === "object" && "status" in error)) {
        log.error("api.unhandled", { path: new URL(request.url).pathname, code: errorCode(error) });
      }
      return errorResponse(error);
    }
  };
}

export async function parseJson<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError("The request body wasn't valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Some of that wasn't valid.", flattenIssues(parsed.error));
  return parsed.data;
}

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}
