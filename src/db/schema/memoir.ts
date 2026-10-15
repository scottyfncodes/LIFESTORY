import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  check,
  date,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import {
  projectTypeEnum,
  projectStatusEnum,
  membershipRoleEnum,
  invitationStatusEnum,
  sessionStatusEnum,
  speakerTypeEnum,
  inputModeEnum,
  transcriptionStatusEnum,
  mediaProcessingStatusEnum,
  retentionStatusEnum,
  datePrecisionEnum,
  confidenceEnum,
  recordStatusEnum,
  verificationStatusEnum,
  sensitivityEnum,
  threadStatusEnum,
  importanceEnum,
  chapterStatusEnum,
  generationTypeEnum,
  sourceRelationshipEnum,
  consentTypeEnum,
  consentStatusEnum,
  jobStatusEnum,
  jobTypeEnum,
} from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export type PrivacySettings = {
  visibility: "private";
  allowAiProcessing: boolean;
  retainAudioDays: number | null;
};

export const memoirProjects = pgTable(
  "memoir_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    narratorName: text("narrator_name").notNull(),
    narratorUserId: text("narrator_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    projectType: projectTypeEnum("project_type").notNull(),
    intendedScope: text("intended_scope").notNull().default("full_life"),
    scopeDescription: text("scope_description"),
    writingStyle: text("writing_style").notNull().default("warm_literary"),
    projectStatus: projectStatusEnum("project_status").notNull().default("active"),
    privacySettings: jsonb("privacy_settings")
      .$type<PrivacySettings>()
      .notNull()
      .default({ visibility: "private", allowAiProcessing: true, retainAudioDays: 90 }),
    topicsToAvoid: jsonb("topics_to_avoid").$type<string[]>().notNull().default([]),
    biographySummary: text("biography_summary"),
    biographySummaryUpdatedAt: timestamp("biography_summary_updated_at", {
      withTimezone: true,
    }),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("memoir_projects_owner_idx").on(t.ownerUserId, t.updatedAt),
    index("memoir_projects_narrator_idx").on(t.narratorUserId),
  ],
);

export const projectMemberships = pgTable(
  "project_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    invitationStatus: invitationStatusEnum("invitation_status").notNull().default("accepted"),
    grantedPermissions: jsonb("granted_permissions").$type<string[]>().notNull().default([]),
    invitedByUserId: text("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("project_memberships_unique").on(t.projectId, t.userId),
    index("project_memberships_user_idx").on(t.userId),
  ],
);

export const interviewSessions = pgTable(
  "interview_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    interviewerUserId: text("interviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    narratorUserId: text("narrator_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    mode: projectTypeEnum("mode").notNull(),
    sessionStatus: sessionStatusEnum("session_status").notNull().default("active"),
    title: text("title"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (t) => [index("interview_sessions_project_idx").on(t.projectId, t.lastActivityAt)],
);

export type TurnMetadata = {
  questionSource?: "ai" | "planner" | "opening";
  threadId?: string | null;
  coverageArea?: string | null;
  skipped?: boolean;
  draftOf?: string | null;
  clientTurnId?: string;
  processingStatus?: "pending" | "processed" | "failed" | "skipped";
  processingError?: string | null;
};

export const interviewTurns = pgTable(
  "interview_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => interviewSessions.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    sequenceNumber: integer("sequence_number").notNull(),
    speakerType: speakerTypeEnum("speaker_type").notNull(),
    inputMode: inputModeEnum("input_mode").notNull(),
    originalText: text("original_text").notNull(),
    correctedText: text("corrected_text"),
    transcriptionStatus: transcriptionStatusEnum("transcription_status"),
    clientTurnId: text("client_turn_id"),
    metadata: jsonb("metadata").$type<TurnMetadata>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("interview_turns_session_seq_unique").on(t.sessionId, t.sequenceNumber),
    uniqueIndex("interview_turns_client_id_unique").on(t.sessionId, t.clientTurnId),
    index("interview_turns_project_idx").on(t.projectId, t.createdAt),
  ],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => interviewSessions.id, {
      onDelete: "set null",
    }),
    interviewTurnId: uuid("interview_turn_id").references(() => interviewTurns.id, {
      onDelete: "set null",
    }),
    uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    storageKey: text("storage_key").notNull(),
    storageProvider: text("storage_provider").notNull(),
    mediaType: text("media_type").notNull(),
    processingStatus: mediaProcessingStatusEnum("processing_status")
      .notNull()
      .default("pending_upload"),
    durationSeconds: integer("duration_seconds"),
    fileSize: integer("file_size").notNull().default(0),
    transcriptText: text("transcript_text"),
    transcriptionProvider: text("transcription_provider"),
    processingError: text("processing_error"),
    retentionStatus: retentionStatusEnum("retention_status").notNull().default("retained"),
    retainUntil: timestamp("retain_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("media_assets_storage_key_unique").on(t.storageKey),
    index("media_assets_project_idx").on(t.projectId, t.createdAt),
    index("media_assets_turn_idx").on(t.interviewTurnId),
  ],
);

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    preferredName: text("preferred_name").notNull(),
    fullName: text("full_name"),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    description: text("description"),
    relationshipToNarrator: text("relationship_to_narrator"),
    birthDate: date("birth_date"),
    deathDate: date("death_date"),
    datePrecision: datePrecisionEnum("date_precision").notNull().default("unknown"),
    isNarrator: boolean("is_narrator").notNull().default(false),
    status: recordStatusEnum("status").notNull().default("confirmed"),
    userVerified: boolean("user_verified").notNull().default(false),
    notes: text("notes"),
    mergedIntoPersonId: uuid("merged_into_person_id"),
    sourceTurnId: uuid("source_turn_id").references(() => interviewTurns.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [index("people_project_idx").on(t.projectId, t.preferredName)],
);

