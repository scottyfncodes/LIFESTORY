CREATE TYPE "public"."media_purpose" AS ENUM('interview_answer', 'weave_source');--> statement-breakpoint
CREATE TYPE "public"."weave_recording_status" AS ENUM('awaiting_upload', 'uploaded', 'transcribing', 'transcribed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."weave_status" AS ENUM('draft', 'transcribing', 'reviewing', 'analyzing', 'weaving', 'ready', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "weave_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weave_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"person_id" uuid,
	"is_account_holder" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weave_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weave_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"client_upload_id" text NOT NULL,
	"position" integer NOT NULL,
	"status" "weave_recording_status" DEFAULT 'awaiting_upload' NOT NULL,
	"original_filename" text NOT NULL,
	"declared_mime_type" text NOT NULL,
	"declared_size" integer NOT NULL,
	"declared_duration_seconds" integer,
	"recorded_on" date,
	"recorded_on_precision" date_precision,
	"context_note" text,
	"failure_code" text,
	"uploaded_by_user_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "weaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"context_note" text,
	"status" "weave_status" DEFAULT 'draft' NOT NULL,
	"participant_consent_at" timestamp with time zone NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "purpose" "media_purpose" DEFAULT 'interview_answer' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "original_filename" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "retention_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "weave_participants" ADD CONSTRAINT "weave_participants_weave_id_weaves_id_fk" FOREIGN KEY ("weave_id") REFERENCES "public"."weaves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weave_participants" ADD CONSTRAINT "weave_participants_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weave_participants" ADD CONSTRAINT "weave_participants_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weave_recordings" ADD CONSTRAINT "weave_recordings_weave_id_weaves_id_fk" FOREIGN KEY ("weave_id") REFERENCES "public"."weaves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weave_recordings" ADD CONSTRAINT "weave_recordings_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weave_recordings" ADD CONSTRAINT "weave_recordings_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weave_recordings" ADD CONSTRAINT "weave_recordings_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weaves" ADD CONSTRAINT "weaves_project_id_memoir_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."memoir_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weaves" ADD CONSTRAINT "weaves_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weave_participants_weave_idx" ON "weave_participants" USING btree ("weave_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "weave_recordings_client_upload_unique" ON "weave_recordings" USING btree ("weave_id","client_upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weave_recordings_media_asset_unique" ON "weave_recordings" USING btree ("media_asset_id");--> statement-breakpoint
CREATE INDEX "weave_recordings_weave_idx" ON "weave_recordings" USING btree ("weave_id","position");--> statement-breakpoint
CREATE INDEX "weave_recordings_project_idx" ON "weave_recordings" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "weaves_project_idx" ON "weaves" USING btree ("project_id","created_at");