import { z } from "zod";

/**
 * Conversation Weave input contracts, shared by the browser and the server.
 * The server always re-validates; nothing here is trusted on its own.
 */

/** Container types accepted for original recordings, keyed by normalized MIME type. */
export const WEAVE_AUDIO_TYPES: Record<string, { extension: string; label: string }> = {
  "audio/mp4": { extension: "m4a", label: "M4A" },
  "audio/x-m4a": { extension: "m4a", label: "M4A" },
  "audio/mpeg": { extension: "mp3", label: "MP3" },
  "audio/wav": { extension: "wav", label: "WAV" },
  "audio/x-wav": { extension: "wav", label: "WAV" },
  "audio/aac": { extension: "aac", label: "AAC" },
  "audio/webm": { extension: "webm", label: "WebM" },
  "audio/ogg": { extension: "ogg", label: "Ogg" },
};

const EXTENSION_TYPES: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  webm: "audio/webm",
  ogg: "audio/ogg",
  oga: "audio/ogg",
};

const TYPE_ALIASES: Record<string, string> = { "audio/mp3": "audio/mpeg", "audio/m4a": "audio/mp4", "audio/vnd.wave": "audio/wav" };

/** What the file picker accepts. iPhone Files and Voice Memos give .m4a. */
export const WEAVE_ACCEPT_ATTRIBUTE = "audio/*,.m4a,.mp3,.wav,.aac,.webm,.ogg";

/**
 * Resolves the container type from the browser's MIME type, falling back to
 * the file extension (iOS sometimes reports an empty type). Returns null for
 * anything not on the allow-list.
 */
export function resolveWeaveAudioType(mimeType: string, filename: string): string | null {
  const base = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  const aliased = TYPE_ALIASES[base] ?? base;
  if (aliased && WEAVE_AUDIO_TYPES[aliased]) return aliased;
  if (aliased && aliased !== "application/octet-stream" && aliased !== "") return null;
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_TYPES[ext] ?? null;
}

const participantSchema = z.object({
  displayName: z.string().trim().min(1, "Add a name.").max(60, "Keep names under 60 characters."),
  personId: z.string().uuid().nullable().optional(),
  isAccountHolder: z.boolean().default(false),
});

const participantsSchema = z
  .array(participantSchema)
  .min(2, "A conversation needs at least two people.")
  .max(6, "Up to six people can be named.")
  .refine((list) => list.filter((p) => p.isAccountHolder).length <= 1, "Only one person can be you.");

export const createWeaveSchema = z.object({
  title: z.string().trim().min(1, "Give the conversation a title.").max(120, "Keep the title under 120 characters."),
  contextNote: z.string().trim().max(2000, "Keep the note under 2,000 characters.").optional().default(""),
  participants: participantsSchema,
  participantConsent: z.literal(true, { message: "Please confirm everyone agreed to be recorded." }),
});
export type CreateWeaveInput = z.infer<typeof createWeaveSchema>;

export const updateWeaveSchema = z.object({
  title: z.string().trim().min(1, "Give the conversation a title.").max(120).optional(),
  contextNote: z.string().trim().max(2000).optional(),
  participants: participantsSchema.optional(),
});
export type UpdateWeaveInput = z.infer<typeof updateWeaveSchema>;

export const reserveRecordingSchema = z.object({
  clientUploadId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, "Invalid upload id."),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().max(100).default(""),
  size: z.number().int().positive("The file is empty."),
  durationSeconds: z.number().min(0).max(24 * 3600).nullable().optional(),
});
export type ReserveRecordingInput = z.infer<typeof reserveRecordingSchema>;

export const DATE_PRECISIONS = [
  { value: "exact", label: "Exact day" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "approximate", label: "Approximately" },
] as const;

export const updateRecordingSchema = z.object({
  recordedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2024-05-31.")
    .nullable()
    .optional(),
  recordedOnPrecision: z.enum(["exact", "month", "year", "approximate"]).nullable().optional(),
  contextNote: z.string().trim().max(1000).nullable().optional(),
});
export type UpdateRecordingInput = z.infer<typeof updateRecordingSchema>;

/** Payload the browser attaches when asking for a direct-upload token. */
export const uploadClientPayloadSchema = z.object({ recordingId: z.string().uuid() });
