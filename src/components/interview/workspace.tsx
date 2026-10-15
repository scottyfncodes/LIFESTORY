"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, History, Mic, MoreHorizontal, Pause, Play, Send, SkipForward, Square, Trash2, Type } from "lucide-react";
import { Button, Spinner } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatDuration } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { InterviewerTurn, NarratorTurn } from "./turn-item";
import { useRecorder, isRecordingSupported } from "./use-recorder";
import { useDictation, isDictationSupported } from "./use-dictation";
import type { Capabilities, SessionInfo, WorkspaceTurn } from "./types";

type Props = {
  projectId: string;
  session: SessionInfo;
  narratorName: string;
  mode: "self_guided" | "hosted";
  initialTurns: WorkspaceTurn[];
  capabilities: Capabilities;
  welcome: boolean;
  readOnly: boolean;
};

type ServerTurn = {
  id: string;
  sequenceNumber: number;
  speakerType: "interviewer" | "narrator" | "system";
  inputMode: "text" | "voice" | "generated";
  originalText: string;
  correctedText: string | null;
  createdAt: string;
  metadata: { skipped?: boolean; processingStatus?: string };
};

type PendingSubmission = {
  clientTurnId: string;
  text: string;
  inputMode: "text" | "voice";
  mediaAssetId: string | null;
  transcriptEdited: boolean;
  skip?: boolean;
};

type Review = {
  assetId: string | null;
  transcript: string | null;
  text: string;
  error: string | null;
  transcriptionAvailable: boolean;
  durationSeconds: number | null;
  retrying: boolean;
};

function toWorkspaceTurn(t: ServerTurn): WorkspaceTurn {
  return {
    id: t.id,
    sequenceNumber: t.sequenceNumber,
    speaker: t.speakerType,
    inputMode: t.inputMode,
    originalText: t.originalText,
    correctedText: t.correctedText,
    skipped: Boolean(t.metadata?.skipped),
    createdAt: t.createdAt,
    processingStatus: t.metadata?.processingStatus ?? null,
    media: [],
  };
}

function storageKey(kind: "draft" | "pending", sessionId: string): string {
  return `lifestory:${kind}:${sessionId}`;
}

function readLocal<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: unknown | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode); autosave is best-effort.
  }
}

