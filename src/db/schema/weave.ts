import { relations } from "drizzle-orm";
import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { datePrecisionEnum, weaveRecordingStatusEnum, weaveStatusEnum } from "./enums";
import { mediaAssets, memoirProjects, people } from "./memoir";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

/**
 * Conversation Weave: several recorded conversations between real people that
 * are later woven into one readable dialogue. Original recordings are stored
 * as `media_assets` (purpose `weave_source`) and are never modified.
 */
export const weaves = pgTable(
  "weaves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contextNote: text("context_note"),
    status: weaveStatusEnum("status").notNull().default("draft"),
    /** The creator confirmed everyone recorded agreed to being recorded and stored. */
    participantConsentAt: timestamp("participant_consent_at", { withTimezone: true }).notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("weaves_project_idx").on(t.projectId, t.createdAt)],
);

export const weaveParticipants = pgTable(
  "weave_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weaveId: uuid("weave_id")
      .notNull()
      .references(() => weaves.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    isAccountHolder: boolean("is_account_holder").notNull().default(false),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (t) => [index("weave_participants_weave_idx").on(t.weaveId, t.position)],
);

export const weaveRecordings = pgTable(
  "weave_recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weaveId: uuid("weave_id")
      .notNull()
      .references(() => weaves.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    /** Client-generated id for one file selection; makes reserving an upload idempotent. */
    clientUploadId: text("client_upload_id").notNull(),
    position: integer("position").notNull(),
    status: weaveRecordingStatusEnum("status").notNull().default("awaiting_upload"),
    originalFilename: text("original_filename").notNull(),
    declaredMimeType: text("declared_mime_type").notNull(),
    declaredSize: integer("declared_size").notNull(),
    /** Read from the file in the browser; advisory until transcription measures it. */
    declaredDurationSeconds: integer("declared_duration_seconds"),
    recordedOn: date("recorded_on"),
    recordedOnPrecision: datePrecisionEnum("recorded_on_precision"),
    contextNote: text("context_note"),
    failureCode: text("failure_code"),
    uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("weave_recordings_client_upload_unique").on(t.weaveId, t.clientUploadId),
    uniqueIndex("weave_recordings_media_asset_unique").on(t.mediaAssetId),
    index("weave_recordings_weave_idx").on(t.weaveId, t.position),
    index("weave_recordings_project_idx").on(t.projectId, t.createdAt),
  ],
);

export const weavesRelations = relations(weaves, ({ one, many }) => ({
  project: one(memoirProjects, { fields: [weaves.projectId], references: [memoirProjects.id] }),
  participants: many(weaveParticipants),
  recordings: many(weaveRecordings),
}));

export const weaveParticipantsRelations = relations(weaveParticipants, ({ one }) => ({
  weave: one(weaves, { fields: [weaveParticipants.weaveId], references: [weaves.id] }),
  person: one(people, { fields: [weaveParticipants.personId], references: [people.id] }),
}));

export const weaveRecordingsRelations = relations(weaveRecordings, ({ one }) => ({
  weave: one(weaves, { fields: [weaveRecordings.weaveId], references: [weaves.id] }),
  asset: one(mediaAssets, { fields: [weaveRecordings.mediaAssetId], references: [mediaAssets.id] }),
}));
