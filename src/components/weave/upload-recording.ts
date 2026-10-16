"use client";

import { apiFetch, ApiError } from "@/lib/api-client";

export type RecordingDto = {
  id: string;
  clientUploadId: string;
  status: "awaiting_upload" | "uploaded" | "transcribing" | "transcribed" | "failed";
  originalFilename: string;
  mimeType: string;
  size: number;
  durationSeconds: number | null;
  recordedOn: string | null;
  recordedOnPrecision: string | null;
  contextNote: string | null;
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

type UploadInstructions =
  | { mode: "direct"; flow: "client-token" | "presigned"; pathname: string; contentType: string; multipart: boolean }
  | { mode: "server"; contentType: string };

export type UploadPhase = "preparing" | "uploading" | "verifying";

/**
 * One file, three steps: reserve a slot, send the bytes (straight to private
 * storage when the server supports it), then ask the server to verify what
 * landed. Re-running with the same clientUploadId resumes safely.
 */
export async function uploadRecording(opts: {
  projectId: string;
  weaveId: string;
  file: File;
  clientUploadId: string;
  durationSeconds: number | null;
  signal: AbortSignal;
  onPhase: (phase: UploadPhase) => void;
  onProgress: (fraction: number) => void;
}): Promise<RecordingDto> {
  const base = `/api/projects/${opts.projectId}/weaves/${opts.weaveId}`;
  opts.onPhase("preparing");
  const reserved = await apiFetch<{ recording: RecordingDto; upload: UploadInstructions | null }>(`${base}/recordings`, {
    method: "POST",
    body: JSON.stringify({ clientUploadId: opts.clientUploadId, filename: opts.file.name, mimeType: opts.file.type, size: opts.file.size, durationSeconds: opts.durationSeconds }),
    signal: opts.signal,
  });
  if (!reserved.upload) return reserved.recording;
  const recordingId = reserved.recording.id;

  opts.onPhase("uploading");
  const transfer = watchTransfer(opts.signal, opts.onProgress);
  try {
    if (reserved.upload.mode === "direct") {
      const { upload, uploadPresigned } = await import("@vercel/blob/client");
      // Same options either way; the server decides the flow from how the store is connected.
      const send = reserved.upload.flow === "presigned" ? uploadPresigned : upload;
      await transfer.run(
        send(reserved.upload.pathname, opts.file, {
          access: "private",
          handleUploadUrl: `${base}/uploads`,
          clientPayload: JSON.stringify({ recordingId }),
          contentType: reserved.upload.contentType,
          multipart: reserved.upload.multipart,
          abortSignal: transfer.signal,
          onUploadProgress: ({ percentage }) => transfer.progress(percentage / 100),
        }),
      );
    } else {
      await transfer.run(putThroughServer(`${base}/recordings/${recordingId}/content`, opts.file, reserved.upload.contentType, transfer.signal, transfer.progress));
    }
  } catch (error) {
    if (transfer.stalled) throw new ApiError(0, "upload_stalled", "The connection dropped during the upload. Check your connection and press Retry.");
    if (opts.signal.aborted || error instanceof ApiError) throw error;
    throw new ApiError(0, "upload_failed", "The upload was interrupted. Check your connection and try again.");
  } finally {
    transfer.dispose();
  }

  opts.onPhase("verifying");
  const done = await apiFetch<{ recording: RecordingDto }>(`${base}/recordings/${recordingId}/complete`, { method: "POST", signal: opts.signal });
  return done.recording;
}

/** No upload progress for this long means the connection is gone. */
export const UPLOAD_STALL_MS = 60_000;

/**
 * Wraps one transfer so a dead connection surfaces quickly. The Blob SDK
 * retries a failed request 10 times with doubling delays (about 17 minutes in
 * all) without reporting progress; if nothing moves for UPLOAD_STALL_MS the
 * transfer is aborted and the user gets Retry straight away.
 */
function watchTransfer(outer: AbortSignal, onProgress: (fraction: number) => void) {
  const controller = new AbortController();
  const relay = () => controller.abort();
  outer.addEventListener("abort", relay, { once: true });
  let last = Date.now();
  let stalled = false;
  const timer = window.setInterval(() => {
    if (Date.now() - last > UPLOAD_STALL_MS) {
      stalled = true;
      controller.abort();
    }
  }, 2000);
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  aborted.catch(() => undefined);
  return {
    signal: controller.signal,
    get stalled() {
      return stalled;
    },
    progress: (fraction: number) => {
      last = Date.now();
      onProgress(fraction);
    },
    // Settles as soon as the transfer is aborted, even while the SDK waits to retry.
    run<T>(work: Promise<T>): Promise<T> {
      work.catch(() => undefined);
      return Promise.race([work, aborted]);
    },
    dispose() {
      window.clearInterval(timer);
      outer.removeEventListener("abort", relay);
    },
  };
}

function putThroughServer(url: string, file: File, contentType: string, signal: AbortSignal, onProgress: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = "The upload didn't go through. Please try again.";
      let code = `http_${xhr.status}`;
      try {
        const payload = JSON.parse(xhr.responseText) as { error?: { code?: string; message?: string } };
        message = payload.error?.message ?? message;
        code = payload.error?.code ?? code;
      } catch {
        // non-JSON error
      }
      reject(new ApiError(xhr.status, code, message));
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "The upload was interrupted. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** Reads the length from the file's own metadata. Never blocks an upload: unknown is fine. */
export function readDuration(file: File, timeoutMs = 6000): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    audio.src = url;
  });
}

export function newClientUploadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
