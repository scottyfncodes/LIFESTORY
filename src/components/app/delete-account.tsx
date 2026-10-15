"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";

export function DeleteAccount({ projectCount }: { projectCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <div className="mt-8 rounded-[var(--radius-lg)] border border-rose/30 bg-white/80 p-4">
      <p className="font-medium text-ink">Delete your account</p>
      <p className="mt-1 text-[0.9rem] leading-relaxed text-ink-2">
        This deletes your sign-in and {projectCount === 0 ? "any memoirs you own" : `the ${projectCount} memoir${projectCount === 1 ? "" : "s"} you own`}, including recordings, answers and chapters. Export anything you want to keep first. This cannot be undone.
      </p>
      {!open ? (
        <Button variant="danger" className="mt-3" onClick={() => setOpen(true)}>Delete my account…</Button>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            setError(null);
            const result = await authClient.deleteUser({ password });
            if (result.error) {
              setError(result.error.code === "INVALID_PASSWORD" ? "That password isn't right." : (result.error.message ?? "We couldn't delete the account."));
              setLoading(false);
              return;
            }
            router.push("/");
            router.refresh();
          }}
        >
          <Field label="Confirm your password" htmlFor="delete-password">
            <Input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <FormMessage error={error} />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={loading}>Permanently delete my account</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Keep it</Button>
          </div>
        </form>
      )}
    </div>
  );
}
