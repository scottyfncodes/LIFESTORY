"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileAudio, RotateCcw, Upload, X } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { resolveWeaveAudioType, WEAVE_ACCEPT_ATTRIBUTE } from "@/lib/validation/weave";
import { Button, Spinner } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { formatBytes } from "./format";
import { RecordingCard } from "./recording-card";
import { newClientUploadId, readDuration, uploadRecording, type RecordingDto, type UploadPhase } from "./upload-recording";

type QueueItem = {
  localId: string;
  file: File;
  clientUploadId: string;
  state: "queued" | UploadPhase | "failed";
  progress: number;
  error: string | null;
};

const PHASE_TEXT: Record<QueueItem["state"], string> = {
  queued: "Waiting",
  preparing: "Preparing",
  uploading: "Uploading",
  verifying: "Checking the file",
  failed: "Not uploaded",
};

export function RecordingsWorkspace({
  projectId,
  weaveId,
  initialRecordings,
  canWrite,
  maxUploadBytes,
  maxRecordings,
  playbackLinkSeconds,
}: {
  projectId: string;
  weaveId: string;
  initialRecordings: RecordingDto[];
  canWrite: boolean;
  maxUploadBytes: number;
  maxRecordings: number;
  playbackLinkSeconds: number | null;
}) {
  const [recordings, setRecordings] = useState<RecordingDto[]>(initialRecordings);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // The queue lives in a ref too, so the one-at-a-time runner always sees the latest list.
  const queueRef = useRef<QueueItem[]>([]);

  const busy = queue.some((q) => q.state !== "failed");

  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const commit = useCallback((update: (list: QueueItem[]) => QueueItem[]) => {
    queueRef.current = update(queueRef.current);
    setQueue(queueRef.current);
  }, []);

  const patchItem = useCallback(
    (localId: string, patch: Partial<QueueItem>) => commit((list) => list.map((q) => (q.localId === localId ? { ...q, ...patch } : q))),
    [commit],
  );

  async function pump(): Promise<void> {
    if (running.current) return;
    const next = queueRef.current.find((q) => q.state === "queued");
    if (!next) return;
    running.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const durationSeconds = await readDuration(next.file);
      const recording = await uploadRecording({
        projectId,
        weaveId,
        file: next.file,
        clientUploadId: next.clientUploadId,
        durationSeconds,
        signal: controller.signal,
        onPhase: (phase) => patchItem(next.localId, { state: phase, progress: phase === "verifying" ? 1 : 0 }),
        onProgress: (fraction) => patchItem(next.localId, { progress: fraction }),
      });
      setRecordings((list) => [...list.filter((r) => r.id !== recording.id), recording]);
      commit((list) => list.filter((q) => q.localId !== next.localId));
    } catch (error) {
      const message = controller.signal.aborted
        ? "Upload cancelled."
        : error instanceof ApiError
          ? error.message
          : "The upload didn't finish. Please try again.";
      patchItem(next.localId, { state: "failed", error: message });
    } finally {
      running.current = false;
      abortRef.current = null;
    }
    // One file at a time, in the order chosen.
    await pump();
  }

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setNotice(null);
    const rejected: string[] = [];
    const accepted: QueueItem[] = [];
    const room = maxRecordings - recordings.length - queue.length;
    for (const file of Array.from(files)) {
      if (!resolveWeaveAudioType(file.type, file.name)) rejected.push(`${file.name} isn't a supported audio file.`);
      else if (file.size === 0) rejected.push(`${file.name} is empty.`);
      else if (file.size > maxUploadBytes) rejected.push(`${file.name} is larger than ${formatBytes(maxUploadBytes)}.`);
      else if (accepted.length >= room) rejected.push(`${file.name} wasn't added: a conversation can hold up to ${maxRecordings} recordings.`);
      else accepted.push({ localId: newClientUploadId(), file, clientUploadId: newClientUploadId(), state: "queued", progress: 0, error: null });
    }
    if (rejected.length) setNotice(rejected.join(" "));
    if (accepted.length) {
      commit((list) => [...list, ...accepted]);
      void pump();
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  const completed = recordings.filter((r) => r.status !== "awaiting_upload" && r.status !== "failed");
  const stuck = recordings.filter((r) => (r.status === "awaiting_upload" || r.status === "failed") && !queue.some((q) => q.clientUploadId === r.clientUploadId));

  return (
    <section aria-labelledby="recordings-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="recordings-heading" className="font-serif text-[1.4rem] text-ink">Recordings</h2>
          <p className="text-[0.875rem] text-ink-3">
            {completed.length === 0 ? "None yet" : `${completed.length} stored`} · up to {maxRecordings}, {formatBytes(maxUploadBytes)} each
          </p>
        </div>
      </div>

      {canWrite ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-line-2 bg-paper-2/60 p-4 sm:p-6">
          <input
            ref={inputRef}
            id="weave-file-input"
            type="file"
            multiple
            accept={WEAVE_ACCEPT_ATTRIBUTE}
            className="sr-only"
            onChange={(e) => addFiles(e.target.files)}
            data-testid="weave-file-input"
          />
          <label htmlFor="weave-file-input" className="flex cursor-pointer flex-col items-center gap-2 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white text-clay shadow-[var(--shadow-soft)]">
              <Upload className="h-5 w-5" aria-hidden />
            </span>
            <span className="inline-flex h-11 items-center rounded-[var(--radius-md)] bg-clay px-4 text-[0.95rem] font-medium text-white shadow-[var(--shadow-soft)]">Add recordings</span>
            <span className="max-w-md text-[0.85rem] leading-relaxed text-ink-3">
              Choose one or more audio files (M4A, MP3, WAV, AAC, WebM or Ogg). On iPhone, Voice Memos can be saved to Files first. Originals are stored privately and never changed.
            </span>
          </label>
        </div>
      ) : null}

      {notice ? <Notice tone="warning">{notice}</Notice> : null}

      {queue.length > 0 ? (
        <ul className="space-y-2" aria-label="Uploads in progress" aria-live="polite">
          {queue.map((item) => (
            <li key={item.localId} className="rounded-[var(--radius-md)] border border-line bg-white/80 p-3" data-testid="upload-item">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 text-ink-3">
                  {item.state === "failed" ? <AlertTriangle className="h-5 w-5 text-rose" aria-hidden /> : item.state === "queued" ? <FileAudio className="h-5 w-5" aria-hidden /> : <Spinner className="h-5 w-5 text-clay" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{item.file.name}</p>
                  <p className="text-[0.825rem] text-ink-3">
                    {formatBytes(item.file.size)} · {PHASE_TEXT[item.state]}
                    {item.state === "uploading" ? ` ${Math.round(item.progress * 100)}%` : ""}
                  </p>
                  {item.state === "uploading" || item.state === "verifying" ? (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)} aria-label={`Uploading ${item.file.name}`}>
                      <div className="h-full bg-clay transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                    </div>
                  ) : null}
                  {item.error ? <p className="mt-1 text-[0.85rem] text-rose" role="alert">{item.error}</p> : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {item.state === "failed" ? (
                    <Button variant="secondary" size="sm" onClick={() => {
                        patchItem(item.localId, { state: "queued", error: null, progress: 0 });
                        void pump();
                      }}>
                      <RotateCcw className="h-4 w-4" aria-hidden /> Retry
                    </Button>
                  ) : null}
                  {item.state === "failed" || item.state === "queued" ? (
                    <Button variant="ghost" size="sm" className="w-9 px-0" aria-label={`Remove ${item.file.name} from the list`} onClick={() => commit((list) => list.filter((q) => q.localId !== item.localId))}>
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>Cancel</Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {stuck.length > 0 ? (
        <ul className="space-y-2">
          {stuck.map((r) => (
            <RecordingCard key={r.id} projectId={projectId} weaveId={weaveId} recording={r} canWrite={canWrite} playbackLinkSeconds={playbackLinkSeconds} onChange={(next) => setRecordings((list) => list.map((x) => (x.id === next.id ? next : x)))} onRemoved={() => setRecordings((list) => list.filter((x) => x.id !== r.id))} />
          ))}
        </ul>
      ) : null}

      {completed.length > 0 ? (
        <ol className="space-y-3">
          {completed.map((r) => (
            <RecordingCard key={r.id} projectId={projectId} weaveId={weaveId} recording={r} canWrite={canWrite} playbackLinkSeconds={playbackLinkSeconds} onChange={(next) => setRecordings((list) => list.map((x) => (x.id === next.id ? next : x)))} onRemoved={() => setRecordings((list) => list.filter((x) => x.id !== r.id))} />
          ))}
        </ol>
      ) : queue.length === 0 ? (
        <p className="text-[0.925rem] text-ink-2">
          <CheckCircle2 className="mr-1 inline h-4 w-4 text-moss" aria-hidden />
          Add the recordings of this conversation. You can add them all at once, in any order.
        </p>
      ) : null}
    </section>
  );
}
