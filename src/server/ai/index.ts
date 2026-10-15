import type { DbClient } from "@/db";
import { usageEvents } from "@/db/schema";
import { aiProviderName } from "../config";
import { ConfigurationError } from "../errors";
import { errorCode, log } from "../logger";
import { AnthropicProvider } from "./anthropic";
import { FixtureProvider } from "./fixture";
import type { AiProvider, AiResult } from "./types";

let cached: { name: string; provider: AiProvider } | null = null;

export function getAiProvider(): AiProvider | null {
  const name = aiProviderName();
  if (cached?.name === name) return cached.provider;
  let provider: AiProvider | null = null;
  if (name === "anthropic") provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY as string);
  else if (name === "fixture") provider = new FixtureProvider();
  if (!provider) return null;
  cached = { name, provider };
  return provider;
}

export function requireAiProvider(): AiProvider {
  const provider = getAiProvider();
  if (!provider) {
    throw new ConfigurationError(
      "AI drafting is not configured on this server. Add an AI provider key to enable it.",
    );
  }
  return provider;
}

/** For tests: override the provider instance. */
export function __setAiProviderForTests(provider: AiProvider | null): void {
  cached = provider ? { name: aiProviderName(), provider } : null;
}

/**
 * Runs an AI operation and records content-free usage telemetry. Failures
 * are logged by code only and re-thrown for the caller to handle.
 */
export async function withAiTelemetry<T>(
  db: DbClient,
  meta: { projectId: string | null; userId: string | null; operation: string; provider: string },
  run: () => Promise<AiResult<T>>,
): Promise<AiResult<T>> {
  const started = Date.now();
  try {
    const result = await run();
    await db.insert(usageEvents).values({
      projectId: meta.projectId,
      userId: meta.userId,
      provider: meta.provider,
      operation: meta.operation,
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: Date.now() - started,
      succeeded: true,
    });
    return result;
  } catch (error) {
    const code = errorCode(error);
    log.warn("ai.operation_failed", { operation: meta.operation, provider: meta.provider, code, durationMs: Date.now() - started });
    await db
      .insert(usageEvents)
      .values({
        projectId: meta.projectId,
        userId: meta.userId,
        provider: meta.provider,
        operation: meta.operation,
        durationMs: Date.now() - started,
        succeeded: false,
        errorCode: code,
      })
      .catch(() => undefined);
    throw error;
  }
}
