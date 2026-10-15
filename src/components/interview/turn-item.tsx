"use client";

import { useState } from "react";
import { Mic, Pencil, Play, Square, Trash2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { formatDuration } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import type { WorkspaceTurn } from "./types";

export function InterviewerTurn({ turn, current }: { turn: WorkspaceTurn; current: boolean }) {
  return (
    <div className={cn("rounded-[var(--radius-lg)] px-5 py-4", current ? "border border-clay/25 bg-white shadow-[var(--shadow-soft)]" : "bg-paper-2/60")}>
      <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-ink-3">{current ? "Current question" : "Interviewer"}</p>
      <p className={cn("mt-1.5 font-serif leading-snug text-ink", current ? "text-[1.35rem] sm:text-[1.5rem]" : "text-[1.1rem]")}>{turn.originalText}</p>
    </div>
  );
}

export function NarratorTurn({
  turn,
  projectId,
  onCorrect,
  onDeleteAudio,
  readOnly,
}: {
  turn: WorkspaceTurn;
  projectId: string;
  onCorrect: (turnId: string, text: string) => Promise<void>;
  onDeleteAudio: (assetId: string) => Promise<void>;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(turn.correctedText ?? turn.originalText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = turn.correctedText ?? turn.originalText;
  const audio = turn.media.find((m) => !m.deleted && m.processingStatus !== "pending_upload");

  if (turn.skipped) {
    return (
      <div className="px-5 py-2 text-[0.875rem] italic text-ink-3">Skipped this question.</div>
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onCorrect(turn.id, draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the correction.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn("rounded-[var(--radius-lg)] border px-5 py-4", turn.pending ? "border-dashed border-line-2 bg-white/60" : "border-line bg-white")}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[0.72rem] font-medium uppercase tracking-[0.12em] text-ink-3">
          {turn.inputMode === "voice" ? <Mic className="h-3.5 w-3.5" aria-hidden /> : null}
          {turn.inputMode === "voice" ? "Spoken" : "Typed"}
          {turn.correctedText ? " · corrected" : ""}
          {turn.pending ? " · saving…" : ""}
        </p>
        {!readOnly && !turn.pending && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[0.8rem] text-ink-3 hover:bg-paper-2 hover:text-ink">
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Correct your answer" className="min-h-[6rem]" />
          {error ? <p className="text-[0.85rem] text-rose" role="alert">{error}</p> : null}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} loading={saving} disabled={!draft.trim()}>Save correction</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(text); setError(null); }}>Cancel</Button>
          </div>
          <p className="text-[0.8rem] text-ink-3">Your original words are kept alongside the correction.</p>
        </div>
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap text-[1rem] leading-relaxed text-ink">{text}</p>
      )}
      {audio ? <AudioControls projectId={projectId} assetId={audio.id} duration={audio.durationSeconds} onDelete={readOnly ? undefined : onDeleteAudio} /> : null}
    </div>
  );
}

function AudioControls({ projectId, assetId, duration, onDelete }: { projectId: string; assetId: string; duration: number | null; onDelete?: (assetId: string) => Promise<void> }) {
  const [playing, setPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [busy, setBusy] = useState(false);
  const src = `/api/projects/${projectId}/media/${assetId}`;

  function toggle() {
    let el = audioEl;
    if (!el) {
      el = new Audio(src);
      el.onended = () => setPlaying(false);
      el.onerror = () => setPlaying(false);
      setAudioEl(el);
    }
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.8rem] text-ink-3">
      <button type="button" onClick={toggle} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-paper px-3 text-ink-2 hover:bg-paper-2" aria-label={playing ? "Pause recording" : "Play recording"}>
        {playing ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
        {playing ? "Pause" : "Play recording"}
      </button>
      <span className="inline-flex items-center gap-1"><Volume2 className="h-3.5 w-3.5" aria-hidden />{duration !== null ? formatDuration(duration) : "audio"}</span>
      {onDelete ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm("Delete this recording? Your transcript will be kept.")) return;
            setBusy(true);
            try {
              audioEl?.pause();
              await onDelete(assetId);
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-ink-3 hover:bg-rose-soft hover:text-rose"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete audio
        </button>
      ) : null}
    </div>
  );
}
