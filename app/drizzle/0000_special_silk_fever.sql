CREATE TABLE "conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"project_record_id" text NOT NULL,
	"vp_submission_id" uuid NOT NULL,
	"associate_submission_id" uuid NOT NULL,
	"vp_hours_per_day" real NOT NULL,
	"associate_hours_per_day" real NOT NULL,
	"difference" real NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_hours_per_day" real,
	"resolved_by" text,
	"resolution_token" text
);
--> statement-breakpoint
CREATE TABLE "cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"start_date" date NOT NULL,
	"status" text DEFAULT 'collecting' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"fellow_record_id" text NOT NULL,
	"fellow_name" text NOT NULL,
	"designation" text NOT NULL,
	"capacity_meu" real NOT NULL,
	"total_meu" real NOT NULL,
	"utilization_pct" real NOT NULL,
	"load_tag" text NOT NULL,
	"project_breakdown" jsonb NOT NULL,
	"snapshot_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"fellow_record_id" text NOT NULL,
	"project_record_id" text NOT NULL,
	"project_name" text NOT NULL,
	"project_type" text NOT NULL,
	"hours_value" real NOT NULL,
	"hours_unit" text NOT NULL,
	"hours_per_day" real NOT NULL,
	"auto_score" integer NOT NULL,
	"auto_meu" real NOT NULL,
	"is_self_report" boolean NOT NULL,
	"target_fellow_id" text,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"fellow_record_id" text NOT NULL,
	"fellow_name" text NOT NULL,
	"fellow_email" text NOT NULL,
	"fellow_designation" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp,
	CONSTRAINT "tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_vp_submission_id_submissions_id_fk" FOREIGN KEY ("vp_submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_associate_submission_id_submissions_id_fk" FOREIGN KEY ("associate_submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;