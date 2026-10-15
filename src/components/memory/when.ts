export type WhenInput = {
  startDate: string | null;
  endDate?: string | null;
  approximateYear: number | null;
  approximateAge: number | null;
  datePrecision: "exact" | "month" | "year" | "decade" | "approximate" | "unknown";
};

/** Human-readable date that never claims more precision than we have. */
export function describeWhen(e: WhenInput): { label: string; approximate: boolean } {
  if (e.startDate && e.datePrecision === "exact") {
    const d = new Date(`${e.startDate}T00:00:00Z`);
    return { label: d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }), approximate: false };
  }
  if (e.startDate && e.datePrecision === "month") {
    const d = new Date(`${e.startDate}T00:00:00Z`);
    return { label: d.toLocaleDateString(undefined, { year: "numeric", month: "long", timeZone: "UTC" }), approximate: false };
  }
  if (e.approximateYear) {
    if (e.datePrecision === "decade") return { label: `the ${Math.floor(e.approximateYear / 10) * 10}s`, approximate: true };
    if (e.datePrecision === "approximate") return { label: `around ${e.approximateYear}`, approximate: true };
    return { label: String(e.approximateYear), approximate: false };
  }
  if (e.approximateAge !== null) return { label: `around age ${e.approximateAge}`, approximate: true };
  return { label: "date unknown", approximate: true };
}

export function periodKey(e: WhenInput): string {
  if (e.approximateYear) return `${Math.floor(e.approximateYear / 10) * 10}s`;
  if (e.approximateAge !== null) return "By age";
  return "Undated";
}
