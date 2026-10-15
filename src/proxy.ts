import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PROTECTED_PREFIXES = ["/home", "/projects", "/account"];

/**
 * Lightweight gate: redirects clearly-unauthenticated visitors away from app
 * routes. Real authorization happens server-side in each page and action.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  const cookie = getSessionCookie(request, { cookiePrefix: "lifestory" });
  if (!cookie) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/home/:path*", "/projects/:path*", "/account/:path*"],
};
