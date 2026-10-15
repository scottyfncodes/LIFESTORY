import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { ProviderError } from "../errors";
import {
  biographySummarySchema,
  chapterDraftSchema,
  chapterPlanSchema,
  extractionResultSchema,
  questionPlanSchema,
  type AiProvider,
  type AiResult,
  type ChapterDraftContext,
  type ChapterPlanContext,
  type ExtractionContext,
  type QuestionContext,
  type SummaryContext,
} from "./types";
import {
  CHAPTER_PLANNER_SYSTEM,
  DRAFTER_SYSTEM,
  EXTRACTOR_SYSTEM,
  INTERVIEWER_SYSTEM,
  PROMPT_VERSION,
  SUMMARIZER_SYSTEM,
} from "./prompts/v1";

const DEFAULT_MODEL = "claude-opus-5-5";

/** Wraps untrusted text so the model treats it as data, never instructions. */
function data(label: string, text: string): string {
  return `<${label}>\n${text.replace(/<\/?[a-z_]+>/gi, "")}\n</${label}>`;
}

function list(items: string[], empty = "(none)"): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : empty;
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
    this.model = model;
  }

  private async parse<S extends z.ZodTypeAny>(
    system: string,
    user: string,
    schema: S,
    opts: { maxTokens: number; effort: "low" | "medium" | "high"; timeoutMs: number },
  ): Promise<AiResult<z.infer<S>>> {
    let response;
    try {
      response = await this.client.messages.parse(
        {
          model: this.model,
          max_tokens: opts.maxTokens,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: user }],
          output_config: { format: zodOutputFormat(schema), effort: opts.effort },
        },
        { timeout: opts.timeoutMs },
      );
    } catch (error) {
      throw toProviderError(error);
    }
    if (response.stop_reason === "refusal") {
      throw new ProviderError("anthropic", "The AI provider declined this request.", false);
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new ProviderError("anthropic", "The AI provider returned an incomplete response.", true);
    }
    const validated = schema.safeParse(response.parsed_output);
    if (!validated.success) {
      throw new ProviderError("anthropic", "The AI provider returned an invalid response.", true);
    }
    return {
      data: validated.data,
      usage: {
        model: response.model,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
      },
    };
  }

  async generateQuestion(ctx: QuestionContext) {
    const user = [
      `Narrator preferred name: ${ctx.narratorName}`,
      `Interview mode: ${ctx.mode === "hosted" ? "an interviewer is sitting with the narrator and reading questions aloud" : "the narrator is answering for themselves"}`,
      `Memoir scope: ${ctx.intendedScope}${ctx.scopeDescription ? ` — ${ctx.scopeDescription}` : ""}`,
      `Topics to avoid:\n${list(ctx.topicsToAvoid, "(none)")}`,
      `Coverage so far (answers per area, higher priority = thinner):\n${list(ctx.coverage.map((c) => `${c.label}: ${c.answers} answers, priority ${c.priority}`))}`,
      data("biography_summary", ctx.biographySummary ?? "(nothing yet)"),
      data("key_facts", list(ctx.keyFacts)),
      data("people", list(ctx.people.map((p) => `${p.name}${p.relationship ? ` (${p.relationship})` : ""}`))),
      data("events", list(ctx.events.map((e) => `${e.title}${e.when ? ` (${e.when})` : ""}`))),
      data("open_threads", list(ctx.openThreads.map((t) => `${t.title}: ${t.summary}${t.suggestedFollowUp ? ` | suggested: ${t.suggestedFollowUp}` : ""} | asked ${t.timesAsked}x`))),
      data("questions_already_asked", list(ctx.askedQuestions)),
      data("recent_conversation", ctx.recentTurns.map((t) => `${t.speaker === "interviewer" ? "Interviewer" : "Narrator"}: ${t.skipped ? "(skipped this question)" : t.text}`).join("\n\n") || "(no turns yet)"),
      `Answers in this session so far: ${ctx.sessionAnswerCount}. ${ctx.lastAnswerWasSkip ? "The narrator just skipped; change direction." : ""}`,
      `Ask the single best next question now. If a coverage area applies, set coverageArea; valid areas: ${ctx.coverage.map((c) => c.area).join(", ")}.`,
    ].join("\n\n");
    return this.parse(INTERVIEWER_SYSTEM, user, questionPlanSchema, { maxTokens: 1200, effort: "low", timeoutMs: 45_000 });
  }

  async extractMemory(ctx: ExtractionContext) {
    const user = [
      `Narrator preferred name: ${ctx.narratorName}`,
      `Topics to avoid:\n${list(ctx.topicsToAvoid)}`,
      data("known_people", list(ctx.knownPeople.map((p) => `${p.name}${p.aliases.length ? ` (also: ${p.aliases.join(", ")})` : ""}${p.relationship ? ` — ${p.relationship}` : ""}`))),
      data("known_events", list(ctx.knownEvents.map((e) => `${e.title}${e.year ? ` (${e.year})` : ""}`))),
      data("open_threads", list(ctx.openThreads.map((t) => t.title))),
      data("interviewer_question", ctx.question ?? "(none)"),
      data("narrator_answer", ctx.answer),
      "Extract what this answer establishes. Use existing names for known people when the answer clearly refers to them.",
    ].join("\n\n");
    return this.parse(EXTRACTOR_SYSTEM, user, extractionResultSchema, { maxTokens: 6000, effort: "medium", timeoutMs: 90_000 });
  }

  async summarizeBiography(ctx: SummaryContext) {
    const user = [
      `Narrator preferred name: ${ctx.narratorName}`,
      data("previous_summary", ctx.previousSummary ?? "(none)"),
      data("facts", list(ctx.facts)),
      data("events", list(ctx.events.map((e) => `${e.title}${e.when ? ` (${e.when})` : ""}: ${e.description}`))),
      data("people", list(ctx.people.map((p) => `${p.name}${p.relationship ? ` (${p.relationship})` : ""}${p.description ? `: ${p.description}` : ""}`))),
      data("recent_answers", ctx.recentAnswers.join("\n\n")),
      "Write the updated summary.",
    ].join("\n\n");
    return this.parse(SUMMARIZER_SYSTEM, user, biographySummarySchema, { maxTokens: 2500, effort: "low", timeoutMs: 60_000 });
  }

  async planChapters(ctx: ChapterPlanContext) {
    const user = [
      `Narrator preferred name: ${ctx.narratorName}`,
      `Memoir scope: ${ctx.intendedScope}. Writing style: ${ctx.writingStyle}.`,
      data("existing_chapters", list(ctx.existingChapters.map((c) => `${c.title}${c.focus ? ` — ${c.focus}` : ""}`))),
      data("answers", ctx.answers.map((a) => `[id ${a.id}]\nQ: ${a.question ?? "(opening)"}\nA: ${a.text}`).join("\n\n")),
      "Propose the chapter structure. Reference answers by their id.",
    ].join("\n\n");
    return this.parse(CHAPTER_PLANNER_SYSTEM, user, chapterPlanSchema, { maxTokens: 4000, effort: "medium", timeoutMs: 90_000 });
  }

  async draftChapter(ctx: ChapterDraftContext) {
    const user = [
      `Narrator preferred name: ${ctx.narratorName}. Writing style: ${ctx.writingStyle}.`,
      `Chapter title: ${ctx.chapterTitle}${ctx.chapterFocus ? `\nChapter focus: ${ctx.chapterFocus}` : ""}`,
      data("related_facts", list(ctx.relatedFacts)),
      data("source_answers", ctx.sources.map((s) => `[id ${s.id}]\nQ: ${s.question ?? "(opening)"}\nA: ${s.text}`).join("\n\n")),
      ctx.previousBody ? data("previous_draft", ctx.previousBody) : "",
      ctx.instructions ? data("revision_instructions_from_user", ctx.instructions) : "",
      ctx.previousBody
        ? "Revise the previous draft according to the instructions, keeping everything else unchanged and still grounded only in the sources."
        : "Write the chapter now.",
    ]
      .filter(Boolean)
      .join("\n\n");
    return this.parse(DRAFTER_SYSTEM, user, chapterDraftSchema, { maxTokens: 12000, effort: "medium", timeoutMs: 170_000 });
  }
}

export function describeAnthropicModel(): string {
  return `${process.env.ANTHROPIC_MODEL || DEFAULT_MODEL} (prompts ${PROMPT_VERSION})`;
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError("anthropic", "The AI provider is busy. Please try again shortly.", true);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("anthropic", "The AI provider rejected our credentials.", false);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ProviderError("anthropic", "The AI provider rejected the request.", false);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError("anthropic", "The AI provider took too long to respond.", true);
  }
  if (error instanceof Anthropic.APIConnectionError || error instanceof Anthropic.InternalServerError) {
    return new ProviderError("anthropic", "We couldn't reach the AI provider.", true);
  }
  if (error instanceof Anthropic.APIError) {
    return new ProviderError("anthropic", "The AI provider returned an error.", error.status ? error.status >= 500 : true);
  }
  return new ProviderError("anthropic", "Unexpected AI provider failure.", true);
}

