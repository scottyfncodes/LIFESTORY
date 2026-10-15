"use client";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter?: number;
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    let payload: { error?: { code?: string; message?: string; retryAfter?: number } } = {};
    try {
      payload = await response.json();
    } catch {
      // non-JSON error
    }
    throw new ApiError(
      response.status,
      payload.error?.code ?? `http_${response.status}`,
      payload.error?.message ?? (response.status === 401 ? "Your session has expired. Please sign in again." : "Something went wrong. Please try again."),
      payload.error?.retryAfter,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
