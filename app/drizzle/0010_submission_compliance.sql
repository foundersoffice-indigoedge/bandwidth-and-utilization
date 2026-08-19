ALTER TABLE "cycles"
ADD COLUMN IF NOT EXISTS "is_test" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "cycles"
ADD COLUMN IF NOT EXISTS "compliance_report_claimed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "cycles"
ADD COLUMN IF NOT EXISTS "compliance_report_sent_at" timestamp;
--> statement-breakpoint
ALTER TABLE "cycles"
ADD COLUMN IF NOT EXISTS "compliance_report_message_id" text;
--> statement-breakpoint
ALTER TABLE "tokens"
ADD COLUMN IF NOT EXISTS "not_needed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "tokens"
ADD COLUMN IF NOT EXISTS "status_updated_at" timestamp NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submission_deadline_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_id" uuid NOT NULL,
  "cycle_id" uuid NOT NULL,
  "cycle_start_date" date NOT NULL,
  "fellow_record_id" text NOT NULL,
  "fellow_name" text NOT NULL,
  "fellow_designation" text NOT NULL,
  "outcome" text NOT NULL,
  "deadline_at" timestamp NOT NULL,
  "submitted_at" timestamp,
  "checked_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "submission_deadline_checks_token_id_unique" UNIQUE("token_id"),
  CONSTRAINT "submission_deadline_checks_outcome_check" CHECK ("outcome" IN ('on_time', 'missed'))
);
--> statement-breakpoint
ALTER TABLE "submission_deadline_checks"
ADD CONSTRAINT "submission_deadline_checks_token_id_tokens_id_fk"
FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "submission_deadline_checks"
ADD CONSTRAINT "submission_deadline_checks_cycle_id_cycles_id_fk"
FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submission_deadline_checks_fellow_date_idx"
ON "submission_deadline_checks" USING btree ("fellow_record_id", "cycle_start_date");
