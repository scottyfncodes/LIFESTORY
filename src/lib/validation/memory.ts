import { z } from "zod";

export const datePrecisionValues = ["exact", "month", "year", "decade", "approximate", "unknown"] as const;

export const EVENT_CATEGORIES = [
  { value: "birth", label: "Birth" },
  { value: "home", label: "Home" },
  { value: "move", label: "Move" },
  { value: "education", label: "Education" },
  { value: "work", label: "Work" },
  { value: "relationship", label: "Relationship" },
  { value: "family", label: "Family" },
  { value: "travel", label: "Travel" },
  { value: "health", label: "Health" },
  { value: "loss", label: "Loss" },
  { value: "achievement", label: "Achievement" },
  { value: "turning_point", label: "Turning point" },
  { value: "other", label: "Other" },
] as const;

const optionalText = (max: number) => z.string().trim().max(max).transform((v) => (v ? v : null));
const optionalDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.").or(z.literal("")).transform((v) => (v ? v : null));
const optionalInt = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().int().min(min).max(max).nullable());

export const updatePersonSchema = z.object({
  preferredName: z.string().trim().min(1, "A name is required.").max(120),
  fullName: optionalText(160),
  aliases: z.string().trim().max(400).transform((raw) => raw.split(/[,\n]+/).map((a) => a.trim()).filter(Boolean).slice(0, 10)),
  relationshipToNarrator: optionalText(120),
  description: optionalText(600),
  notes: optionalText(1000),
  birthDate: optionalDate,
  deathDate: optionalDate,
  datePrecision: z.enum(datePrecisionValues).default("unknown"),
});

export const updateEventSchema = z.object({
  title: z.string().trim().min(1, "A title is required.").max(160),
  description: z.string().trim().max(2000).default(""),
  category: z.enum(EVENT_CATEGORIES.map((c) => c.value) as [string, ...string[]]).default("other"),
  approximateYear: optionalInt(1850, 2100),
  approximateAge: optionalInt(0, 120),
  startDate: optionalDate,
  endDate: optionalDate,
  datePrecision: z.enum(datePrecisionValues).default("unknown"),
  location: optionalText(160),
  userNote: optionalText(600),
});

export const idSchema = z.string().uuid();
