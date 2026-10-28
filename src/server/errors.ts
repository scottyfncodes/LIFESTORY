/**
 * Application error types. These are safe to serialise to clients: messages
 * never include memoir content, credentials or provider payloads.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly expose: boolean;

  constructor(code: string, message: string, status = 400, expose = true) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.expose = expose;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "We couldn't find that.") {
    super("not_found", message, 404);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super("unauthorized", message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") {
    super("forbidden", message, 403);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  readonly issues: Record<string, string[]>;
  constructor(message: string, issues: Record<string, string[]> = {}) {
    super("validation", message, 422);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(
      "rate_limited",
      "You're doing that a little too quickly. Please wait a moment and try again.",
      429,
    );
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super("not_configured", message, 503);
    this.name = "ConfigurationError";
  }
}

/** Today's global AI budget is spent. Nothing the user saved is affected. */
export class AiPausedError extends AppError {
  readonly resumesAt: Date;
  constructor(resumesAt: Date) {
    super(
      "ai_paused",
      "AI help is paused for today because LifeStory has reached its daily limit. Everything you've saved is safe. Please try again tomorrow.",
      503,
    );
    this.name = "AiPausedError";
    this.resumesAt = resumesAt;
  }
}

export class ProviderError extends AppError {
  readonly provider: string;
  readonly retryable: boolean;
  constructor(provider: string, message: string, retryable: boolean) {
    super("provider_error", message, 502, true);
    this.name = "ProviderError";
    this.provider = provider;
    this.retryable = retryable;
  }
}

export type ErrorPayload = {
  error: { code: string; message: string; issues?: Record<string, string[]>; retryAfter?: number };
};

export function toErrorPayload(error: unknown): { status: number; body: ErrorPayload } {
  if (error instanceof AppError) {
    const body: ErrorPayload = { error: { code: error.code, message: error.message } };
    if (error instanceof ValidationError) body.error.issues = error.issues;
    if (error instanceof RateLimitError) body.error.retryAfter = error.retryAfterSeconds;
    return { status: error.status, body };
  }
  return {
    status: 500,
    body: { error: { code: "internal", message: "Something went wrong on our side. Your saved work is safe." } },
  };
}

export function errorResponse(error: unknown): Response {
  const { status, body } = toErrorPayload(error);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (error instanceof RateLimitError) headers["retry-after"] = String(error.retryAfterSeconds);
  return new Response(JSON.stringify(body), { status, headers });
}

export function configurationProblem(error: unknown): Response {
  const message =
    error instanceof Error && /not configured/i.test(error.message)
      ? error.message
      : "The service is not fully configured.";
  return new Response(JSON.stringify({ error: { code: "not_configured", message } }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}
