"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, signUpAction, type AuthState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";

export function AuthForm({ mode, next, intent }: { mode: "sign-in" | "sign-up"; next?: string; intent?: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    mode === "sign-up" ? signUpAction : signInAction,
    {},
  );

  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
      <h1 className="font-serif text-[1.9rem] leading-tight text-ink">
        {mode === "sign-up" ? "Begin your story" : "Welcome back"}
      </h1>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-2">
        {mode === "sign-up"
          ? "Create a private account. Your memoir projects are only visible to you."
          : "Sign in to continue where you left off."}
      </p>
      <form action={formAction} className="mt-6 space-y-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {intent ? <input type="hidden" name="intent" value={intent} /> : null}
        {mode === "sign-up" ? (
          <Field label="Your name" htmlFor="name">
            <Input id="name" name="name" autoComplete="name" required maxLength={80} defaultValue={state.values?.name ?? ""} />
          </Field>
        ) : null}
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required defaultValue={state.values?.email ?? ""} />
        </Field>
        <Field label="Password" htmlFor="password" hint={mode === "sign-up" ? "At least 10 characters." : undefined}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            required
            minLength={mode === "sign-up" ? 10 : 1}
          />
        </Field>
        <FormMessage error={state.error} />
        <Button type="submit" className="w-full" size="lg" loading={pending}>
          {mode === "sign-up" ? "Create account" : "Sign in"}
        </Button>
      </form>
      <p className="mt-5 text-center text-[0.9rem] text-ink-2">
        {mode === "sign-up" ? (
          <>Already have an account? <Link className="font-medium text-clay hover:text-clay-2" href={`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link></>
        ) : (
          <>New here? <Link className="font-medium text-clay hover:text-clay-2" href="/sign-up">Create an account</Link></>
        )}
      </p>
    </div>
  );
}
