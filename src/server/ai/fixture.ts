import type {
  AiProvider,
  AiResult,
  ChapterDraftContext,
  ChapterPlanContext,
  ExtractionContext,
  ExtractionResult,
  QuestionContext,
  SummaryContext,
} from "./types";
import { QUESTION_TEMPLATES } from "../interviewer/coverage";

/**
 * Deterministic provider for tests and local demos. It never calls a
 * network service. Its "extraction" is intentionally simple: capitalised
 * names and four-digit years from the answer text.
 */
const usage = { model: "fixture", inputTokens: 0, outputTokens: 0 };

const STOP_WORDS = new Set([
  "I", "My", "The", "A", "An", "We", "It", "He", "She", "They", "When", "Then", "There", "That", "This",
  "And", "But", "So", "In", "On", "At", "After", "Before", "Our", "His", "Her", "Their", "You", "Yes", "No",
  "Well", "Also", "Because", "If", "Maybe", "Dad", "Mum", "Mom",
]);

const PLACE_PREPOSITIONS = new Set(["in", "at", "to", "from", "near", "on", "into", "around", "outside"]);

function extractNames(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/(?:^|[\s,.(])([a-z]+\s)?([A-Z][a-z]{2,})(?:\s([A-Z][a-z]{2,}))?\b/g)) {
    const preceding = (match[1] ?? "").trim().toLowerCase();
    const first = match[2];
    if (STOP_WORDS.has(first)) continue;
    // "in Leeds", "to Manchester": most likely a place, not a person.
    if (PLACE_PREPOSITIONS.has(preceding)) continue;
    const name = match[3] && !STOP_WORDS.has(match[3]) ? `${first} ${match[3]}` : first;
    found.add(name);
  }
  return [...found].slice(0, 8);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export class FixtureProvider implements AiProvider {
  readonly name = "fixture";

  async generateQuestion(ctx: QuestionContext): Promise<AiResult<QuestionPlanOut>> {
    const lastAnswer = [...ctx.recentTurns].reverse().find((t) => t.speaker === "narrator" && !t.skipped);
    const names = lastAnswer ? extractNames(lastAnswer.text).filter((n) => n !== ctx.narratorName) : [];
    const asked = new Set(ctx.askedQuestions);
    if (names.length > 0 && !ctx.lastAnswerWasSkip) {
      const q = `You mentioned ${names[0]}. Can you tell me more about ${names[0]} and what they meant to you?`;
      if (!asked.has(q)) {
        return { data: { question: q, intent: "follow_up", coverageArea: null, relatedThreadTitle: null, offeredTopics: [], rationale: "fixture follow-up on a named person" }, usage };
      }
    }
    const thread = ctx.openThreads.find((t) => t.suggestedFollowUp && !asked.has(t.suggestedFollowUp));
    if (thread?.suggestedFollowUp) {
      return { data: { question: thread.suggestedFollowUp, intent: "follow_up", coverageArea: null, relatedThreadTitle: thread.title, offeredTopics: [], rationale: "fixture open thread" }, usage };
    }
    const byPriority = [...ctx.coverage].sort((a, b) => b.priority - a.priority);
    for (const area of byPriority) {
      const template = QUESTION_TEMPLATES.find((t) => t.area === area.area && !asked.has(t.text(ctx.narratorName)));
      if (template) {
        return { data: { question: template.text(ctx.narratorName), intent: "new_topic", coverageArea: template.area, relatedThreadTitle: null, offeredTopics: [], rationale: "fixture coverage" }, usage };
      }
    }
    return { data: { question: "Is there anything else from this part of your life you'd like to add before we move on?", intent: "closing", coverageArea: null, relatedThreadTitle: null, offeredTopics: [], rationale: "fixture fallback" }, usage };
  }

  async extractMemory(ctx: ExtractionContext): Promise<AiResult<ExtractionResult>> {
    const answer = ctx.answer;
    const declined = /\b(rather not|don't want to talk|do not want to talk|skip that)\b/i.test(answer);
    const names = declined ? [] : extractNames(answer).filter((n) => n.toLowerCase() !== ctx.narratorName.toLowerCase());
    const years = declined ? [] : [...answer.matchAll(/\b(18[5-9]\d|19\d\d|20\d\d)\b/g)].map((m) => Number(m[1]));
    const firstSentence = sentences(answer)[0] ?? answer.slice(0, 120);
    const known = new Set(ctx.knownPeople.map((p) => p.name.toLowerCase()));
    const people = names.map((name) => ({
      name,
      aliases: [],
      relationshipToNarrator: inferRelationship(answer, name),
      description: null,
      evidenceQuote: firstSentence.slice(0, 200),
    }));
    const events: ExtractionResult["events"] = years.slice(0, 2).map((year) => ({
      title: `Around ${year}: ${firstSentence.slice(0, 60)}`,
      description: firstSentence.slice(0, 300),
      category: "other",
      dateText: String(year),
      year,
      endYear: null,
      approximateAge: null,
      datePrecision: /\b(around|about|roughly|maybe|i think)\b/i.test(answer) ? "approximate" : "year",
      location: null,
      peopleNames: names.slice(0, 3),
      confidence: "medium",
      evidenceQuote: firstSentence.slice(0, 200),
    }));
    const facts: ExtractionResult["facts"] = declined
      ? []
      : [
          {
            statement: firstSentence.slice(0, 200),
            factType: "statement",
            subjectName: null,
            value: firstSentence.slice(0, 200),
            confidence: "medium",
            sensitivity: "normal",
            isUncertainRecollection: /\b(i think|maybe|not sure|around)\b/i.test(answer),
            evidenceQuote: firstSentence.slice(0, 200),
          },
        ];
    const newThreads: ExtractionResult["newThreads"] = names
      .filter((n) => !known.has(n.toLowerCase()))
      .slice(0, 2)
      .map((n) => ({
        title: `More about ${n}`,
        summary: `${n} was mentioned but not described in depth.`,
        suggestedFollowUp: `What else do you remember about ${n}?`,
        importance: "medium",
        coverageArea: null,
      }));
    return {
      data: {
        people,
        events,
        facts,
        relationships: [],
        newThreads,
        coveredThreadTitles: ctx.openThreads.filter((t) => names.some((n) => t.title.includes(n))).map((t) => t.title),
        coverageAreasTouched: [],
        narratorAskedToStopTopic: declined,
      },
      usage,
    };
  }

  async summarizeBiography(ctx: SummaryContext) {
    const parts = [
      ctx.previousSummary ?? "",
      ...ctx.facts.slice(-5),
    ].filter(Boolean);
    return { data: { summary: parts.join(" ").slice(0, 3500) || `${ctx.narratorName} has begun telling their story.` }, usage };
  }

  async planChapters(ctx: ChapterPlanContext) {
    const size = Math.max(1, Math.ceil(ctx.answers.length / 4));
    const chapters: Array<{ title: string; focus: string; sourceTurnIds: string[] }> = [];
    for (let i = 0; i < ctx.answers.length; i += size) {
      const slice = ctx.answers.slice(i, i + size);
      const existing = ctx.existingChapters[chapters.length];
      chapters.push({
        title: existing?.title ?? `Chapter ${chapters.length + 1}: ${(slice[0].question ?? "Beginnings").replace(/[?.]$/, "").slice(0, 60)}`,
        focus: slice[0].question ?? "The beginning",
        sourceTurnIds: slice.map((a) => a.id),
      });
    }
    return { data: { chapters: chapters.slice(0, 16) }, usage };
  }

  async draftChapter(ctx: ChapterDraftContext) {
    const paragraphs = ctx.sources.map((s) => s.text.trim()).filter(Boolean);
    const body = ctx.previousBody && ctx.instructions
      ? `${ctx.previousBody}\n\n(Revised as requested: ${ctx.instructions})`
      : paragraphs.join("\n\n");
    const flags = ctx.sources.some((s) => /\b(i think|maybe|not sure)\b/i.test(s.text))
      ? [{ kind: "uncertain" as const, passage: paragraphs[0]?.slice(0, 80) ?? "", note: "The narrator was unsure about this detail." }]
      : [];
    return {
      data: {
        title: ctx.chapterTitle,
        body: body || "This chapter is waiting for more of the story.",
        usedTurnIds: ctx.sources.map((s) => s.id),
        flags,
        followUpQuestions: [],
      },
      usage,
    };
  }
}

type QuestionPlanOut = {
  question: string;
  intent: "follow_up" | "new_topic" | "clarify" | "offer_choice" | "closing";
  coverageArea: (typeof QUESTION_TEMPLATES)[number]["area"] | null;
  relatedThreadTitle: string | null;
  offeredTopics: string[];
  rationale: string;
};

function inferRelationship(answer: string, name: string): string | null {
  const re = new RegExp(`my (mother|father|mum|mom|dad|brother|sister|grandmother|grandfather|wife|husband|partner|son|daughter|friend|aunt|uncle|cousin)[,\\s]+${name}`, "i");
  const m = answer.match(re);
  if (m) return m[1].toLowerCase();
  const re2 = new RegExp(`${name},? my (mother|father|mum|mom|dad|brother|sister|grandmother|grandfather|wife|husband|partner|son|daughter|friend|aunt|uncle|cousin)`, "i");
  const m2 = answer.match(re2);
  return m2 ? m2[1].toLowerCase() : null;
}
