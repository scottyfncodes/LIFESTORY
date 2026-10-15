"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, FileAudio } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { DATE_PRECISIONS } from "@/lib/validation/weave";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { FAILURE_TEXT, formatBytes, formatLength } from "./format";
import type { RecordingDto } from "./upload-recording";

export function RecordingCard({
  projectId,
  weaveId,
  recording,
  canWrite,
  onChange,
  onRemoved,
}: {
  projectId: string;
  weaveId: string;
  recording: RecordingDto;
  canWrite: boolean;
  onChange: (next: RecordingDto) => void;
  onRemoved: () => void;
}) {
  const base = `/api/projects/${projectId}/weaves/${weaveId}/recordings/${recording.id}`;
  const stored = recording.status !== "awaiting_upload" && recording.status !== "failed";
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioKey, setAudioKey] = useState(0);
  const length = formatLength(recording.durationSeconds);

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      await apiFetch(base, { method: "DELETE" });
      onRemoved();
    } catch (e) {
      setRemoving(false);
      setError(e instanceof ApiError ? e.message : "We couldn't remove that recording. Please try again.");
    }
  }

  return (
    <li className="rounded-[var(--radius-lg)] border border-line bg-white/80 p-4" data-testid="recording-card" data-status={recording.status}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          {stored ? <FileAudio className="h-5 w-5 text-clay" aria-hidden /> : <AlertTriangle className="h-5 w-5 text-rose" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium text-ink">{recording.originalFilename}</p>
          <p className="text-[0.825rem] text-ink-3">
            {formatBytes(recording.size)}
            {length ? ` · ${length}` : ""}
            {recording.recordedOn ? ` · recorded ${describeDate(recording.recordedOn, recording.recordedOnPrecision)}` : ""}
          </p>
          {!stored ? (
            <p className="mt-1 text-[0.875rem] text-ink-2">
              {recording.status === "failed" && recording.failureCode ? `${FAILURE_TEXT[recording.failureCode] ?? "The upload was rejected."} ` : "This upload didn't finish. "}
              Remove it and add the file again.
            </p>
          ) : null}
        </div>
      </div>

      {stored ? (
        // preload="none": nothing is fetched until the listener presses play.
        // Seeking works through Range requests; if a short-lived storage link
        // has expired, reloading the element asks the server for a fresh one.
        <audio
          key={audioKey}
          className="mt-3 w-full"
          controls
          preload="none"
          src={`${base}/audio${audioKey ? `?r=${audioKey}` : ""}`}
          onError={() => setAudioKey((k) => (k < 3 ? k + 1 : k))}
        >
          Your browser can&rsquo;t play this recording.
        </audio>
      ) : null}

      {recording.contextNote && !open ? <p className="mt-2 whitespace-pre-wrap text-[0.9rem] leading-relaxed text-ink-2">{recording.contextNote}</p> : null}

      {canWrite ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {stored ? (
            <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden /> {open ? "Close details" : "Date and notes"}
            </Button>
          ) : null}
          {!confirming ? (
            <Button variant="ghost" size="sm" className="text-rose" onClick={() => setConfirming(true)}>Remove</Button>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[0.85rem] text-ink-2">{stored ? "Permanently delete this original?" : "Remove this upload?"}</span>
              <Button variant="danger" size="sm" loading={removing} onClick={remove}>Yes, remove</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Keep</Button>
            </span>
          )}
        </div>
      ) : null}
      {error ? <div className="mt-2"><FormMessage error={error} /></div> : null}

      {open && canWrite ? <DetailsForm base={base} recording={recording} onSaved={(next) => { onChange(next); setOpen(false); }} /> : null}
    </li>
  );
}

function DetailsForm({ base, recording, onSaved }: { base: string; recording: RecordingDto; onSaved: (next: RecordingDto) => void }) {
  const [recordedOn, setRecordedOn] = useState(recording.recordedOn ?? "");
  const [precision, setPrecision] = useState(recording.recordedOnPrecision ?? "exact");
  const [note, setNote] = useState(recording.contextNote ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = recording.id.slice(0, 8);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { recording: next } = await apiFetch<{ recording: RecordingDto }>(base, {
        method: "PATCH",
        body: JSON.stringify({ recordedOn: recordedOn || null, recordedOnPrecision: recordedOn ? precision : null, contextNote: note || null }),
      });
      onSaved(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "We couldn't save that. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
      <Field label="When was it recorded?" htmlFor={`date-${id}`} optional>
        <Input id={`date-${id}`} type="date" value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} />
      </Field>
      <Field label="How sure is that date?" htmlFor={`precision-${id}`}>
        <Select id={`precision-${id}`} value={precision} onChange={(e) => setPrecision(e.target.value)} disabled={!recordedOn}>
          {DATE_PRECISIONS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes about this recording" htmlFor={`note-${id}`} optional>
          <Textarea id={`note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-[4rem]" />
        </Field>
      </div>
      {error ? <div className="sm:col-span-2"><FormMessage error={error} /></div> : null}
      <div className="sm:col-span-2"><Button type="submit" size="sm" loading={pending}>Save details</Button></div>
    </form>
  );
}

function describeDate(value: string, precision: string | null): string {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (precision === "year") return String(y);
  if (precision === "month") return date.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const text = date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return precision === "approximate" ? `around ${text}` : text;
}
