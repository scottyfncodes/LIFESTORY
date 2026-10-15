"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState =
  | { phase: "idle" }
  | { phase: "requesting" }
  | { phase: "recording"; startedAt: number; elapsed: number }
  | { phase: "stopped"; blob: Blob; mimeType: string; durationSeconds: number }
  | { phase: "unsupported"; reason: string }
  | { phase: "denied" }
  | { phase: "error"; message: string };

const CANDIDATE_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/mpeg"];

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of CANDIDATE_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // keep looking
    }
  }
  return "";
}

export function isRecordingSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}

export function useRecorder(maxSeconds: number) {
  const [state, setState] = useState<RecorderState>({ phase: "idle" });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedRef = useRef<number>(0);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    if (!isRecordingSupported()) {
      setState({ phase: "unsupported", reason: "This browser can't record audio. You can still type your answer." });
      return;
    }
    setState({ phase: "requesting" });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") setState({ phase: "denied" });
      else if (name === "NotFoundError") setState({ phase: "unsupported", reason: "No microphone was found on this device." });
      else setState({ phase: "error", message: "We couldn't start the microphone. You can still type your answer." });
      return;
    }
    streamRef.current = stream;
    const mimeType = pickMimeType() ?? "";
    let rec: MediaRecorder;
    try {
      rec = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48_000 }) : new MediaRecorder(stream);
    } catch {
      cleanupStream();
      setState({ phase: "error", message: "Recording isn't available in this browser. You can still type your answer." });
      return;
    }
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onerror = () => {
      cleanupStream();
      setState({ phase: "error", message: "Recording stopped unexpectedly. Please try again." });
    };
    rec.onstop = () => {
      const durationSeconds = Math.max(0, Math.round((Date.now() - startedRef.current) / 1000));
      const type = rec.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      cleanupStream();
      if (blob.size === 0) {
        setState({ phase: "error", message: "Nothing was recorded. Please try again." });
        return;
      }
      setState({ phase: "stopped", blob, mimeType: type, durationSeconds });
    };
    recorderRef.current = rec;
    startedRef.current = Date.now();
    rec.start(1000);
    setState({ phase: "recording", startedAt: startedRef.current, elapsed: 0 });
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.round((Date.now() - startedRef.current) / 1000);
      setState((prev) => (prev.phase === "recording" ? { ...prev, elapsed } : prev));
      if (elapsed >= maxSeconds) stop();
    }, 500);
  }, [cleanupStream, maxSeconds, stop]);

  const discard = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
    }
    cleanupStream();
    chunksRef.current = [];
    setState({ phase: "idle" });
  }, [cleanupStream]);

  useEffect(() => () => cleanupStream(), [cleanupStream]);

  return { state, start, stop, discard, reset: () => setState({ phase: "idle" }) };
}
