import { describe, expect, it } from "vitest";
import { classifyFact, matchEvent, matchPerson, resolveDates, valuesConflict } from "@/server/memory/reconcile";

const known = [
  { id: "1", preferredName: "John Carter", fullName: null, aliases: ["Johnny"], relationshipToNarrator: "father" },
  { id: "2", preferredName: "Edith", fullName: "Edith Marsh", aliases: [], relationshipToNarrator: "grandmother" },
];

describe("matchPerson", () => {
  it("matches exact names and aliases regardless of case or accents", () => {
    expect(matchPerson("john carter", known)).toMatchObject({ kind: "exact", person: { id: "1" } });
    expect(matchPerson("Johnny", known)).toMatchObject({ kind: "exact", person: { id: "1" } });
    expect(matchPerson("Édith Marsh", known)).toMatchObject({ kind: "exact", person: { id: "2" } });
  });

  it("flags a shared first name as possible, never exact", () => {
    expect(matchPerson("John", known)).toMatchObject({ kind: "possible", person: { id: "1" } });
    expect(matchPerson("John Smith", known)).toMatchObject({ kind: "none" });
  });

  it("returns none for new people", () => {
    expect(matchPerson("Mabel", known)).toEqual({ kind: "none" });
  });
});

describe("resolveDates", () => {
  it("keeps exact dates exact and never upgrades vague ones", () => {
    expect(resolveDates({ dateText: "1962-03-04", year: 1962, endYear: null, approximateAge: null, datePrecision: "exact" })).toMatchObject({ startDate: "1962-03-04", datePrecision: "exact", approximateYear: 1962 });
    expect(resolveDates({ dateText: "around 1962", year: 1962, endYear: null, approximateAge: null, datePrecision: "approximate" })).toMatchObject({ startDate: null, datePrecision: "approximate", approximateYear: 1962 });
    expect(resolveDates({ dateText: "when I was six", year: null, endYear: null, approximateAge: 6, datePrecision: "approximate" })).toMatchObject({ approximateAge: 6, approximateYear: null, datePrecision: "approximate" });
    expect(resolveDates({ dateText: null, year: null, endYear: null, approximateAge: null, datePrecision: "unknown" })).toMatchObject({ datePrecision: "unknown" });
  });

  it("does not claim exactness for a bare year even if the extractor says exact", () => {
    expect(resolveDates({ dateText: "1962", year: 1962, endYear: null, approximateAge: null, datePrecision: "exact" })).toMatchObject({ startDate: null, datePrecision: "year" });
  });
});

describe("matchEvent", () => {
  const events = [{ id: "e1", title: "Moved to Manchester for the factory job", approximateYear: 1971, category: "move" }];
  it("treats similar titles with the same year as the same event", () => {
    expect(matchEvent({ title: "Moving to Manchester for the job at the factory", year: 1971, category: "move" }, events)).toMatchObject({ kind: "same" });
    expect(matchEvent({ title: "Moving to Manchester for the job at the factory", year: null, category: "move" }, events)).toMatchObject({ kind: "same" });
  });
  it("surfaces a conflict when the year differs", () => {
    expect(matchEvent({ title: "Moved to Manchester for the factory job", year: 1973, category: "move" }, events)).toMatchObject({ kind: "conflict" });
  });
  it("does not match unrelated events", () => {
    expect(matchEvent({ title: "Wedding in Leeds", year: 1971, category: "relationship" }, events)).toEqual({ kind: "none" });
  });
});

describe("fact policy", () => {
  it("auto-accepts only confident, unhedged, non-sensitive facts", () => {
    expect(classifyFact({ confidence: "high", isUncertainRecollection: false, sensitivity: "normal" }, false)).toBe("auto_accepted");
    expect(classifyFact({ confidence: "high", isUncertainRecollection: true, sensitivity: "normal" }, false)).toBe("needs_confirmation");
    expect(classifyFact({ confidence: "high", isUncertainRecollection: false, sensitivity: "sensitive" }, false)).toBe("needs_confirmation");
    expect(classifyFact({ confidence: "low", isUncertainRecollection: false, sensitivity: "normal" }, false)).toBe("needs_confirmation");
    expect(classifyFact({ confidence: "high", isUncertainRecollection: false, sensitivity: "normal" }, true)).toBe("conflicting");
  });
  it("detects contradictions but tolerates refinements", () => {
    expect(valuesConflict("1954", "1956")).toBe(true);
    expect(valuesConflict("Leeds", "Leeds, Yorkshire")).toBe(false);
    expect(valuesConflict("Leeds", "leeds")).toBe(false);
  });
});
