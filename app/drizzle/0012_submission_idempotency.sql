CREATE UNIQUE INDEX IF NOT EXISTS "submissions_self_report_identity_unique"
  ON "submissions" ("cycle_id", "fellow_record_id", "project_record_id")
  WHERE "is_self_report" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "submissions_projection_identity_unique"
  ON "submissions" ("cycle_id", "fellow_record_id", "project_record_id", "target_fellow_id")
  WHERE "is_self_report" = false AND "target_fellow_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conflicts_submission_pair_unique"
  ON "conflicts" ("cycle_id", "project_record_id", "vp_submission_id", "associate_submission_id")
  WHERE "source" = 'submission'
    AND "vp_submission_id" IS NOT NULL
    AND "associate_submission_id" IS NOT NULL;
