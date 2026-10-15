"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { setThreadStatusAction } from "@/app/(app)/projects/[projectId]/memory-actions";

export type ThreadRow = { id: string; title: string; summary: string; status: string; suggestedFollowUp: string | null; importance: string };

export function ThreadList({ projectId, threads, canEdit }: { projectId: string; threads: ThreadRow[]; canEdit: boolean }) {
  const [rows, setRows] = useState(threads);
  const [pending, startTransition] = useTransition();
  if (rows.length === 0) return <p className="text-[0.95rem] leading-relaxed text-ink-2">Stories that deserve more time will be kept here as they come up.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((t) => (
        <li key={t.id} className="rounded-[var(--radius-md)] border border-line bg-white/80 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-ink">{t.title}</p>
            <Badge tone={t.status === "covered" ? "moss" : t.status === "deferred" ? "neutral" : "clay"}>{t.status === "covered" ? "told" : t.status === "deferred" ? "set aside" : t.status === "in_progress" ? "in progress" : "open"}</Badge>
          </div>
          {t.summary ? <p className="mt-0.5 text-[0.875rem] text-ink-2">{t.summary}</p> : null}
          {canEdit && t.status !== "covered" ? (
            <div className="mt-2 flex gap-3 text-[0.8rem]">
              {t.status === "deferred" ? (
                <button type="button" disabled={pending} className="text-clay hover:text-clay-2" onClick={() => startTransition(async () => { const r = await setThreadStatusAction(projectId, t.id, "open"); if (!r.error) setRows((rs) => rs.map((x) => (x.id === t.id ? { ...x, status: "open" } : x))); })}>Bring it back</button>
              ) : (
                <button type="button" disabled={pending} className="text-ink-3 hover:text-ink" onClick={() => startTransition(async () => { const r = await setThreadStatusAction(projectId, t.id, "deferred"); if (!r.error) setRows((rs) => rs.map((x) => (x.id === t.id ? { ...x, status: "deferred" } : x))); })}>Set aside</button>
              )}
              <button type="button" disabled={pending} className="text-ink-3 hover:text-rose" onClick={() => startTransition(async () => { const r = await setThreadStatusAction(projectId, t.id, "excluded"); if (!r.error) setRows((rs) => rs.filter((x) => x.id !== t.id)); })}>Don&rsquo;t ask about this</button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
