import { describe, expect, it } from "vitest";
import { DatabaseConfigError, resolveDriverKind } from "@/db";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("resolveDriverKind", () => {
  it("uses Neon whenever DATABASE_URL is set", () => {
    expect(resolveDriverKind(env({ DATABASE_URL: "postgres://x", VERCEL: "1", NODE_ENV: "production" }))).toBe("neon");
    expect(resolveDriverKind(env({ DATABASE_URL: "postgres://x", NODE_ENV: "development" }))).toBe("neon");
  });

  it("keeps the PGlite fallback for local development and tests", () => {
    expect(resolveDriverKind(env({ NODE_ENV: "development" }))).toBe("pglite");
    expect(resolveDriverKind(env({ NODE_ENV: "test" }))).toBe("pglite");
    expect(resolveDriverKind(env({}))).toBe("pglite");
  });

  it("allows an explicit PGlite choice off Vercel, even for a production build", () => {
    expect(resolveDriverKind(env({ DATABASE_DRIVER: "pglite", NODE_ENV: "production" }))).toBe("pglite");
    expect(resolveDriverKind(env({ DATABASE_DRIVER: "pglite", DATABASE_URL: "" }))).toBe("pglite");
  });

  it("fails loudly on Vercel without DATABASE_URL instead of using temporary storage", () => {
    expect(() => resolveDriverKind(env({ VERCEL: "1" }))).toThrow(DatabaseConfigError);
    expect(() => resolveDriverKind(env({ VERCEL: "1", DATABASE_URL: "" }))).toThrow(/DATABASE_URL is not configured/);
  });

  it("fails loudly in production without DATABASE_URL", () => {
    expect(() => resolveDriverKind(env({ NODE_ENV: "production" }))).toThrow(DatabaseConfigError);
  });

  it("refuses an explicit PGlite choice on Vercel", () => {
    expect(() => resolveDriverKind(env({ VERCEL: "1", DATABASE_DRIVER: "pglite" }))).toThrow(/not supported on Vercel/);
  });

  it("honours an explicit Neon choice", () => {
    expect(resolveDriverKind(env({ DATABASE_DRIVER: "neon", DATABASE_URL: "postgres://x" }))).toBe("neon");
  });
});
