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

/**
 * How the app authenticates to Vercel Blob. A store connected to the project
 * gets either a read-write token or, by default on newer stores, OIDC: the
 * runtime's short-lived VERCEL_OIDC_TOKEN plus BLOB_STORE_ID. Vercel only
 * accepts OIDC from the environments the store is connected to.
 */
export function blobAuthMode(): "token" | "oidc" | null {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "token";
  if (process.env.BLOB_STORE_ID) return "oidc";
  return null;
}

/** Explicit Blob credentials, so the SDK never picks a store from the environment on its own. */
export type BlobCredentials = { token: string } | { storeId: string };

function credentialsFrom(token: string | undefined, storeId: string | undefined): BlobCredentials | null {
  if (token) return { token };
  if (storeId) return { storeId };
  return null;
}

/** The SDK's form of a store id ("store_abc" and "abc" are the same store). */
function storeIdOf(credentials: BlobCredentials): string | null {
  if ("storeId" in credentials) return credentials.storeId.replace(/^store_/, "");
  // Read-write tokens look like vercel_blob_rw_<storeId>_<secret>.
  return credentials.token.split("_")[3] || null;
}

/** The project's default store: interview audio, and originals stored before Weave had its own store. */
export function defaultBlobCredentials(): BlobCredentials | null {
  return credentialsFrom(process.env.BLOB_READ_WRITE_TOKEN, process.env.BLOB_STORE_ID);
}

/**
 * Conversation Weave's own store (WEAVE_BLOB_*). Never falls back to the
 * default store. OIDC here is refused while a default read-write token is
 * set: if the runtime's OIDC token were ever missing, the SDK would quietly
 * use that token, and with it the default store.
 */
export function weaveBlobCredentials(): BlobCredentials | null {
  const credentials = credentialsFrom(process.env.WEAVE_BLOB_READ_WRITE_TOKEN, process.env.WEAVE_BLOB_STORE_ID);
  if (credentials && "storeId" in credentials && process.env.BLOB_READ_WRITE_TOKEN) return null;
  return credentials;
}

/** True when the default store is the Weave store, which is never used for interview audio. */
function defaultStoreIsWeaveStore(): boolean {
  const main = defaultBlobCredentials();
  const weave = credentialsFrom(process.env.WEAVE_BLOB_READ_WRITE_TOKEN, process.env.WEAVE_BLOB_STORE_ID);
  if (!main || !weave) return false;
  const id = storeIdOf(main);
  return id !== null && id === storeIdOf(weave);
}

/**
 * Storage for new interview recordings. Connecting the Weave store (even with
 * Vercel's default variable names) can't switch this on: a default store that
 * is the Weave store counts as no store.
 */
export function storageProviderName(): StorageProviderName {
  const v = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();
  if (v === "vercel-blob" && blobAuthMode() && !defaultStoreIsWeaveStore()) return "vercel-blob";
  return "local";
}

/**
 * Storage for new Conversation Weave originals: its own Blob store, or local
 * files in development and tests. "none" means uploads are refused.
 */
export function weaveStorageProviderName(): "vercel-blob:weave" | "local" | "none" {
  if ((process.env.STORAGE_PROVIDER ?? "").toLowerCase() === "local") return "local";
  if (weaveBlobCredentials()) return "vercel-blob:weave";
  return process.env.VERCEL ? "none" : "local";
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

/** Conversation Weave is off unless WEAVE_ENABLED is explicitly set in this environment. */
export function isWeaveEnabled(): boolean {
  return ["1", "true"].includes((process.env.WEAVE_ENABLED ?? "").toLowerCase());
}

export function weaveLimits() {
  // Hard ceiling keeps sizes inside a 32-bit integer column.
  const mb = Math.min(Number(process.env.MAX_WEAVE_UPLOAD_MB) || 500, 2000);
  return {
    maxUploadBytes: mb * 1024 * 1024,
    maxRecordingsPerWeave: Math.min(Number(process.env.MAX_WEAVE_RECORDINGS) || 20, 100),
    maxParticipants: 6,
    /** Presigned playback links expire quickly; the page asks for a new one each time. */
    playbackUrlTtlSeconds: 300,
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
