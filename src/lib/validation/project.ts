import { z } from "zod";

export const INTENDED_SCOPES = [
  { value: "full_life", label: "My whole life so far" },
  { value: "childhood", label: "Childhood and growing up" },
  { value: "family", label: "Family history and the people who shaped me" },
  { value: "career", label: "Work, projects and vocation" },
  { value: "specific_period", label: "A particular period or chapter of life" },
  { value: "legacy", label: "Lessons, values and what I want to pass on" },
] as const;

export const WRITING_STYLES = [
  {
    value: "warm_literary",
    label: "Warm and literary",
    description: "Readable, unhurried prose that keeps your own turns of phrase.",
  },
  {
    value: "plain_spoken",
    label: "Plain-spoken",
    description: "Direct and simple, close to the way you talk.",
  },
  {
    value: "reflective",
    label: "Reflective",
    description: "Room for meaning and perspective alongside the events.",
  },
  {
    value: "lively",
    label: "Lively",
    description: "Keeps the humour and energy of a good story told out loud.",
  },
] as const;

export type IntendedScope = (typeof INTENDED_SCOPES)[number]["value"];
export type WritingStyle = (typeof WRITING_STYLES)[number]["value"];

const scopeValues = INTENDED_SCOPES.map((s) => s.value) as [IntendedScope, ...IntendedScope[]];
const styleValues = WRITING_STYLES.map((s) => s.value) as [WritingStyle, ...WritingStyle[]];

export const topicsToAvoidSchema = z
  .string()
  .trim()
  .max(1000)
  .transform((raw) =>
    raw
      .split(/[\n,;]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 25),
  );

export const createProjectSchema = z.object({
  title: z.string().trim().min(1, "Give your memoir a working title.").max(120),
  narratorName: z.string().trim().min(1, "Tell us what the narrator likes to be called.").max(80),
  narratorIsUser: z.enum(["yes", "no"]),
  intendedScope: z.enum(scopeValues),
  scopeDescription: z.string().trim().max(400).optional().default(""),
  writingStyle: z.enum(styleValues).default("warm_literary"),
  topicsToAvoid: z.preprocess((v) => (v == null ? "" : v), topicsToAvoidSchema),
  acknowledgePrivacy: z.literal("on", {
    error: "Please confirm you've read how your story is stored and processed.",
  }),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  narratorName: z.string().trim().min(1).max(80),
  intendedScope: z.enum(scopeValues),
  scopeDescription: z.string().trim().max(400).optional().default(""),
  writingStyle: z.enum(styleValues),
  topicsToAvoid: z.preprocess((v) => (v == null ? "" : v), topicsToAvoidSchema),
  retainAudioDays: z.enum(["30", "90", "365", "keep"]).default("90"),
});

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/** Flattens Zod issues into a field → messages map safe to show users. */
export function flattenIssues(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
