"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { mergePeopleAction, resolveFactAction, setEventStatusAction, setPersonStatusAction } from "@/app/(app)/projects/[projectId]/memory-actions";
import type { ReviewItem } from "@/server/memory/service";

type Item = Omit<ReviewItem, "createdAt"> & { createdAt: string };

export function ReviewList({ projectId, items }: { projectId: string; items: Item[] }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const remaining = items.filter((i) => !done.has(i.id));
  if (remaining.length === 0) {
    return <p className="rounded-[var(--radius-lg)] border border-dashed border-line-2 bg-paper-2/60 px-5 py-8 text-center text-[0.95rem] text-ink-2">Nothing waiting for you. New items appear here when an answer leaves something uncertain.</p>;
  }
  return (
    <ul className="space-y-3">
      {remaining.map((item) => (
        <ReviewRow key={item.id} projectId={projectId} item={item} onDone={() => setDone((s) => new Set(s).add(item.id))} />
      ))}
    </ul>
  );
}

function kindLabel(kind: Item["kind"]): { label: string; tone: "clay" | "ochre" | "rose" | "neutral" } {
  switch (kind) {
    case "conflict": return { label: "Conflicting accounts", tone: "rose" };
    case "duplicate_person": return { label: "Same person?", tone: "ochre" };
    case "proposed_person": return { label: "New person", tone: "clay" };
    case "proposed_event": return { label: "New event", tone: "clay" };
    default: return { label: "Uncertain detail", tone: "ochre" };
  }
}

function ReviewRow({ projectId, item, onDone }: { projectId: string; item: Item; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { label, tone } = kindLabel(item.kind);

  function run(fn: () => Promise<{ error?: string | null }>) {
    startTransition(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else onDone();
    });
  }

  const other = item.payload as { otherPersonId?: string; otherPersonName?: string };

  return (
    <li className="rounded-[var(--radius-lg)] border border-line bg-white p-4 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center gap-2"><Badge tone={tone}>{label}</Badge></div>
      <p className="mt-2 text-[1rem] leading-relaxed text-ink">{item.statement}</p>
      {item.evidence ? <p className="mt-1.5 border-l-2 border-line pl-3 text-[0.9rem] italic leading-relaxed text-ink-2">&ldquo;{item.evidence}&rdquo;</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.kind === "duplicate_person" && item.subjectId && other.otherPersonId ? (
          <>
            <Button size="sm" loading={pending} onClick={() => run(async () => { const fd = new FormData(); fd.set("duplicateId", item.subjectId!); return mergePeopleAction(projectId, other.otherPersonId!, fd); })}><Check className="h-4 w-4" aria-hidden /> Same person, merge</Button>
            <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => setPersonStatusAction(projectId, item.subjectId!, "confirmed"))}>Different people</Button>
            <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => setPersonStatusAction(projectId, item.subjectId!, "rejected"))}><X className="h-4 w-4" aria-hidden /> Not a real person</Button>
          </>
        ) : item.kind === "proposed_person" && item.subjectId ? (
          <>
            <Button size="sm" loading={pending} onClick={() => run(() => setPersonStatusAction(projectId, item.subjectId!, "confirmed"))}><Check className="h-4 w-4" aria-hidden /> Yes, add them</Button>
            <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => setPersonStatusAction(projectId, item.subjectId!, "rejected"))}><X className="h-4 w-4" aria-hidden /> No</Button>
          </>
        ) : item.kind === "proposed_event" && item.subjectId ? (
          <>
            <Button size="sm" loading={pending} onClick={() => run(() => setEventStatusAction(projectId, item.subjectId!, "confirmed"))}><Check className="h-4 w-4" aria-hidden /> Yes, add it</Button>
            <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => setEventStatusAction(projectId, item.subjectId!, "rejected"))}><X className="h-4 w-4" aria-hidden /> No</Button>
          </>
        ) : (
          <>
            <Button size="sm" loading={pending} onClick={() => run(() => resolveFactAction(projectId, item.id, "confirm"))}><Check className="h-4 w-4" aria-hidden /> {item.kind === "conflict" ? "Use the newer account" : "That's right"}</Button>
            <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => resolveFactAction(projectId, item.id, "reject"))}><X className="h-4 w-4" aria-hidden /> {item.kind === "conflict" ? "Keep the earlier account" : "Not right"}</Button>
          </>
        )}
        {item.sourceTurnId ? <Link href={`/projects/${projectId}/interview/history`} className="ml-auto text-[0.85rem] text-ink-3 hover:text-ink">See the answer</Link> : null}
      </div>
      {error ? <p className="mt-2 text-[0.85rem] text-rose" role="alert">{error}</p> : null}
    </li>
  );
}
