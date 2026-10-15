import { pgEnum } from "drizzle-orm/pg-core";

export const projectTypeEnum = pgEnum("project_type", ["self_guided", "hosted"]);
export const projectStatusEnum = pgEnum("project_status", ["active", "archived", "deleted"]);
export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "interviewer",
  "narrator",
  "editor",
  "viewer",
]);
export const invitationStatusEnum = pgEnum("invitation_status", [
  "accepted",
  "pending",
  "revoked",
  "declined",
]);
export const sessionStatusEnum = pgEnum("interview_session_status", [
  "active",
  "paused",
  "completed",
  "abandoned",
]);
export const speakerTypeEnum = pgEnum("speaker_type", ["interviewer", "narrator", "system"]);
export const inputModeEnum = pgEnum("input_mode", ["text", "voice", "generated"]);
export const transcriptionStatusEnum = pgEnum("transcription_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "corrected",
]);
export const mediaProcessingStatusEnum = pgEnum("media_processing_status", [
  "pending_upload",
  "uploaded",
  "transcribing",
  "transcribed",
  "failed",
]);
export const retentionStatusEnum = pgEnum("retention_status", [
  "retained",
  "scheduled_for_deletion",
  "deleted",
]);
export const datePrecisionEnum = pgEnum("date_precision", [
  "exact",
  "month",
  "year",
  "decade",
  "approximate",
  "unknown",
]);
export const confidenceEnum = pgEnum("confidence_level", ["low", "medium", "high"]);
export const recordStatusEnum = pgEnum("record_status", [
  "proposed",
  "confirmed",
  "rejected",
  "merged",
]);
export const verificationStatusEnum = pgEnum("verification_status", [
  "unverified",
  "auto_accepted",
  "needs_confirmation",
  "confirmed",
  "rejected",
  "conflicting",
]);
export const sensitivityEnum = pgEnum("sensitivity", ["normal", "sensitive", "excluded"]);
export const threadStatusEnum = pgEnum("thread_status", [
  "open",
  "in_progress",
  "covered",
  "deferred",
  "excluded",
]);
export const importanceEnum = pgEnum("importance", ["low", "medium", "high"]);
export const chapterStatusEnum = pgEnum("chapter_status", [
  "planned",
  "drafted",
  "edited",
  "needs_review",
]);
export const generationTypeEnum = pgEnum("generation_type", [
  "ai_draft",
  "ai_revision",
  "user_edit",
  "restore",
]);
export const sourceRelationshipEnum = pgEnum("source_relationship", [
  "primary",
  "supporting",
  "mentioned",
]);
export const consentTypeEnum = pgEnum("consent_type", [
  "ai_processing",
  "audio_recording",
  "privacy_acknowledgment",
  "sharing",
]);
export const consentStatusEnum = pgEnum("consent_status", ["granted", "revoked"]);
export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const mediaPurposeEnum = pgEnum("media_purpose", ["interview_answer", "weave_source"]);
export const weaveStatusEnum = pgEnum("weave_status", [
  "draft",
  "transcribing",
  "reviewing",
  "analyzing",
  "weaving",
  "ready",
  "failed",
  "cancelled",
]);
export const weaveRecordingStatusEnum = pgEnum("weave_recording_status", [
  "awaiting_upload",
  "uploaded",
  "transcribing",
  "transcribed",
  "failed",
]);
export const jobTypeEnum = pgEnum("job_type", [
  "transcribe_media",
  "process_turn",
  "plan_question",
  "draft_chapter",
  "revise_chapter",
  "refresh_summary",
  "export_manuscript",
  "delete_project_media",
]);
