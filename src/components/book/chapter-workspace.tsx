"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, History, Link2, Pencil, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { statusLabel } from "./book-overview";

type Flag = { kind: "uncertain" | "missing" | "conflict"; passage: string; note: string };
type Detail = {
  chapter: { id: string; title: string; subtitle: string | null; focus: string | null; chapterStatus: string; needsUpdate: boolean; needsUpdateReason: string | null; currentRevisionId: string | null; plannedSourceTurnIds: string[] };
  current: { id: string; body: string; revisionNumber: number; generationType: string; flags: Flag[]; createdAt: string } | null;
  revisions: Array<{ id: string; revisionNumber: number; generationType: string; createdAt: string; words: number; flagCount: number }>;
  sources: Array<{ turnId: string; text: string; sessionId: string; createdAt: string }>;
  plannedSources: Array<{ turnId: string; text: string; sessionId: string; createdAt: string }>;
  job: { id: string; status: string; error: string | null; updatedAt: string } | null;
};

export function ChapterWorkspace({ projectId, initial, canEdit, aiEnabled, chapterIndex }: { projectId: string; initial: Detail; canEdit: boolean; aiEnabled: boolean; chapterIndex: number }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail>(initial);
  const [mode, setMode] = useState<"read" | "edit" | "meta">("read");
  const [draftBody, setDraftBody] = useState(initial.current?.body ?? "");
  const [instructions, setInstructions] = useState("");
  const [passageIndex, setPassageIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState<"idle" | "saving" | "drafting" | "restoring" | "deleting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<"sources" | "history" | "notes">("notes");
  const base = `/api/projects/${projectId}/chapters/${detail.chapter.id}`;
  const drafting = detail.job?.status === "queued" || detail.job?.status === "running";

  const reload = useCallback(async (drain = false) => {
    const fresh = await apiFetch<Detail>(`${base}${drain ? "?drain=1" : ""}`);
    setDetail(fresh);
    return fresh;
  }, [base]);

  // Poll while a draft is being written.
  useEffect(() => {
    if (!drafting) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await reload(true);
        if (cancelled) return;
        if (fresh.job?.status === "succeeded") {
          setDraftBody(fresh.current?.body ?? "");
          setNotice("A new draft is ready. Read it through; every passage comes from your own answers.");
          router.refresh();
        } else if (fresh.job?.status === "failed") {
          setError(fresh.job.error ?? "Drafting didn't finish. Your previous text is untouched.");
        } else {
          window.setTimeout(tick, 2500);
        }
      } catch {
        if (!cancelled) window.setTimeout(tick, 5000);
      }
    };
    const t = window.setTimeout(tick, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [drafting, reload, router]);

  async function requestDraft(instr: string | null) {
    setError(null);
    setNotice(null);
    setBusy("drafting");
    try {
      await apiFetch(`${base}/draft`, { method: "POST", body: JSON.stringify({ instructions: instr }) });
      setInstructions("");
      setPassageIndex(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start drafting.");
    } finally {
      setBusy("idle");
    }
  }

  async function saveEdit() {
    setError(null);
    setBusy("saving");
    try {
      await apiFetch(`${base}`, { method: "PATCH", body: JSON.stringify({ action: "edit", body: draftBody, baseRevisionId: detail.current?.id ?? null }) });
      await reload();
      setMode("read");
      setNotice("Saved as a new revision. Earlier versions are kept in the history.");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your edit.");
    } finally {
      setBusy("idle");
    }
  }

  async function restore(revisionId: string) {
    if (!window.confirm("Restore this revision? The current text is kept in the history.")) return;
    setBusy("restoring");
    setError(null);
    try {
      await apiFetch(`${base}/revisions/${revisionId}`, { method: "POST" });
      const fresh = await reload();
      setDraftBody(fresh.current?.body ?? "");
      setNotice("Revision restored.");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't restore that revision.");
    } finally {
      setBusy("idle");
    }
  }

  async function remove() {
    if (!window.confirm("Delete this chapter and all of its revisions? Your answers are not affected.")) return;
    setBusy("deleting");
    try {
      await apiFetch(base, { method: "DELETE" });
      router.push(`/projects/${projectId}/book`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete the chapter.");
      setBusy("idle");
    }
  }

  const paragraphs = detail.current ? detail.current.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
  const flags = detail.current?.flags ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8" style={{ paddingBottom: "calc(2rem + var(--safe-bottom))" }}>
      <Link href={`/projects/${projectId}/book`} className="inline-flex items-center gap-1.5 text-[0.9rem] text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden /> All chapters</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-ink-3">Chapter {chapterIndex}</p>
          <h1 className="font-serif text-[2rem] leading-tight text-ink">{detail.chapter.title}</h1>
          {detail.chapter.subtitle ? <p className="text-[1rem] italic text-ink-2">{detail.chapter.subtitle}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.8rem] text-ink-3">
            <Badge tone={detail.chapter.chapterStatus === "needs_review" ? "ochre" : detail.chapter.chapterStatus === "edited" ? "moss" : "neutral"}>{statusLabel(detail.chapter.chapterStatus)}</Badge>
            {detail.current ? <span>Revision {detail.current.revisionNumber} · {detail.current.generationType.replace("_", " ")} · {formatDateTime(detail.current.createdAt)}</span> : <span>No text yet</span>}
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {mode === "read" && detail.current ? <Button variant="secondary" onClick={() => { setDraftBody(detail.current?.body ?? ""); setMode("edit"); }} disabled={drafting}><Pencil className="h-4 w-4" aria-hidden /> Edit text</Button> : null}
            {mode === "read" ? <Button variant="ghost" onClick={() => setMode("meta")}>Title &amp; focus</Button> : null}
            {aiEnabled && mode === "read" ? (
              <Button onClick={() => requestDraft(null)} loading={busy === "drafting" || drafting} disabled={detail.sources.length + detail.plannedSources.length === 0}>
                <Sparkles className="h-4 w-4" aria-hidden /> {detail.current ? "Redraft from sources" : "Draft this chapter"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {detail.chapter.needsUpdate ? <Notice className="mt-4" tone="warning" title="New material may belong here">{detail.chapter.needsUpdateReason ?? "An answer this chapter draws on changed."} {aiEnabled ? "Redraft when you're ready, or edit the text yourself; nothing changes until you choose." : "Edit the text when you're ready."}</Notice> : null}
      {drafting ? <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-md)] border border-line bg-white px-4 py-3 text-[0.95rem] text-ink-2" role="status" aria-live="polite"><Spinner className="h-4 w-4 text-clay" /> Writing from your answers. This can take a minute or two; you can leave and come back.</div> : null}
      {notice ? <Notice className="mt-4" tone="success">{notice}</Notice> : null}
      {error ? <Notice className="mt-4" tone="danger">{error}</Notice> : null}

      <div className="mt-6 grid gap-8 lg:grid-cols-3">
        <article className="lg:col-span-2">
          {mode === "meta" ? (
            <MetaForm detail={detail} base={base} onDone={async () => { await reload(); setMode("read"); router.refresh(); }} onCancel={() => setMode("read")} />
          ) : mode === "edit" ? (
            <div>
              <Textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} aria-label="Chapter text" className="prose-book min-h-[60vh] text-[1.05rem]" />
              <p className="mt-2 text-[0.85rem] text-ink-3">Leave a blank line between paragraphs. Your original answers are never changed by edits here.</p>
              <div className="mt-3 flex gap-2">
                <Button onClick={saveEdit} loading={busy === "saving"} disabled={!draftBody.trim()}>Save as new revision</Button>
                <Button variant="ghost" onClick={() => setMode("read")}>Cancel</Button>
              </div>
            </div>
          ) : !detail.current ? (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-line-2 bg-paper-2/60 px-6 py-10 text-center">
              <p className="font-serif text-[1.3rem] text-ink">Nothing written yet</p>
              <p className="mt-2 text-[0.95rem] text-ink-2">
                {detail.plannedSources.length > 0
                  ? `${detail.plannedSources.length} answer${detail.plannedSources.length === 1 ? "" : "s"} ready to draw on.`
                  : "Attach the answers this chapter should draw on from the sources panel, or write it yourself."}
              </p>
              {canEdit ? <Button className="mt-4" variant="secondary" onClick={() => { setDraftBody(""); setMode("edit"); }}>Write it myself</Button> : null}
            </div>
          ) : (
            <div className="rounded-[var(--radius-lg)] border border-line bg-white px-5 py-6 shadow-[var(--shadow-soft)] sm:px-10 sm:py-10">
              {paragraphs.map((p, i) => {
                const flagged = flags.some((f) => f.passage && p.includes(f.passage));
                return (
                  <div key={i} className={cn("group relative", passageIndex === i && "rounded-md bg-clay-soft/40 -mx-2 px-2")}>
                    <p className={cn("prose-book", flagged && "border-l-2 border-ochre pl-3")}>{p}</p>
                    {canEdit && aiEnabled && !drafting ? (
                      <button type="button" onClick={() => setPassageIndex(passageIndex === i ? null : i)} className="absolute -right-2 top-0 hidden rounded-md px-1.5 py-0.5 text-[0.72rem] text-ink-3 hover:bg-paper-2 hover:text-ink group-hover:block sm:-right-8" aria-label={`Rework paragraph ${i + 1}`}>rework</button>
                    ) : null}
                    {passageIndex === i ? (
                      <div className="mb-4 rounded-[var(--radius-md)] border border-line bg-paper-2/70 p-3">
                        <p className="text-[0.85rem] text-ink-2">How should this paragraph change? The rest of the chapter stays as it is, and nothing new is invented.</p>
                        <Input className="mt-2" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Keep it shorter and closer to how I said it" aria-label="Instructions for this paragraph" maxLength={600} />
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" onClick={() => requestDraft(`Revise only paragraph ${i + 1} (which begins "${p.slice(0, 60)}"): ${instructions || "rewrite it more faithfully to the source answers"}. Keep every other paragraph exactly as it is.`)} loading={busy === "drafting"}>Rework this paragraph</Button>
                          <Button size="sm" variant="ghost" onClick={() => setPassageIndex(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          {canEdit && aiEnabled && detail.current && mode === "read" && !drafting ? (
            <div className="mt-4 rounded-[var(--radius-md)] border border-line bg-paper-2/60 p-4">
              <p className="text-[0.9rem] font-medium text-ink">Ask for a revision of the whole chapter</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input value={passageIndex === null ? instructions : ""} onChange={(e) => { setPassageIndex(null); setInstructions(e.target.value); }} placeholder="e.g. Put the move to Manchester before the mill job" aria-label="Revision instructions" maxLength={1000} />
                <Button variant="secondary" onClick={() => requestDraft(instructions.trim() || null)} disabled={!instructions.trim()} loading={busy === "drafting"}>Revise</Button>
              </div>
              <p className="mt-2 text-[0.8rem] text-ink-3">Each revision is saved separately; you can always go back.</p>
            </div>
          ) : null}
        </article>

        <aside>
          <div className="flex gap-1 border-b border-line" role="tablist">
            {(["notes", "sources", "history"] as const).map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={panel === tab} onClick={() => setPanel(tab)} className={cn("inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-[0.9rem]", panel === tab ? "border-clay text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
                {tab === "notes" ? <AlertTriangle className="h-4 w-4" aria-hidden /> : tab === "sources" ? <Link2 className="h-4 w-4" aria-hidden /> : <History className="h-4 w-4" aria-hidden />}
                {tab === "notes" ? `Notes${flags.length ? ` (${flags.length})` : ""}` : tab === "sources" ? "Sources" : "History"}
              </button>
            ))}
          </div>
          <div className="mt-4">
            {panel === "notes" ? (
              flags.length === 0 ? <p className="text-[0.9rem] text-ink-2">Nothing flagged in this revision. Uncertain details, missing pieces and conflicting accounts appear here instead of being smoothed over.</p> : (
                <ul className="space-y-3">
                  {flags.map((f, i) => (
                    <li key={i} className="rounded-[var(--radius-md)] border border-line bg-white px-3 py-2.5 text-[0.9rem]">
                      <Badge tone={f.kind === "conflict" ? "rose" : "ochre"}>{f.kind === "missing" ? "could ask more" : f.kind === "conflict" ? "conflicting accounts" : "uncertain"}</Badge>
                      {f.passage ? <p className="mt-1.5 italic text-ink-2">&ldquo;{f.passage}&rdquo;</p> : null}
                      <p className="mt-1 text-ink">{f.note}</p>
                    </li>
                  ))}
                </ul>
              )
            ) : panel === "sources" ? (
              <div className="space-y-3">
                <p className="text-[0.85rem] text-ink-3">{detail.sources.length > 0 ? "This revision was written from these answers." : "No answers linked to this revision yet."}</p>
                {[...detail.sources, ...detail.plannedSources.map((p) => ({ ...p, planned: true }))].map((s) => (
                  <div key={s.turnId} className="rounded-[var(--radius-md)] border border-line bg-white px-3 py-2.5 text-[0.9rem]">
                    {"planned" in s ? <Badge tone="neutral">for the next draft</Badge> : null}
                    <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-ink">{s.text}</p>
                    <Link href={`/projects/${projectId}/interview/${s.sessionId}`} className="mt-1 inline-block text-[0.8rem] text-clay hover:text-clay-2">Open the conversation</Link>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="space-y-2">
                {detail.revisions.map((r) => (
                  <li key={r.id} className={cn("flex items-center justify-between gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-[0.875rem]", r.id === detail.current?.id ? "border-clay/30 bg-clay-soft/40" : "border-line bg-white")}>
                    <span>
                      <span className="font-medium text-ink">Revision {r.revisionNumber}</span>
                      <span className="block text-ink-3">{r.generationType.replace("_", " ")} · {r.words} words · {formatDateTime(r.createdAt)}</span>
                    </span>
                    {canEdit && r.id !== detail.current?.id ? <button type="button" onClick={() => restore(r.id)} disabled={busy !== "idle"} className="inline-flex items-center gap-1 text-ink-3 hover:text-ink"><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore</button> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {canEdit ? <button type="button" onClick={remove} disabled={busy !== "idle"} className="mt-8 inline-flex items-center gap-1 text-[0.85rem] text-ink-3 hover:text-rose"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete chapter</button> : null}
        </aside>
      </div>
    </div>
  );
}

function MetaForm({ detail, base, onDone, onCancel }: { detail: Detail; base: string; onDone: () => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(detail.chapter.title);
  const [subtitle, setSubtitle] = useState(detail.chapter.subtitle ?? "");
  const [focus, setFocus] = useState(detail.chapter.focus ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-4 rounded-[var(--radius-lg)] border border-line bg-white p-5" onSubmit={async (e) => { e.preventDefault(); setSaving(true); setErr(null); try { await apiFetch(base, { method: "PATCH", body: JSON.stringify({ action: "meta", title, subtitle: subtitle || null, focus: focus || null }) }); await onDone(); } catch (x) { setErr(x instanceof ApiError ? x.message : "Couldn't save."); } finally { setSaving(false); } }}>
      <label className="block text-[0.9rem] font-medium text-ink">Title<Input className="mt-1.5" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required /></label>
      <label className="block text-[0.9rem] font-medium text-ink">Subtitle<Input className="mt-1.5" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={160} placeholder="Optional, e.g. 1954–1961" /></label>
      <label className="block text-[0.9rem] font-medium text-ink">What this chapter is about<Textarea className="mt-1.5 min-h-[4rem]" value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={300} placeholder="Guides the next draft. Optional." /></label>
      {err ? <p className="text-[0.85rem] text-rose" role="alert">{err}</p> : null}
      <div className="flex gap-2"><Button type="submit" loading={saving}>Save</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}