export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    relatedPersonId: uuid("related_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    description: text("description"),
    sourceTurnId: uuid("source_turn_id").references(() => interviewTurns.id, {
      onDelete: "set null",
    }),
    confidence: confidenceEnum("confidence").notNull().default("medium"),
    status: recordStatusEnum("status").notNull().default("confirmed"),
    ...timestamps,
  },
  (t) => [
    index("relationships_project_idx").on(t.projectId),
    index("relationships_person_idx").on(t.personId),
    uniqueIndex("relationships_unique_assertion").on(
      t.personId,
      t.relatedPersonId,
      t.relationshipType,
    ),
    check("relationships_no_self", sql`${t.personId} <> ${t.relatedPersonId}`),
  ],
);

export const lifeEvents = pgTable(
  "life_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default("other"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    approximateAge: integer("approximate_age"),
    approximateYear: integer("approximate_year"),
    datePrecision: datePrecisionEnum("date_precision").notNull().default("unknown"),
    location: text("location"),
    confidence: confidenceEnum("confidence").notNull().default("medium"),
    status: recordStatusEnum("status").notNull().default("confirmed"),
    userVerified: boolean("user_verified").notNull().default(false),
    sortKey: integer("sort_key"),
    userNote: text("user_note"),
    mergedIntoEventId: uuid("merged_into_event_id"),
    sourceTurnId: uuid("source_turn_id").references(() => interviewTurns.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("life_events_project_timeline_idx").on(
      t.projectId,
      t.sortKey,
      t.approximateYear,
      t.startDate,
    ),
  ],
);

export const lifeEventPeople = pgTable(
  "life_event_people",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => lifeEvents.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("life_event_people_unique").on(t.eventId, t.personId)],
);

export const memoryFacts = pgTable(
  "memory_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id"),
    factType: text("fact_type").notNull(),
    factValue: jsonb("fact_value").$type<Record<string, unknown>>().notNull(),
    statement: text("statement").notNull(),
    confidence: confidenceEnum("confidence").notNull().default("medium"),
    verificationStatus: verificationStatusEnum("verification_status")
      .notNull()
      .default("unverified"),
    sensitivity: sensitivityEnum("sensitivity").notNull().default("normal"),
    evidenceQuote: text("evidence_quote"),
    conflictsWithFactId: uuid("conflicts_with_fact_id"),
    sourceTurnId: uuid("source_turn_id").references(() => interviewTurns.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("memory_facts_project_idx").on(t.projectId, t.verificationStatus),
    index("memory_facts_subject_idx").on(t.subjectType, t.subjectId),
    index("memory_facts_source_idx").on(t.sourceTurnId),
  ],
);

export const storyThreads = pgTable(
  "story_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    coverageArea: text("coverage_area"),
    importance: importanceEnum("importance").notNull().default("medium"),
    status: threadStatusEnum("status").notNull().default("open"),
    suggestedFollowUp: text("suggested_follow_up"),
    timesAsked: integer("times_asked").notNull().default(0),
    lastAskedAt: timestamp("last_asked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("story_threads_project_status_idx").on(t.projectId, t.status, t.importance)],
);

export const storyThreadSources = pgTable(
  "story_thread_sources",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => storyThreads.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id")
      .notNull()
      .references(() => interviewTurns.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("story_thread_sources_unique").on(t.threadId, t.turnId)],
);

export const storyThreadPeople = pgTable(
  "story_thread_people",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => storyThreads.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("story_thread_people_unique").on(t.threadId, t.personId)],
);

export const storyThreadEvents = pgTable(
  "story_thread_events",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => storyThreads.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => lifeEvents.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("story_thread_events_unique").on(t.threadId, t.eventId)],
);

export const manuscriptChapters = pgTable(
  "manuscript_chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    chapterOrder: integer("chapter_order").notNull(),
    chapterStatus: chapterStatusEnum("chapter_status").notNull().default("planned"),
    currentRevisionId: uuid("current_revision_id"),
    focus: text("focus"),
    plannedSourceTurnIds: jsonb("planned_source_turn_ids").$type<string[]>().notNull().default([]),
    needsUpdate: boolean("needs_update").notNull().default(false),
    needsUpdateReason: text("needs_update_reason"),
    ...timestamps,
  },
  (t) => [index("manuscript_chapters_project_order_idx").on(t.projectId, t.chapterOrder)],
);

