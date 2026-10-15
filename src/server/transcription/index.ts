import { transcriptionProviderName } from "../config";
import { ProviderError } from "../errors";

export type TranscriptionInput = {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  languageHint?: string | null;
};

export type TranscriptionOutput = {
  text: string;
  durationSeconds: number | null;
  provider: string;
};

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionOutput>;
}

let cached: TranscriptionProvider | null = null;

export function getTranscriptionProvider(): TranscriptionProvider | null {
  if (cached) return cached;
  const name = transcriptionProviderName();
  if (name === "openai") cached = new OpenAiTranscription(process.env.OPENAI_API_KEY as string, process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe");
  else if (name === "deepgram") cached = new DeepgramTranscription(process.env.DEEPGRAM_API_KEY as string);
  else if (name === "fixture") cached = new FixtureTranscription();
  return cached;
}

export function __setTranscriptionForTests(provider: TranscriptionProvider | null): void {
  cached = provider;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

class OpenAiTranscription implements TranscriptionProvider {
  readonly name = "openai";
  constructor(private apiKey: string, private model: string) {}

  async transcribe(input: TranscriptionInput): Promise<TranscriptionOutput> {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(input.bytes)], { type: input.mimeType }), input.filename);
    form.append("model", this.model);
    form.append("response_format", "json");
    if (input.languageHint) form.append("language", input.languageHint);
    let response: Response;
    try {
      response = await fetchWithTimeout("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${this.apiKey}` }, body: form }, 120_000);
    } catch {
      throw new ProviderError("openai", "We couldn't reach the transcription service.", true);
    }
    if (!response.ok) {
      throw new ProviderError("openai", "The transcription service returned an error.", response.status === 429 || response.status >= 500);
    }
    const json = (await response.json()) as { text?: string };
    if (typeof json.text !== "string") throw new ProviderError("openai", "The transcription service returned an unexpected response.", true);
    return { text: json.text.trim(), durationSeconds: null, provider: "openai" };
  }
}

class DeepgramTranscription implements TranscriptionProvider {
  readonly name = "deepgram";
  constructor(private apiKey: string) {}

  async transcribe(input: TranscriptionInput): Promise<TranscriptionOutput> {
    const params = new URLSearchParams({ model: "nova-3", smart_format: "true", punctuate: "true" });
    if (input.languageHint) params.set("language", input.languageHint);
    let response: Response;
    try {
      response = await fetchWithTimeout(`https://api.deepgram.com/v1/listen?${params}`, { method: "POST", headers: { authorization: `Token ${this.apiKey}`, "content-type": input.mimeType }, body: Buffer.from(input.bytes) }, 120_000);
    } catch {
      throw new ProviderError("deepgram", "We couldn't reach the transcription service.", true);
    }
    if (!response.ok) {
      throw new ProviderError("deepgram", "The transcription service returned an error.", response.status === 429 || response.status >= 500);
    }
    const json = (await response.json()) as { metadata?: { duration?: number }; results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } };
    const text = json.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    if (typeof text !== "string") throw new ProviderError("deepgram", "The transcription service returned an unexpected response.", true);
    return { text: text.trim(), durationSeconds: json.metadata?.duration ?? null, provider: "deepgram" };
  }
}

/** Deterministic transcriber for tests: never leaves the process. */
export class FixtureTranscription implements TranscriptionProvider {
  readonly name = "fixture";
  async transcribe(input: TranscriptionInput): Promise<TranscriptionOutput> {
    if (input.bytes.length === 0) throw new ProviderError("fixture", "Empty recording.", false);
    // Tests may embed "FIXTURE:<text>" after the container header to drive the transcript.
    const head = Buffer.from(input.bytes.subarray(0, 160)).toString("latin1");
    const at = head.indexOf("FIXTURE:");
    const text = at >= 0 ? head.slice(at + 8).replace(/\0[\s\S]*$/, "").trim() : "This is a fixture transcript of the recording.";
    return { text, durationSeconds: Math.max(1, Math.round(input.bytes.length / 4000)), provider: "fixture" };
  }
}
