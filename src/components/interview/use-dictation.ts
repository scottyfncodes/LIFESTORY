"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isDictationSupported(): boolean {
  return getCtor() !== null;
}

/**
 * Browser speech recognition. Results are appended to the caller's text via
 * `onFinal`; interim text is exposed separately so it is never saved on its
 * own. Audio may be processed by the browser vendor; callers must disclose.
 */
export function useDictation(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("Dictation isn't available in this browser.");
      return;
    }
    setError(null);
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) onFinalRef.current(transcript.trim());
        else interimText += transcript;
      }
      setInterim(interimText);
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setError("Microphone access was denied for dictation.");
      else if (event.error === "no-speech") setError(null);
      else if (event.error !== "aborted") setError("Dictation stopped unexpectedly.");
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      recRef.current = null;
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setError("Dictation couldn't start.");
    }
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { listening, interim, error, start, stop };
}
