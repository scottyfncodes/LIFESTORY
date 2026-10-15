import { z } from "zod";
import { COVERAGE_AREA_IDS } from "../interviewer/coverage";

/**
 * Every AI operation has a typed input and a Zod-validated output. Model
 * output is untrusted until it has passed through these schemas.
 */

const coverageAreaEnum = z.enum(COVERAGE_AREA_IDS);

export const confidenceSchema = z.enum(["low", "medium", "high"]);
export const datePrecisionSchema = z.enum(["exact", "month", "year", "decade", "approximate", "unknown"]);

// ---------------------------------------------------------------- question

export const questionPlanSchema = z.object({
  question: z.string().min(1).max(600),
  intent: z.enum(["follow_up", "new_topic", "clarify", "offer_choice", "closing"]),
  coverageArea: coverageAreaEnum.nullable(),
  relatedThreadTitle: z.string().max(200).nullable(),
  offeredTopics: z.array(z.string().max(120)).max(4).default([]),
  rationale: z.string().max(300),
});
export type QuestionPlan = z.infer<typeof questionPlanSchema>;

export type RecentTurn = {
  id: string;
  speaker: "interviewer" | "narrator";
  text: string;
  skipped?: boolean;
};

export type ThreadSummary = {
  id: string;
  title: string;
  summary: string;
  status: string;
  suggestedFollowUp: string | null;
  coverageArea: string | null;
  importance: string;
  timesAsked: number;
};

export type QuestionContext = {
  narratorName: string;
  mode: "self_guided" | "hosted";
  intendedScope: string;
  scopeDescription: string | null;
  topicsToAvoid: string[];
  biographySummary: string | null;
  keyFacts: string[];
  people: Array<{ name: string; relationship: string | null }>;
  events: Array<{ title: string; when: string | null }>;
  openThreads: ThreadSummary[];
  coverage: Array<{ area: string; label: string; answers: number; priority: number }>;
  recentTurns: RecentTurn[];
  askedQuestions: string[];
  sessionAnswerCount: number;
  lastAnswerWasSkip: boolean;
};

// ------------------------------------------------------------- extraction

export const extractedPersonSchema = z.object({
  name: z.string().min(1).max(120),
  aliases: z.array(z.string().max(120)).max(6).default([]),
  relationshipToNarrator: z.string().max(120).nullable(),
  description: z.string().max(400).nullable(),
  evidenceQuote: z.string().max(400),
});

export const extractedEventSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(600),
  category: z.enum([
    "birth",
    "home",
    "move",
    "education",
    "work",
    "relationship",
    "family",
    "travel",
    "health",
    "loss",
    "achievement",
    "turning_point",
    "other",
  ]),
  dateText: z.string().max(80).nullable(),
  year: z.number().int().min(1850).max(2100).nullable(),
  endYear: z.number().int().min(1850).max(2100).nullable(),
  approximateAge: z.number().int().min(0).max(120).nullable(),
  datePrecision: datePrecisionSchema,
  location: z.string().max(160).nullable(),
  peopleNames: z.array(z.string().max(120)).max(10).default([]),
  confidence: confidenceSchema,
  evidenceQuote: z.string().max(400),
});

export const extractedFactSchema = z.object({
  statement: z.string().min(1).max(300),
  factType: z.string().min(1).max(60),
  subjectName: z.string().max(120).nullable(),
  value: z.string().max(300),
  confidence: confidenceSchema,
  sensitivity: z.enum(["normal", "sensitive"]),
  isUncertainRecollection: z.boolean(),
  evidenceQuote: z.string().max(400),
});

export const extractedRelationshipSchema = z.object({
  personName: z.string().min(1).max(120),
  relatedPersonName: z.string().min(1).max(120),
  relationshipType: z.string().min(1).max(60),
  evidenceQuote: z.string().max(400),
});

export const extractedThreadSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().max(400),
  suggestedFollowUp: z.string().max(300).nullable(),
  importance: z.enum(["low", "medium", "high"]),
  coverageArea: coverageAreaEnum.nullable(),
});

export const extractionResultSchema = z.object({
  people: z.array(extractedPersonSchema).max(20).default([]),
  events: z.array(extractedEventSchema).max(20).default([]),
  facts: z.array(extractedFactSchema).max(30).default([]),
  relationships: z.array(extractedRelationshipSchema).max(20).default([]),
  newThreads: z.array(extractedThreadSchema).max(8).default([]),
  coveredThreadTitles: z.array(z.string().max(200)).max(10).default([]),
  coverageAreasTouched: z.array(coverageAreaEnum).max(5).default([]),
  narratorAskedToStopTopic: z.boolean().default(false),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export type ExtractionContext = {
  narratorName: string;
  topicsToAvoid: string[];
  question: string | null;
  answer: string;
  knownPeople: Array<{ name: string; aliases: string[]; relationship: string | null }>;
  knownEvents: Array<{ title: string; year: number | null }>;
  openThreads: Array<{ title: string }>;
};

// --------------------------------------------------------------- summary

export const biographySummarySchema = z.object({
  summary: z.string().min(1).max(4000),
});

export type SummaryContext = {
  narratorName: string;
  previousSummary: string | null;
  facts: string[];
  events: Array<{ title: string; when: string | null; description: string }>;
  people: Array<{ name: string; relationship: string | null; description: string | null }>;
  recentAnswers: string[];
};

// ------------------------------------------------------------- manuscript

export const chapterPlanSchema = z.object({
  chapters: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        focus: z.string().max(300),
        sourceTurnIds: z.array(z.string()).min(1).max(60),
      }),
    )
    .min(1)
    .max(16),
});
export type ChapterPlan = z.infer<typeof chapterPlanSchema>;

export type ChapterPlanContext = {
  narratorName: string;
  intendedScope: string;
  writingStyle: string;
  answers: Array<{ id: string; question: string | null; text: string }>;
  existingChapters: Array<{ id: string; title: string; focus: string | null }>;
};

export const draftFlagSchema = z.object({
  kind: z.enum(["uncertain", "missing", "conflict"]),
  passage: z.string().max(300),
  note: z.string().max(300),
});

export const chapterDraftSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(40000),
  usedTurnIds: z.array(z.string()).max(80),
  flags: z.array(draftFlagSchema).max(20).default([]),
  followUpQuestions: z.array(z.string().max(300)).max(5).default([]),
});
export type ChapterDraft = z.infer<typeof chapterDraftSchema>;

export type ChapterDraftContext = {
  narratorName: string;
  writingStyle: string;
  chapterTitle: string;
  chapterFocus: string | null;
  sources: Array<{ id: string; question: string | null; text: string }>;
  relatedFacts: string[];
  previousBody: string | null;
  instructions: string | null;
};

// ---------------------------------------------------------------- provider

export type AiUsage = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type AiResult<T> = { data: T; usage: AiUsage };

export interface AiProvider {
  readonly name: string;
  generateQuestion(ctx: QuestionContext): Promise<AiResult<QuestionPlan>>;
  extractMemory(ctx: ExtractionContext): Promise<AiResult<ExtractionResult>>;
  summarizeBiography(ctx: SummaryContext): Promise<AiResult<z.infer<typeof biographySummarySchema>>>;
  planChapters(ctx: ChapterPlanContext): Promise<AiResult<ChapterPlan>>;
  draftChapter(ctx: ChapterDraftContext): Promise<AiResult<ChapterDraft>>;
}
