/**
 * Single place that answers "what is configured?" so the UI can be honest
 * about which capabilities are available, without touching secrets.
 */
export type AiProviderName = "anthropic" | "fixture" | "none";
export type TranscriptionProviderName = "openai" | "deepgram" | "fixture" | "none";
export type StorageProviderName = "vercel-blob" | "local";

export function aiProviderName(): AiProviderName {
  const v = (process.env.AI_PROVIDER ?? "none").toLowerCase();
  if (v === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (v === "fixture") return "fixture";
  return "none";
}

export function transcriptionProviderName(): TranscriptionProviderName {
  const v = (process.env.TRANSCRIPTION_PROVIDER ?? "none").toLowerCase();
  if (v === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (v === "deepgram" && process.env.DEEPGRAM_API_KEY) return "deepgram";
  if (v === "fixture") return "fixture";
  return "none";
}

export function storageProviderName(): StorageProviderName {
  const v = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();
  if (v === "vercel-blob" && process.env.BLOB_READ_WRITE_TOKEN) return "vercel-blob";
  return "local";
}

export function isAiEnabled(): boolean {
  return aiProviderName() !== "none";
}

export function isTranscriptionEnabled(): boolean {
  return transcriptionProviderName() !== "none";
}

export function limits() {
  return {
    maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 25) * 1024 * 1024,
    maxRecordingSeconds: Number(process.env.MAX_RECORDING_SECONDS) || 600,
  };
}

export function describeProviders(): { ai: string; transcription: string; storage: string } {
  const ai = aiProviderName();
  const tr = transcriptionProviderName();
  const st = storageProviderName();
  return {
    ai:
      ai === "anthropic"
        ? "Anthropic Claude generates questions, memory notes and chapter drafts. Nothing is used for training."
        : ai === "fixture"
          ? "A deterministic test provider is active (no external AI service)."
          : "Not configured. Questions follow the built-in interview guide; chapter drafting is unavailable until an AI provider is configured.",
    transcription:
      tr === "openai"
        ? "OpenAI transcribes uploaded recordings on our servers."
        : tr === "deepgram"
          ? "Deepgram transcribes uploaded recordings on our servers."
          : tr === "fixture"
            ? "A deterministic test transcriber is active."
            : "Not configured. Voice answers use your browser's own speech recognition (processed by your browser vendor) and are shown to you before saving.",
    storage:
      st === "vercel-blob"
        ? "Private object storage (Vercel Blob, private access). Links expire after a short time."
        : "Local private storage on the server (development mode).",
  };
}
