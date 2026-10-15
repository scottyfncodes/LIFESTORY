import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth, type SessionUser } from "@/lib/auth";
import { UnauthorizedError } from "./errors";

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
});

/** For server components: redirects to sign-in when there is no session. */
export async function requireUser(nextPath?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const target = nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in";
    redirect(target);
  }
  return user;
}

/** For route handlers and server actions: throws instead of redirecting. */
export async function requireUserOrThrow(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
