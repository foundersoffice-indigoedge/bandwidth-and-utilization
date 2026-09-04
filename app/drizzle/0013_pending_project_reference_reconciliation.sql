ALTER TABLE "pending_projects" ADD COLUMN IF NOT EXISTS "airtable_project_name" text;
--> statement-breakpoint
ALTER TABLE "pending_projects" ADD COLUMN IF NOT EXISTS "references_reconciled_at" timestamp;