export type RevisionFlag = {
  kind: "uncertain" | "missing" | "conflict";
  passage: string;
  note: string;
};

export const manuscriptRevisions = pgTable(
  "manuscript_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => manuscriptChapters.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    body: text("body").notNull(),
    generationType: generationTypeEnum("generation_type").notNull(),
    generationMetadata: jsonb("generation_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    flags: jsonb("flags").$type<RevisionFlag[]>().notNull().default([]),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("manuscript_revisions_chapter_number_unique").on(t.chapterId, t.revisionNumber)],
);

export const manuscriptSources = pgTable(
  "manuscript_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => manuscriptRevisions.id, { onDelete: "cascade" }),
    sourceTurnId: uuid("source_turn_id")
      .notNull()
      .references(() => interviewTurns.id, { onDelete: "cascade" }),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    relationshipType: sourceRelationshipEnum("relationship_type").notNull().default("supporting"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("manuscript_sources_revision_idx").on(t.revisionId),
    index("manuscript_sources_turn_idx").on(t.sourceTurnId),
  ],
);

export const projectPreferences = pgTable(
  "project_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    preferenceKey: text("preference_key").notNull(),
    preferenceValue: jsonb("preference_value").$type<unknown>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("project_preferences_unique").on(t.projectId, t.preferenceKey)],
);

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    subjectUserId: text("subject_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    consentType: consentTypeEnum("consent_type").notNull(),
    consentStatus: consentStatusEnum("consent_status").notNull(),
    policyVersion: text("policy_version").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("consent_records_project_idx").on(t.projectId, t.consentType)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id"),
    actorUserId: text("actor_user_id"),
    actionType: text("action_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_events_project_idx").on(t.projectId, t.createdAt)],
);

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => memoirProjects.id, { onDelete: "cascade" }),
    jobType: jobTypeEnum("job_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    runAfter: timestamp("run_after", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("processing_jobs_idempotency_unique").on(t.idempotencyKey),
    index("processing_jobs_status_idx").on(t.status, t.runAfter),
    index("processing_jobs_project_idx").on(t.projectId, t.createdAt),
  ],
);

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  },
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id"),
    userId: text("user_id"),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    durationMs: integer("duration_ms"),
    succeeded: boolean("succeeded").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("usage_events_project_idx").on(t.projectId, t.createdAt)],
);

export const memoirProjectsRelations = relations(memoirProjects, ({ one, many }) => ({
  owner: one(users, { fields: [memoirProjects.ownerUserId], references: [users.id] }),
  memberships: many(projectMemberships),
  sessions: many(interviewSessions),
  chapters: many(manuscriptChapters),
}));

export const projectMembershipsRelations = relations(projectMemberships, ({ one }) => ({
  project: one(memoirProjects, {
    fields: [projectMemberships.projectId],
    references: [memoirProjects.id],
  }),
  user: one(users, { fields: [projectMemberships.userId], references: [users.id] }),
}));

export const interviewSessionsRelations = relations(interviewSessions, ({ one, many }) => ({
  project: one(memoirProjects, {
    fields: [interviewSessions.projectId],
    references: [memoirProjects.id],
  }),
  turns: many(interviewTurns),
}));

export const interviewTurnsRelations = relations(interviewTurns, ({ one, many }) => ({
  session: one(interviewSessions, {
    fields: [interviewTurns.sessionId],
    references: [interviewSessions.id],
  }),
  media: many(mediaAssets),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one }) => ({
  turn: one(interviewTurns, {
    fields: [mediaAssets.interviewTurnId],
    references: [interviewTurns.id],
  }),
}));

export const manuscriptChaptersRelations = relations(manuscriptChapters, ({ one, many }) => ({
  project: one(memoirProjects, {
    fields: [manuscriptChapters.projectId],
    references: [memoirProjects.id],
  }),
  revisions: many(manuscriptRevisions),
}));

export const manuscriptRevisionsRelations = relations(manuscriptRevisions, ({ one, many }) => ({
  chapter: one(manuscriptChapters, {
    fields: [manuscriptRevisions.chapterId],
    references: [manuscriptChapters.id],
  }),
  sources: many(manuscriptSources),
}));

export const manuscriptSourcesRelations = relations(manuscriptSources, ({ one }) => ({
  revision: one(manuscriptRevisions, {
    fields: [manuscriptSources.revisionId],
    references: [manuscriptRevisions.id],
  }),
  turn: one(interviewTurns, {
    fields: [manuscriptSources.sourceTurnId],
    references: [interviewTurns.id],
  }),
}));

export const lifeEventsRelations = relations(lifeEvents, ({ many }) => ({
  people: many(lifeEventPeople),
}));

export const lifeEventPeopleRelations = relations(lifeEventPeople, ({ one }) => ({
  event: one(lifeEvents, { fields: [lifeEventPeople.eventId], references: [lifeEvents.id] }),
  person: one(people, { fields: [lifeEventPeople.personId], references: [people.id] }),
}));

export const peopleRelations = relations(people, ({ many }) => ({
  events: many(lifeEventPeople),
}));
