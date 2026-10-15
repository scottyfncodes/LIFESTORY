ALTER TABLE "life_events" ADD COLUMN "user_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "user_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "notes" text;