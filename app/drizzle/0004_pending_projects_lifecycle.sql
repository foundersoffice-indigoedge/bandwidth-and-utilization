ALTER TABLE "pending_projects" ADD COLUMN "airtable_record_id" text;--> statement-breakpoint
ALTER TABLE "pending_projects" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "pending_projects" ADD COLUMN "resolved_at" timestamp;