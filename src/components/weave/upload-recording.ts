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
  | { mode: "direct"; pathname: string; contentType: string; multipart: boolean }
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
  if (reserved.upload.mode === "direct") {
    const { upload } = await import("@vercel/blob/client");
    try {
      await upload(reserved.upload.pathname, opts.file, {
        access: "private",
        handleUploadUrl: `${base}/uploads`,
        clientPayload: JSON.stringify({ recordingId }),
        contentType: reserved.upload.contentType,
        multipart: reserved.upload.multipart,
        abortSignal: opts.signal,
        onUploadProgress: ({ percentage }) => opts.onProgress(percentage / 100),
      });
    } catch (error) {
      if (opts.signal.aborted) throw error;
      throw new ApiError(0, "upload_failed", "The upload was interrupted. Check your connection and try again.");
    }
  } else {
    await putThroughServer(`${base}/recordings/${recordingId}/content`, opts.file, reserved.upload.contentType, opts.signal, opts.onProgress);
  }

  opts.onPhase("verifying");
  const done = await apiFetch<{ recording: RecordingDto }>(`${base}/recordings/${recordingId}/complete`, { method: "POST", signal: opts.signal });
  return done.recording;
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
