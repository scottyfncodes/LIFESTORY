import { describe, expect, it } from "vitest";
import { normalizeQuestion } from "@/server/interviewer/planner";
import { questionPlanSchema, extractionResultSchema } from "@/server/ai/types";

describe("model output validation", () => {
  it("rejects questions that smuggle extra fields or overlong text", () => {
    expect(questionPlanSchema.safeParse({ question: "x".repeat(601), intent: "follow_up", coverageArea: null, relatedThreadTitle: null, rationale: "" }).success).toBe(false);
    expect(questionPlanSchema.safeParse({ question: "Where were you born?", intent: "system_override", coverageArea: null, relatedThreadTitle: null, rationale: "" }).success).toBe(false);
    expect(questionPlanSchema.safeParse({ question: "Where were you born?", intent: "new_topic", coverageArea: "childhood", relatedThreadTitle: null, rationale: "opener" }).success).toBe(true);
  });
  it("rejects extracted events with impossible dates", () => {
    const base = { title: "t", description: "", category: "other", dateText: null, year: 1700, endYear: null, approximateAge: null, datePrecision: "year", location: null, peopleNames: [], confidence: "high", evidenceQuote: "" };
    expect(extractionResultSchema.safeParse({ events: [base] }).success).toBe(false);
    expect(extractionResultSchema.safeParse({ events: [{ ...base, year: 1954 }] }).success).toBe(true);
  });
  it("normalises questions so paraphrased repeats are detected", () => {
    expect(normalizeQuestion("Where were you BORN?")).toBe(normalizeQuestion("where were you born"));
  });
});
