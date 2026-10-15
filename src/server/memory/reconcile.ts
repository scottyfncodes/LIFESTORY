/**
 * Pure reconciliation helpers for the biographical memory pipeline. They
 * decide how a candidate extracted from one answer relates to what is
 * already known. No database access, so they are unit-testable.
 */

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type KnownPerson = {
  id: string;
  preferredName: string;
  fullName: string | null;
  aliases: string[];
  relationshipToNarrator: string | null;
};

export type PersonMatch =
  | { kind: "exact"; person: KnownPerson }
  | { kind: "possible"; person: KnownPerson }
  | { kind: "none" };

/**
 * Exact matches share a normalised name or alias. A "possible" match shares
 * only a first name (e.g. "John" vs "John Carter"); it must never be merged
 * automatically, only flagged.
 */
export function matchPerson(name: string, known: KnownPerson[]): PersonMatch {
  const target = normalizeName(name);
  if (!target) return { kind: "none" };
  for (const person of known) {
    const names = [person.preferredName, person.fullName ?? "", ...person.aliases].map(normalizeName).filter(Boolean);
    if (names.includes(target)) return { kind: "exact", person };
  }
  const targetFirst = target.split(" ")[0];
  const targetParts = target.split(" ").length;
  for (const person of known) {
    const names = [person.preferredName, person.fullName ?? "", ...person.aliases].map(normalizeName).filter(Boolean);
    for (const n of names) {
      const first = n.split(" ")[0];
      const parts = n.split(" ").length;
      // Single-token vs multi-token with the same first name, or shared full
      // first name with different surnames, is a possible (not certain) match.
      if (first === targetFirst && (parts === 1 || targetParts === 1) && n !== target) {
        return { kind: "possible", person };
      }
    }
  }
  return { kind: "none" };
}

export type DateResolution = {
  startDate: string | null;
  endDate: string | null;
  approximateYear: number | null;
  approximateAge: number | null;
  datePrecision: "exact" | "month" | "year" | "decade" | "approximate" | "unknown";
};

/**
 * Turns the extractor's date fields into storage columns without inventing
 * precision. Only an explicit full date yields `startDate`.
 */
export function resolveDates(input: {
  dateText: string | null;
  year: number | null;
  endYear: number | null;
  approximateAge: number | null;
  datePrecision: DateResolution["datePrecision"];
}): DateResolution {
  const iso = input.dateText?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const month = input.dateText?.match(/^(\d{4})-(\d{2})$/);
  if (iso && input.datePrecision === "exact") {
    return { startDate: input.dateText, endDate: null, approximateYear: Number(iso[1]), approximateAge: input.approximateAge, datePrecision: "exact" };
  }
  if (month && (input.datePrecision === "month" || input.datePrecision === "exact")) {
    return { startDate: `${month[1]}-${month[2]}-01`, endDate: null, approximateYear: Number(month[1]), approximateAge: input.approximateAge, datePrecision: "month" };
  }
  if (input.year) {
    const precision = input.datePrecision === "unknown" ? "year" : input.datePrecision === "exact" || input.datePrecision === "month" ? "year" : input.datePrecision;
    return {
      startDate: null,
      endDate: null,
      approximateYear: input.year,
      approximateAge: input.approximateAge,
      datePrecision: precision,
    };
  }
  if (input.approximateAge !== null) {
    return { startDate: null, endDate: null, approximateYear: null, approximateAge: input.approximateAge, datePrecision: "approximate" };
  }
  return { startDate: null, endDate: null, approximateYear: null, approximateAge: null, datePrecision: "unknown" };
}

export type KnownEvent = { id: string; title: string; approximateYear: number | null; category: string };

export type EventMatch = { kind: "same"; event: KnownEvent } | { kind: "conflict"; event: KnownEvent } | { kind: "none" };

function titleTokens(title: string): Set<string> {
  return new Set(normalizeName(title).split(" ").filter((t) => t.length > 3));
}

/** Jaccard overlap of meaningful title words. */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/**
 * Similar titles with the same (or no) year are the same event; similar
 * titles with different years are a conflict to surface, never to resolve.
 */
export function matchEvent(candidate: { title: string; year: number | null; category: string }, known: KnownEvent[]): EventMatch {
  let best: { event: KnownEvent; score: number } | null = null;
  for (const event of known) {
    const score = titleSimilarity(candidate.title, event.title);
    if (score >= 0.5 && (!best || score > best.score)) best = { event, score };
  }
  if (!best) return { kind: "none" };
  const { event } = best;
  if (candidate.year && event.approximateYear && candidate.year !== event.approximateYear) {
    return { kind: "conflict", event };
  }
  return { kind: "same", event };
}

export type FactVerification = "auto_accepted" | "needs_confirmation" | "conflicting";

/**
 * The verification policy: confident, unhedged, non-sensitive statements are
 * accepted automatically; everything else waits for the narrator.
 */
export function classifyFact(fact: { confidence: "low" | "medium" | "high"; isUncertainRecollection: boolean; sensitivity: "normal" | "sensitive" }, conflicts: boolean): FactVerification {
  if (conflicts) return "conflicting";
  if (fact.isUncertainRecollection || fact.confidence === "low" || fact.sensitivity === "sensitive") return "needs_confirmation";
  return "auto_accepted";
}

export function factKey(factType: string, subjectName: string | null): string {
  return `${factType.toLowerCase().trim()}|${normalizeName(subjectName ?? "")}`;
}

export function valuesConflict(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return false;
  // One value containing the other is a refinement, not a contradiction.
  if (na.includes(nb) || nb.includes(na)) return false;
  return true;
}
