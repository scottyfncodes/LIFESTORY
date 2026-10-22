"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, BookOpen, Download, Eye, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { apiFetch, ApiError } from "@/lib/api-client";

export type ChapterRow = {
  id: string;
  title: string;
  subtitle: string | null;
  chapterOrder: number;
  chapterStatus: string;
  needsUpdate: boolean;
  needsUpdateReason: string | null;
  words: number;
  flagCount: number;
  revisionNumber: number;
  excerpt: string;
  plannedCount: number;
};

export function BookOverview({ projectId, chapters, canEdit, aiEnabled, answerCount, draftedCount }: { projectId: string; chapters: ChapterRow[]; canEdit: boolean; aiEnabled: boolean; answerCount: number; draftedCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  async function call<T>(fn: () => Promise<T>, onOk?: (r: T) => void) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const r = await fn();
        onOk?.(r);
        router.refresh();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Something went wrong.");
      }
    });
  }

  function move(index: number, delta: number) {
    const ids = chapters.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void call(() => apiFetch(`/api/projects/${projectId}/chapters`, { method: "POST", body: JSON.stringify({ action: "reorder", orderedIds: ids }) }));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && aiEnabled ? (
          <Button onClick={() => call(() => apiFetch<{ created: number; updated: number }>(`/api/projects/${projectId}/chapters`, { method: "POST", body: JSON.stringify({ action: "propose" }) }), (r) => setMessage(r.created > 0 ? `Proposed ${r.created} new chapter${r.created === 1 ? "" : "s"}.` : "Your chapters already cover the saved answers."))} loading={pending} disabled={answerCount === 0}>
            {chapters.length === 0 ? "Propose chapters" : "Look for new chapters"}
          </Button>
        ) : null}
        {canEdit ? (
          adding ? (
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; void call(() => apiFetch(`/api/projects/${projectId}/chapters`, { method: "POST", body: JSON.stringify({ action: "create", title: title.trim() }) }), () => { setTitle(""); setAdding(false); }); }}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chapter title" aria-label="New chapter title" className="h-10 w-56" maxLength={120} autoFocus />
              <Button type="submit" size="sm" variant="secondary" loading={pending}>Add</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </form>
          ) : (
            <Button variant="secondary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Add a chapter</Button>
          )
        ) : null}
        {draftedCount > 0 ? (
          <>
            <ButtonLink href={`/projects/${projectId}/book/preview`} variant="secondary"><Eye className="h-4 w-4" aria-hidden /> Read the whole book</ButtonLink>
            <a href={`/api/projects/${projectId}/export?format=pdf`} className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-md)] px-3 text-[0.95rem] font-medium text-ink-2 hover:bg-paper-2 hover:text-ink"><Download className="h-4 w-4" aria-hidden /> PDF</a>
            <a href={`/api/projects/${projectId}/export?format=docx`} className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-md)] px-3 text-[0.95rem] font-medium text-ink-2 hover:bg-paper-2 hover:text-ink"><Download className="h-4 w-4" aria-hidden /> Word</a>
          </>
        ) : null}
      </div>
      {!aiEnabled ? <Notice className="mt-4" tone="info">Drafting chapters needs an AI provider, which isn&rsquo;t configured on this server. You can still add chapters and write them yourself.</Notice> : null}
      {message ? <Notice className="mt-4" tone="success">{message}</Notice> : null}
      {error ? <Notice className="mt-4" tone="danger">{error}</Notice> : null}

      {chapters.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={BookOpen} title="The book hasn't been outlined yet" description={answerCount === 0 ? "Chapters come from your answers. Start a conversation and come back when you have a few saved." : aiEnabled ? "Ask LifeStory to propose chapters from what you have said so far. You decide which to keep and when to draft them." : "Add a chapter and draw on your saved answers to write it."} />
        </div>
      ) : (
        <ol className="mt-6 space-y-3">
          {chapters.map((c, i) => (
            <li key={c.id} className="rounded-[var(--radius-lg)] border border-line bg-white p-4 shadow-[var(--shadow-soft)]">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/projects/${projectId}/book/${c.id}`} className="min-w-0 flex-1">
                  <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-ink-3">Chapter {i + 1}</p>
                  <h3 className="mt-0.5 font-serif text-[1.35rem] leading-snug text-ink hover:text-clay-2">{c.title}</h3>
                  {c.subtitle ? <p className="text-[0.9rem] italic text-ink-2">{c.subtitle}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.8rem] text-ink-3">
                    <Badge tone={c.chapterStatus === "planned" ? "neutral" : c.chapterStatus === "needs_review" ? "ochre" : c.chapterStatus === "edited" ? "moss" : "clay"}>{statusLabel(c.chapterStatus)}</Badge>
                    {c.needsUpdate ? <Badge tone="ochre">new answers may belong here</Badge> : null}
                    {c.words > 0 ? <span>{c.words.toLocaleString()} words · revision {c.revisionNumber}</span> : <span>{c.plannedCount} source answer{c.plannedCount === 1 ? "" : "s"} ready</span>}
                    {c.flagCount > 0 ? <span>{c.flagCount} note{c.flagCount === 1 ? "" : "s"} to check</span> : null}
                  </div>
                  {c.excerpt ? <p className="prose-book mt-2 line-clamp-2 text-[1rem] text-ink-2">{c.excerpt}</p> : null}
                </Link>
                {canEdit ? (
                  <div className="flex shrink-0 flex-col gap-0.5">
                    <button type="button" onClick={() => move(i, -1)} disabled={pending || i === 0} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink disabled:opacity-30" aria-label="Move chapter up"><ArrowUp className="h-4 w-4" aria-hidden /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={pending || i === chapters.length - 1} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink disabled:opacity-30" aria-label="Move chapter down"><ArrowDown className="h-4 w-4" aria-hidden /></button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function statusLabel(status: string): string {
  switch (status) {
    case "planned": return "not drafted";
    case "drafted": return "drafted";
    case "edited": return "edited by you";
    case "needs_review": return "needs your review";
    default: return status;
  }
}
