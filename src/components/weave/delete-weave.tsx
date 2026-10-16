"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";

export function DeleteWeave({ projectId, weaveId, title }: { projectId: string; weaveId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${projectId}/weaves/${weaveId}`, { method: "DELETE" });
      router.push(`/projects/${projectId}/weaves`);
      router.refresh();
    } catch (e) {
      setPending(false);
      setError(e instanceof ApiError ? e.message : "We couldn't delete this conversation. Please try again.");
    }
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-rose/30 bg-white/80 p-4" aria-labelledby="delete-weave-heading">
      <h2 id="delete-weave-heading" className="font-medium text-ink">Delete this conversation</h2>
      <p className="mt-1 text-[0.9rem] leading-relaxed text-ink-2">
        Removes &ldquo;{title}&rdquo;, the names you listed and every original recording in it from private storage. This cannot be undone.
      </p>
      {!confirming ? (
        <Button variant="danger" className="mt-3" onClick={() => setConfirming(true)}>Delete conversation…</Button>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="danger" loading={pending} onClick={remove}>Permanently delete</Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>Keep it</Button>
        </div>
      )}
      {error ? <div className="mt-3"><FormMessage error={error} /></div> : null}
    </section>
  );
}
