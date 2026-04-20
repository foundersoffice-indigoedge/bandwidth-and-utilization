CREATE TABLE "ad_hoc_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"director_record_id" text,
	"director_name" text,
	"teammate_record_ids" jsonb NOT NULL,
	"created_by_fellow_id" text NOT NULL,
	"created_by_fellow_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"linked_airtable_record_id" text,
	"linked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "conflict_reminders_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conflict_id" uuid NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"resend_message_id" text
);
--> statement-breakpoint
ALTER TABLE "conflicts" ADD COLUMN "email_message_id" text;--> statement-breakpoint
ALTER TABLE "conflicts" ADD COLUMN "last_reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "conflicts" ADD COLUMN "is_ad_hoc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "total_hours_per_week" real;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "hours_utilization_pct" real;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "hours_load_tag" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "hours_per_week" real;--> statement-breakpoint
ALTER TABLE "ad_hoc_projects" ADD CONSTRAINT "ad_hoc_projects_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_reminders_sent" ADD CONSTRAINT "conflict_reminders_sent_conflict_id_conflicts_id_fk" FOREIGN KEY ("conflict_id") REFERENCES "public"."conflicts"("id") ON DELETE no action ON UPDATE no action;