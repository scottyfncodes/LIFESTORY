"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { errorCode, log } from "@/server/logger";

export type AuthState = { error?: string | null; values?: { name?: string; email?: string } };

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Please tell us your name.").max(80),
  email: z.string().trim().email("That doesn't look like a valid email address.").max(254),
  password: z.string().min(10, "Please choose a password of at least 10 characters.").max(128),
  next: z.string().optional(),
  intent: z.string().optional(),
});

const signInSchema = z.object({
  email: z.string().trim().email("That doesn't look like a valid email address.").max(254),
  password: z.string().min(1, "Please enter your password.").max(128),
  next: z.string().optional(),
});

function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/home";
  return next;
}

function friendly(error: unknown): string {
  if (error instanceof APIError) {
    const code = (error.body as { code?: string } | undefined)?.code;
    switch (code) {
      case "USER_ALREADY_EXISTS":
      case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
        return "An account with that email already exists. Try signing in instead.";
      case "INVALID_EMAIL_OR_PASSWORD":
      case "INVALID_PASSWORD":
      case "USER_NOT_FOUND":
      case "CREDENTIAL_ACCOUNT_NOT_FOUND":
        return "That email and password don't match our records.";
      case "PASSWORD_TOO_SHORT":
        return "Please choose a password of at least 10 characters.";
      case "INVALID_EMAIL":
        return "That doesn't look like a valid email address.";
      default:
        return error.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : "We couldn't complete that. Please try again.";
    }
  }
  if (error instanceof Error && /not configured/i.test(error.message)) {
    return "Sign-in is not configured on this server yet.";
  }
  return "We couldn't complete that. Please try again.";
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message, values: { name: String(raw.name ?? ""), email: String(raw.email ?? "") } };
  }
  const { name, email, password, next, intent } = parsed.data;
  try {
    const auth = await getAuth();
    await auth.api.signUpEmail({ body: { name, email, password }, headers: await headers() });
  } catch (error) {
    log.warn("auth.sign_up_failed", { code: errorCode(error), detail: process.env.NODE_ENV === "production" ? undefined : String(error instanceof Error ? error.message : error).slice(0, 200) });
    return { error: friendly(error), values: { name, email } };
  }
  const destination = safeNext(next);
  redirect(destination === "/home" ? `/projects/new${intent ? `?intent=${encodeURIComponent(intent)}` : ""}` : destination);
}

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message, values: { email: String(raw.email ?? "") } };
  }
  const { email, password, next } = parsed.data;
  try {
    const auth = await getAuth();
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (error) {
    log.warn("auth.sign_in_failed", { code: errorCode(error) });
    return { error: friendly(error), values: { email } };
  }
  redirect(safeNext(next));
}
