CREATE TYPE "public"."chapter_status" AS ENUM('planned', 'drafted', 'edited', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('ai_processing', 'audio_recording', 'privacy_acknowledgment', 'sharing');--> statement-breakpoint
CREATE TYPE "public"."date_precision" AS ENUM('exact', 'month', 'year', 'decade', 'approximate', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."generation_type" AS ENUM('ai_draft', 'ai_revision', 'user_edit', 'restore');--> statement-breakpoint
CREATE TYPE "public"."importance" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."input_mode" AS ENUM('text', 'voice', 'generated');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('accepted', 'pending', 'revoked', 'declined');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('transcribe_media', 'process_turn', 'plan_question', 'draft_chapter', 'revise_chapter', 'refresh_summary', 'export_manuscript', 'delete_project_media');--> statement-breakpoint
CREATE TYPE "public"."media_processing_status" AS ENUM('pending_upload', 'uploaded', 'transcribing', 'transcribed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'interviewer', 'narrator', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."project_type" AS ENUM('self_guided', 'hosted');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('proposed', 'confirmed', 'rejected', 'merged');--> statement-breakpoint
CREATE TYPE "public"."retention_status" AS ENUM('retained', 'scheduled_for_deletion', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."sensitivity" AS ENUM('normal', 'sensitive', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."interview_session_status" AS ENUM('active', 'paused', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."source_relationship" AS ENUM('primary', 'supporting', 'mentioned');--> statement-breakpoint
CREATE TYPE "public"."speaker_type" AS ENUM('interviewer', 'narrator', 'system');--> statement-breakpoint
CREATE TYPE "public"."thread_status" AS ENUM('open', 'in_progress', 'covered', 'deferred', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."transcription_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'corrected');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'auto_accepted', 'needs_confirmation', 'confirmed', 'rejected', 'conflicting');--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"actor_user_id" text,
	"action_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"subject_user_id" text,
	"consent_type" "consent_type" NOT NULL,
	"consent_status" "consent_status" NOT NULL,
	"policy_version" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "interview_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"interviewer_user_id" text NOT NULL,
	"narrator_user_id" text,
	"mode" "project_type" NOT NULL,
	"session_status" "interview_session_status" DEFAULT 'active' NOT NULL,
	"title" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"speaker_type" "speaker_type" NOT NULL,
	"input_mode" "input_mode" NOT NULL,
	"original_text" text NOT NULL,
	"corrected_text" text,
	"transcription_status" "transcription_status",
	"client_turn_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "life_event_people" (
	"event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "life_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"start_date" date,
	"end_date" date,
	"approximate_age" integer,
	"approximate_year" integer,
	"date_precision" date_precision DEFAULT 'unknown' NOT NULL,
	"location" text,
	"confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
	"status" "record_status" DEFAULT 'confirmed' NOT NULL,
	"sort_key" integer,
	"user_note" text,
	"merged_into_event_id" uuid,
	"source_turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manuscript_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"chapter_order" integer NOT NULL,
	"chapter_status" "chapter_status" DEFAULT 'planned' NOT NULL,
	"current_revision_id" uuid,
	"focus" text,
	"needs_update" boolean DEFAULT false NOT NULL,
	"needs_update_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manuscript_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"body" text NOT NULL,
	"generation_type" "generation_type" NOT NULL,
	"generation_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manuscript_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"source_turn_id" uuid NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"relationship_type" "source_relationship" DEFAULT 'supporting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid,
	"interview_turn_id" uuid,
	"uploaded_by_user_id" text,
	"storage_key" text NOT NULL,
	"storage_provider" text NOT NULL,
	"media_type" text NOT NULL,
	"processing_status" "media_processing_status" DEFAULT 'pending_upload' NOT NULL,
	"duration_seconds" integer,
	"file_size" integer DEFAULT 0 NOT NULL,
	"transcript_text" text,
	"transcription_provider" text,
	"processing_error" text,
	"retention_status" "retention_status" DEFAULT 'retained' NOT NULL,
	"retain_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memoir_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"narrator_name" text NOT NULL,
	"narrator_user_id" text,
	"project_type" "project_type" NOT NULL,
	"intended_scope" text DEFAULT 'full_life' NOT NULL,
	"scope_description" text,
	"writing_style" text DEFAULT 'warm_literary' NOT NULL,
	"project_status" "project_status" DEFAULT 'active' NOT NULL,
	"privacy_settings" jsonb DEFAULT '{"visibility":"private","allowAiProcessing":true,"retainAudioDays":90}'::jsonb NOT NULL,
	"topics_to_avoid" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"biography_summary" text,
	"biography_summary_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memory_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"fact_type" text NOT NULL,
	"fact_value" jsonb NOT NULL,
	"statement" text NOT NULL,
	"confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'normal' NOT NULL,
	"evidence_quote" text,
	"conflicts_with_fact_id" uuid,
	"source_turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"preferred_name" text NOT NULL,
	"full_name" text,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"relationship_to_narrator" text,
	"birth_date" date,
	"death_date" date,
	"date_precision" date_precision DEFAULT 'unknown' NOT NULL,
	"is_narrator" boolean DEFAULT false NOT NULL,
	"status" "record_status" DEFAULT 'confirmed' NOT NULL,
	"merged_into_person_id" uuid,
	"source_turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"job_type" "job_type" NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"invitation_status" "invitation_status" DEFAULT 'accepted' NOT NULL,
	"granted_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invited_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"preference_key" text NOT NULL,
	"preference_value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"related_person_id" uuid NOT NULL,
	"relationship_type" text NOT NULL,
	"description" text,
	"source_turn_id" uuid,
	"confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
	"status" "record_status" DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationships_no_self" CHECK ("relationships"."person_id" <> "relationships"."related_person_id")
);
--> statement-breakpoint
CREATE TABLE "story_thread_events" (
	"thread_id" uuid NOT NULL,
	"event_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_thread_people" (
	"thread_id" uuid NOT NULL,
	"person_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_thread_sources" (
	"thread_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"coverage_area" text,
	"importance" "importance" DEFAULT 'medium' NOT NULL,
	"status" "thread_status" DEFAULT 'open' NOT NULL,
	"suggested_follow_up" text,
	"times_asked" integer DEFAULT 0 NOT NULL,
	"last_asked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"user_id" text,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"duration_ms" integer,
	"succeeded" boolean NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_interviewer_user_id_users_id_fk" FOREIGN KEY ("interviewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_narrator_user_id_users_id_fk" FOREIGN KEY ("narrator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turns" ADD CONSTRAINT "interview_turns_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turns" ADD CONSTRAINT "interview_turns_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_event_people" ADD CONSTRAINT "life_event_people_event_id_life_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."life_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_event_people" ADD CONSTRAINT "life_event_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_events" ADD CONSTRAINT "life_events_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_events" ADD CONSTRAINT "life_events_source_turn_id_interview_turns_id_fk" FOREIGN KEY ("source_turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscript_chapters" ADD CONSTRAINT "manuscript_chapters_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscript_revisions" ADD CONSTRAINT "manuscript_revisions_chapter_id_manuscript_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."manuscript_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscript_revisions" ADD CONSTRAINT "manuscript_revisions_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscript_revisions" ADD CONSTRAINT "manuscript_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscript_sources" ADD CONSTRAINT "manuscript_sources_revision_id_manuscript_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."manuscript_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscript_sources" ADD CONSTRAINT "manuscript_sources_source_turn_id_interview_turns_id_fk" FOREIGN KEY ("source_turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_interview_turn_id_interview_turns_id_fk" FOREIGN KEY ("interview_turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memoir_projects" ADD CONSTRAINT "memoir_projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memoir_projects" ADD CONSTRAINT "memoir_projects_narrator_user_id_users_id_fk" FOREIGN KEY ("narrator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_facts" ADD CONSTRAINT "memory_facts_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_facts" ADD CONSTRAINT "memory_facts_source_turn_id_interview_turns_id_fk" FOREIGN KEY ("source_turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_source_turn_id_interview_turns_id_fk" FOREIGN KEY ("source_turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_preferences" ADD CONSTRAINT "project_preferences_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_related_person_id_people_id_fk" FOREIGN KEY ("related_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_source_turn_id_interview_turns_id_fk" FOREIGN KEY ("source_turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_thread_events" ADD CONSTRAINT "story_thread_events_thread_id_story_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."story_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_thread_events" ADD CONSTRAINT "story_thread_events_event_id_life_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."life_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_thread_people" ADD CONSTRAINT "story_thread_people_thread_id_story_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."story_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_thread_people" ADD CONSTRAINT "story_thread_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_thread_sources" ADD CONSTRAINT "story_thread_sources_thread_id_story_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."story_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_thread_sources" ADD CONSTRAINT "story_thread_sources_turn_id_interview_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."interview_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_threads" ADD CONSTRAINT "story_threads_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_accounts_user_id_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "audit_events_project_idx" ON "audit_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "consent_records_project_idx" ON "consent_records" USING btree ("project_id","consent_type");--> statement-breakpoint
CREATE INDEX "interview_sessions_project_idx" ON "interview_sessions" USING btree ("project_id","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turns_session_seq_unique" ON "interview_turns" USING btree ("session_id","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turns_client_id_unique" ON "interview_turns" USING btree ("session_id","client_turn_id");--> statement-breakpoint
CREATE INDEX "interview_turns_project_idx" ON "interview_turns" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "life_event_people_unique" ON "life_event_people" USING btree ("event_id","person_id");--> statement-breakpoint
CREATE INDEX "life_events_project_timeline_idx" ON "life_events" USING btree ("project_id","sort_key","approximate_year","start_date");--> statement-breakpoint
CREATE INDEX "manuscript_chapters_project_order_idx" ON "manuscript_chapters" USING btree ("project_id","chapter_order");--> statement-breakpoint
CREATE UNIQUE INDEX "manuscript_revisions_chapter_number_unique" ON "manuscript_revisions" USING btree ("chapter_id","revision_number");--> statement-breakpoint
CREATE INDEX "manuscript_sources_revision_idx" ON "manuscript_sources" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "manuscript_sources_turn_idx" ON "manuscript_sources" USING btree ("source_turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_storage_key_unique" ON "media_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_assets_project_idx" ON "media_assets" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_turn_idx" ON "media_assets" USING btree ("interview_turn_id");--> statement-breakpoint
CREATE INDEX "memoir_projects_owner_idx" ON "memoir_projects" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "memoir_projects_narrator_idx" ON "memoir_projects" USING btree ("narrator_user_id");--> statement-breakpoint
CREATE INDEX "memory_facts_project_idx" ON "memory_facts" USING btree ("project_id","verification_status");--> statement-breakpoint
CREATE INDEX "memory_facts_subject_idx" ON "memory_facts" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "memory_facts_source_idx" ON "memory_facts" USING btree ("source_turn_id");--> statement-breakpoint
CREATE INDEX "people_project_idx" ON "people" USING btree ("project_id","preferred_name");--> statement-breakpoint
CREATE UNIQUE INDEX "processing_jobs_idempotency_unique" ON "processing_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "processing_jobs_status_idx" ON "processing_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "processing_jobs_project_idx" ON "processing_jobs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_memberships_unique" ON "project_memberships" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_memberships_user_idx" ON "project_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_preferences_unique" ON "project_preferences" USING btree ("project_id","preference_key");--> statement-breakpoint
CREATE INDEX "relationships_project_idx" ON "relationships" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "relationships_person_idx" ON "relationships" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_unique_assertion" ON "relationships" USING btree ("person_id","related_person_id","relationship_type");--> statement-breakpoint
CREATE UNIQUE INDEX "story_thread_events_unique" ON "story_thread_events" USING btree ("thread_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_thread_people_unique" ON "story_thread_people" USING btree ("thread_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_thread_sources_unique" ON "story_thread_sources" USING btree ("thread_id","turn_id");--> statement-breakpoint
CREATE INDEX "story_threads_project_status_idx" ON "story_threads" USING btree ("project_id","status","importance");--> statement-breakpoint
CREATE INDEX "usage_events_project_idx" ON "usage_events" USING btree ("project_id","created_at");