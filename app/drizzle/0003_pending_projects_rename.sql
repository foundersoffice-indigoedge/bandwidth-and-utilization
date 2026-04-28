ALTER TABLE "ad_hoc_projects" RENAME TO "pending_projects";--> statement-breakpoint
ALTER TABLE "pending_projects" DROP COLUMN "linked_airtable_record_id";--> statement-breakpoint
ALTER TABLE "pending_projects" DROP COLUMN "linked_at";--> statement-breakpoint
UPDATE "pending_projects" SET "status" = 'pending' WHERE "status" IN ('active', 'linked', 'superseded');--> statement-breakpoint
ALTER TABLE "pending_projects" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "conflicts" DROP COLUMN "is_ad_hoc";--> statement-breakpoint
UPDATE "submissions" SET "project_record_id" = REPLACE("project_record_id", 'adhoc_', 'pending_') WHERE "project_record_id" LIKE 'adhoc_%';--> statement-breakpoint
UPDATE "conflicts" SET "project_record_id" = REPLACE("project_record_id", 'adhoc_', 'pending_') WHERE "project_record_id" LIKE 'adhoc_%';
