import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb, type Database } from "@/db";
import * as schema from "@/db/schema";

export const AUTH_COOKIE_PREFIX = "lifestory";

function appUrl(): string {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

function buildAuth(db: Database) {
  const url = appUrl();
  const trusted = new Set<string>([url]);
  if (process.env.NEXT_PUBLIC_APP_URL) trusted.add(process.env.NEXT_PUBLIC_APP_URL);
  if (process.env.VERCEL_URL) trusted.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_BRANCH_URL) trusted.add(`https://${process.env.VERCEL_BRANCH_URL}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    trusted.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }
  return betterAuth({
    appName: "LifeStory",
    baseURL: url,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          const { deleteAllOwnedProjects } = await import("@/server/deletion");
          await deleteAllOwnedProjects(db, user.id);
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    rateLimit: {
      enabled: process.env.NODE_ENV === "production",
      window: 60,
      max: 20,
    },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: process.env.NODE_ENV === "production",
    },
    trustedOrigins: Array.from(trusted),
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof buildAuth>;
export type Session = Auth["$Infer"]["Session"];
export type SessionUser = Session["user"];

declare global {
  var __lifestoryAuth: Promise<Auth> | undefined;
}

/**
 * Better Auth needs a database handle at construction time and our driver is
 * initialised asynchronously, so the auth instance is created lazily and
 * cached for the lifetime of the process.
 */
export function getAuth(): Promise<Auth> {
  if (!globalThis.__lifestoryAuth) {
    globalThis.__lifestoryAuth = getDb().then(buildAuth);
    globalThis.__lifestoryAuth.catch(() => {
      globalThis.__lifestoryAuth = undefined;
    });
  }
  return globalThis.__lifestoryAuth;
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET);
}