export function InterviewWorkspace({ projectId, session, narratorName, mode, initialTurns, capabilities, welcome, readOnly }: Props) {
  const router = useRouter();
  const [turns, setTurns] = useState<WorkspaceTurn[]>(initialTurns);
  const [status, setStatus] = useState<SessionInfo["status"]>(session.status);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"idle" | "saving" | "thinking" | "skipping" | "uploading" | "transcribing">("idle");
  const [error, setError] = useState<{ message: string; retry?: () => void } | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [showWelcome, setShowWelcome] = useState(welcome);
  const [menuOpen, setMenuOpen] = useState(false);
  const [micMode, setMicMode] = useState<"record" | "dictate">(capabilities.transcription && capabilities.storage ? "record" : "dictate");
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef<PendingSubmission | null>(null);
  const hydrated = useRef(false);

  const base = `/api/projects/${projectId}/sessions/${session.id}`;
  // Browser capabilities are only known after hydration; render without them first.
  const [support, setSupport] = useState({ record: false, dictate: false });
  useEffect(() => {
    setSupport({ record: isRecordingSupported(), dictate: isDictationSupported() });
  }, []);
  const canRecord = capabilities.storage && support.record;
  const canDictate = support.dictate;
  const interactive = !readOnly && (status === "active" || status === "paused");

  const recorder = useRecorder(capabilities.maxRecordingSeconds);
  const dictation = useDictation((finalText) => {
    setText((prev) => (prev.trim() ? `${prev.trimEnd()} ${finalText}` : finalText));
  });

  // Restore an unsaved draft and retry any submission that was interrupted.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const draft = readLocal<string>(storageKey("draft", session.id));
    if (draft) setText(draft);
    const pending = readLocal<PendingSubmission>(storageKey("pending", session.id));
    if (pending && interactive) {
      pendingRef.current = pending;
      void submit(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    writeLocal(storageKey("draft", session.id), text.trim() ? text : null);
  }, [text, session.id]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns.length, busy, review]);

  const currentQuestion = useMemo(() => {
    const last = turns[turns.length - 1];
    return last && last.speaker === "interviewer" ? last : null;
  }, [turns]);

  const submit = useCallback(
    async (submission: PendingSubmission) => {
      setError(null);
      writeLocal(storageKey("pending", session.id), submission);
      pendingRef.current = submission;
      if (submission.skip) setBusy("skipping");
      else {
        setBusy("saving");
        setTurns((prev) => {
          if (prev.some((t) => t.id === `pending:${submission.clientTurnId}`)) return prev;
          return [
            ...prev,
            {
              id: `pending:${submission.clientTurnId}`,
              sequenceNumber: (prev[prev.length - 1]?.sequenceNumber ?? 0) + 1,
              speaker: "narrator",
              inputMode: submission.inputMode,
              originalText: submission.text,
              correctedText: null,
              skipped: false,
              createdAt: new Date().toISOString(),
              processingStatus: null,
              media: [],
              pending: true,
            },
          ];
        });
      }
      try {
        const url = submission.skip ? `${base}/skip` : `${base}/answers`;
        const body = submission.skip
          ? { clientTurnId: submission.clientTurnId }
          : { text: submission.text, inputMode: submission.inputMode, clientTurnId: submission.clientTurnId, mediaAssetId: submission.mediaAssetId, transcriptEdited: submission.transcriptEdited };
        setBusy(submission.skip ? "skipping" : "thinking");
        const result = await apiFetch<{ answer: ServerTurn; nextQuestion: ServerTurn | null; duplicate: boolean }>(url, { method: "POST", body: JSON.stringify(body) });
        setTurns((prev) => {
          const withoutPending = prev.filter((t) => t.id !== `pending:${submission.clientTurnId}` && t.id !== result.answer.id && t.id !== result.nextQuestion?.id);
          const answer = toWorkspaceTurn(result.answer);
          if (submission.mediaAssetId && !submission.skip) {
            answer.media = [{ id: submission.mediaAssetId, processingStatus: "transcribed", durationSeconds: null, deleted: false }];
          }
          const next = result.nextQuestion ? [toWorkspaceTurn(result.nextQuestion)] : [];
          return [...withoutPending, answer, ...next].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
        });
        writeLocal(storageKey("pending", session.id), null);
        writeLocal(storageKey("draft", session.id), null);
        pendingRef.current = null;
        setText("");
        setReview(null);
        setStatus("active");
        setBusy("idle");
        if (!submission.skip) window.setTimeout(() => textareaRef.current?.focus(), 50);
      } catch (e) {
        setBusy("idle");
        const message = e instanceof ApiError ? e.message : "We couldn't save that. Your words are kept on this device until it goes through.";
        if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
          writeLocal(storageKey("pending", session.id), null);
          pendingRef.current = null;
          setTurns((prev) => prev.filter((t) => t.id !== `pending:${submission.clientTurnId}`));
          if (e.status === 409) setStatus("completed");
          setError({ message });
          return;
        }
        setError({ message, retry: () => void submit(submission) });
      }
    },
    [base, session.id],
  );

  function newClientTurnId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function handleSendText() {
    const value = text.trim();
    if (!value || busy !== "idle") return;
    if (dictation.listening) dictation.stop();
    void submit({ clientTurnId: newClientTurnId(), text: value, inputMode: "text", mediaAssetId: null, transcriptEdited: false });
  }

  function handleSkip() {
    if (busy !== "idle") return;
    void submit({ clientTurnId: newClientTurnId(), text: "", inputMode: "text", mediaAssetId: null, transcriptEdited: false, skip: true });
  }

  async function uploadRecording(blob: Blob, mimeType: string, durationSeconds: number) {
    setBusy("uploading");
    setError(null);
    const form = new FormData();
    form.append("file", blob, `recording.${mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm"}`);
    form.append("durationSeconds", String(durationSeconds));
    try {
      setBusy("transcribing");
      const result = await apiFetch<{ assetId: string; status: string; transcript: string | null; transcriptionError: string | null; transcriptionAvailable: boolean; durationSeconds: number | null }>(`${base}/recordings`, { method: "POST", body: form });
      setReview({
        assetId: result.assetId,
        transcript: result.transcript,
        text: result.transcript ?? "",
        error: result.transcriptionError,
        transcriptionAvailable: result.transcriptionAvailable,
        durationSeconds: result.durationSeconds ?? durationSeconds,
        retrying: false,
      });
      recorder.reset();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "We couldn't upload the recording.";
      setError({ message, retry: () => void uploadRecording(blob, mimeType, durationSeconds) });
    } finally {
      setBusy("idle");
    }
  }

  useEffect(() => {
    if (recorder.state.phase === "stopped") {
      const { blob, mimeType, durationSeconds } = recorder.state;
      void uploadRecording(blob, mimeType, durationSeconds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.state.phase]);

  async function retryTranscription() {
    if (!review?.assetId) return;
    setReview((r) => (r ? { ...r, retrying: true, error: null } : r));
    try {
      const result = await apiFetch<{ transcript: string | null; transcriptionError: string | null }>(`/api/projects/${projectId}/media/${review.assetId}/transcribe`, { method: "POST" });
      setReview((r) => (r ? { ...r, retrying: false, transcript: result.transcript, text: result.transcript ?? r.text, error: result.transcriptionError } : r));
    } catch (e) {
      setReview((r) => (r ? { ...r, retrying: false, error: e instanceof ApiError ? e.message : "Transcription failed again." } : r));
    }
  }

  function confirmReview() {
    if (!review || !review.text.trim() || busy !== "idle") return;
    void submit({
      clientTurnId: newClientTurnId(),
      text: review.text.trim(),
      inputMode: "voice",
      mediaAssetId: review.assetId,
      transcriptEdited: review.transcript === null || review.text.trim() !== review.transcript.trim(),
    });
  }

  async function discardReview() {
    if (review?.assetId) {
      await apiFetch(`/api/projects/${projectId}/media/${review.assetId}`, { method: "DELETE" }).catch(() => undefined);
    }
    setReview(null);
  }

  async function correct(turnId: string, corrected: string) {
    const result = await apiFetch<{ turn: ServerTurn }>(`/api/projects/${projectId}/turns/${turnId}`, { method: "PATCH", body: JSON.stringify({ correctedText: corrected }) });
    setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, correctedText: result.turn.correctedText } : t)));
  }

  async function deleteAudio(assetId: string) {
    await apiFetch(`/api/projects/${projectId}/media/${assetId}`, { method: "DELETE" });
    setTurns((prev) => prev.map((t) => ({ ...t, media: t.media.map((m) => (m.id === assetId ? { ...m, deleted: true } : m)) })));
  }

  async function setSessionStatus(next: "paused" | "completed" | "active") {
    setMenuOpen(false);
    try {
      await apiFetch(`${base}/status`, { method: "POST", body: JSON.stringify({ status: next }) });
      setStatus(next);
      if (next === "completed") router.push(`/projects/${projectId}`);
      if (next === "paused") router.push(`/projects/${projectId}`);
    } catch (e) {
      setError({ message: e instanceof ApiError ? e.message : "Couldn't update the session." });
    }
  }

  const recording = recorder.state.phase === "recording";
  const thinking = busy === "thinking" || busy === "skipping";

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col sm:h-[calc(100dvh-4rem)]">
      <header className="shrink-0 border-b border-line/70 bg-paper">
        <div className="mx-auto flex h-12 w-full max-w-3xl items-center justify-between gap-2 px-3 sm:px-6">
          <Link href={`/projects/${projectId}`} className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-[0.9rem] text-ink-2 hover:bg-paper-2 hover:text-ink">
            <ArrowLeft className="h-4 w-4" aria-hidden /> <span>Overview</span>
          </Link>
          <p className="min-w-0 truncate text-center text-[0.85rem] text-ink-3">
            {status === "completed" ? "Finished conversation" : status === "paused" ? "Paused conversation" : `Talking with ${narratorName}`}
          </p>
          <div className="relative flex items-center gap-1">
            <Link href={`/projects/${projectId}/interview/history`} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="Previous conversations">
              <History className="h-4 w-4" aria-hidden />
            </Link>
            {interactive ? (
              <>
                <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="Session options">
                  <MoreHorizontal className="h-5 w-5" aria-hidden />
                </button>
                {menuOpen ? (
                  <div role="menu" className="absolute right-0 top-10 z-20 w-56 rounded-[var(--radius-md)] border border-line bg-white p-1 shadow-[var(--shadow-lift)]">
                    <button role="menuitem" type="button" onClick={() => setSessionStatus("paused")} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[0.9rem] text-ink hover:bg-paper-2"><Pause className="h-4 w-4" aria-hidden /> Pause for now</button>
                    <button role="menuitem" type="button" onClick={() => setSessionStatus("completed")} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[0.9rem] text-ink hover:bg-paper-2"><Check className="h-4 w-4" aria-hidden /> Finish this conversation</button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-4 sm:px-6 sm:py-6">
          {showWelcome ? (
            <Notice tone="info" title={mode === "hosted" ? `Interviewing ${narratorName} together` : "How this works"}>
              <p>
                {mode === "hosted"
                  ? `Read each question aloud, then record or type ${narratorName}'s answer. `
                  : "Answer in your own words, out loud or by typing. "}
                One question at a time, no wrong answers. Skip anything, pause whenever you like, and correct an answer later if a word came out wrong.
              </p>
              <button type="button" onClick={() => setShowWelcome(false)} className="mt-2 text-[0.85rem] font-medium text-clay hover:text-clay-2">Got it</button>
            </Notice>
          ) : null}
          {turns.map((turn, i) =>
            turn.speaker === "interviewer" ? (
              <InterviewerTurn key={turn.id} turn={turn} current={i === turns.length - 1 && !thinking && interactive} />
            ) : (
              <NarratorTurn key={turn.id} turn={turn} projectId={projectId} onCorrect={correct} onDeleteAudio={deleteAudio} readOnly={!interactive} />
            ),
          )}
          {thinking ? (
            <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-white px-5 py-4 text-[0.95rem] text-ink-2" role="status" aria-live="polite">
              <Spinner className="h-4 w-4 text-clay" /> {busy === "skipping" ? "Moving on…" : "Saved. Thinking about what to ask next…"}
            </div>
          ) : null}
          {status === "completed" && !readOnly ? (
            <div className="rounded-[var(--radius-lg)] border border-line bg-paper-2/60 px-5 py-4 text-[0.95rem] text-ink-2">
              This conversation is finished. <Link href={`/projects/${projectId}/interview?new=1`} className="font-medium text-clay hover:text-clay-2">Start a new one</Link> whenever you&rsquo;re ready.
            </div>
          ) : null}
        </div>
      </div>

      {interactive ? (
        <div className="shrink-0 border-t border-line bg-paper" style={{ paddingBottom: "var(--safe-bottom)" }}>
          <div className="mx-auto w-full max-w-3xl px-3 pt-3 pb-3 sm:px-6">
            {error ? (
              <Notice tone="danger" className="mb-3">
                <span>{error.message}</span>
                {error.retry ? <button type="button" onClick={error.retry} className="ml-2 font-medium text-clay hover:text-clay-2">Try again</button> : null}
              </Notice>
            ) : null}

            {review ? (
              <div className="rounded-[var(--radius-lg)] border border-clay/25 bg-white p-4 shadow-[var(--shadow-soft)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-ink-3">
                    Recording saved{review.durationSeconds ? ` · ${formatDuration(review.durationSeconds)}` : ""}
                  </p>
                  {review.retrying ? <Spinner className="h-4 w-4 text-clay" /> : null}
                </div>
                {review.transcript !== null ? (
                  <p className="mt-1 text-[0.9rem] text-ink-2">Here is what we heard. Fix anything that&rsquo;s off before you keep it.</p>
                ) : review.transcriptionAvailable ? (
                  <p className="mt-1 text-[0.9rem] text-ink-2">{review.error ?? "Transcription didn't come through."} You can retry, or type what you said and keep the recording attached.</p>
                ) : (
                  <p className="mt-1 text-[0.9rem] text-ink-2">Transcription isn&rsquo;t set up on this server yet, so type what you said. The recording stays attached to your answer.</p>
                )}
                <Textarea
                  className="mt-3 min-h-[6rem]"
                  value={review.text}
                  onChange={(e) => setReview((r) => (r ? { ...r, text: e.target.value } : r))}
                  aria-label="Transcript of your recording"
                  placeholder="What you said…"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={confirmReview} disabled={!review.text.trim() || busy !== "idle"} loading={busy === "saving" || busy === "thinking"}>
                    <Check className="h-4 w-4" aria-hidden /> Keep this answer
                  </Button>
                  {review.transcriptionAvailable && review.transcript === null ? (
                    <Button variant="secondary" onClick={retryTranscription} loading={review.retrying}>Retry transcription</Button>
                  ) : null}
                  <Button variant="ghost" onClick={discardReview}><Trash2 className="h-4 w-4" aria-hidden /> Discard</Button>
                </div>
              </div>
            ) : recording || recorder.state.phase === "requesting" ? (
              <div className="rounded-[var(--radius-lg)] border border-rose/30 bg-white p-4 shadow-[var(--shadow-soft)]">
                <div className="flex items-center gap-3">
                  <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-rose-soft text-rose rec-ring" aria-hidden>
                    <Mic className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink" role="status" aria-live="polite">
                      {recorder.state.phase === "recording" ? `Recording ${formatDuration(recorder.state.elapsed)}` : "Waiting for microphone permission…"}
                    </p>
                    <p className="text-[0.85rem] text-ink-3">Up to {formatDuration(capabilities.maxRecordingSeconds)}. Take your time.</p>
                  </div>
                  <Button onClick={recorder.stop} disabled={recorder.state.phase !== "recording"}><Square className="h-4 w-4" aria-hidden /> Stop</Button>
                  <Button variant="ghost" onClick={recorder.discard} aria-label="Discard recording"><Trash2 className="h-4 w-4" aria-hidden /></Button>
                </div>
              </div>
            ) : busy === "uploading" || busy === "transcribing" ? (
              <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-white px-4 py-4 text-[0.95rem] text-ink-2" role="status" aria-live="polite">
                <Spinner className="h-4 w-4 text-clay" /> {busy === "uploading" ? "Saving your recording…" : "Saving your recording and listening back…"}
              </div>
            ) : (
              <div>
                {recorder.state.phase === "denied" ? (
                  <Notice tone="warning" className="mb-3">Microphone access was turned off for this site. You can allow it in your browser settings, or keep typing.</Notice>
                ) : recorder.state.phase === "unsupported" || recorder.state.phase === "error" ? (
                  <Notice tone="warning" className="mb-3">{recorder.state.phase === "unsupported" ? recorder.state.reason : recorder.state.message}</Notice>
                ) : null}
                {dictation.error ? <Notice tone="warning" className="mb-3">{dictation.error}</Notice> : null}
                <div className="rounded-[var(--radius-lg)] border border-line bg-white shadow-[var(--shadow-soft)] focus-within:border-clay">
                  <Textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleSendText();
                      }
                    }}
                    placeholder={mode === "hosted" ? `Type ${narratorName}'s answer…` : "Type your answer, or press the microphone to speak…"}
                    aria-label="Your answer"
                    className="min-h-[5.5rem] max-h-[40dvh] resize-none border-0 bg-transparent shadow-none focus:ring-0"
                    disabled={busy !== "idle"}
                  />
                  {dictation.listening ? (
                    <p className="px-3.5 pb-2 text-[0.9rem] text-ink-3" aria-live="polite">
                      <span className="mr-2 inline-flex items-center gap-1 text-rose"><span className="h-2 w-2 animate-pulse-soft rounded-full bg-rose" aria-hidden /> Listening</span>
                      <span className="italic">{dictation.interim}</span>
                    </p>
                  ) : null}
                  <div className="flex items-center justify-between gap-2 border-t border-line/70 px-2 py-2">
                    <div className="flex items-center gap-1">
                      {canRecord && micMode === "record" ? (
                        <Button variant="subtle" size="sm" onClick={recorder.start} disabled={busy !== "idle"} aria-label="Record an answer">
                          <Mic className="h-4 w-4" aria-hidden /> Record
                        </Button>
                      ) : null}
                      {canDictate && (micMode === "dictate" || !canRecord) ? (
                        dictation.listening ? (
                          <Button variant="subtle" size="sm" onClick={dictation.stop}><Square className="h-4 w-4" aria-hidden /> Stop dictating</Button>
                        ) : (
                          <Button variant="subtle" size="sm" onClick={dictation.start} disabled={busy !== "idle"} aria-label="Dictate an answer">
                            <Mic className="h-4 w-4" aria-hidden /> Dictate
                          </Button>
                        )
                      ) : null}
                      {canRecord && canDictate ? (
                        <button type="button" onClick={() => setMicMode((m) => (m === "record" ? "dictate" : "record"))} className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-[0.8rem] text-ink-3 hover:bg-paper-2 hover:text-ink">
                          {micMode === "record" ? <><Type className="h-3.5 w-3.5" aria-hidden /> Use dictation</> : <><Play className="h-3.5 w-3.5" aria-hidden /> Use recording</>}
                        </button>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={handleSkip} disabled={busy !== "idle" || !currentQuestion}>
                        <SkipForward className="h-4 w-4" aria-hidden /> Skip
                      </Button>
                      <Button size="sm" onClick={handleSendText} disabled={!text.trim() || busy !== "idle"} loading={busy === "saving"}>
                        <Send className="h-4 w-4" aria-hidden /> Save answer
                      </Button>
                    </div>
                  </div>
                </div>
                <p className={cn("mt-2 text-[0.78rem] leading-relaxed text-ink-3", !canRecord && !canDictate && "sr-only")}>
                  {micMode === "dictate" || !canRecord
                    ? "Dictation uses your browser's speech recognition; audio may be processed by your browser vendor. Nothing is saved until you press Save answer."
                    : capabilities.transcription
                      ? "Recordings are stored privately and transcribed on our servers. You review the words before they are saved."
                      : "Recordings are stored privately. Transcription isn't configured on this server, so you'll type what you said."}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
