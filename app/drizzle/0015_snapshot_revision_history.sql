CREATE TABLE IF NOT EXISTS "snapshot_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snapshot_id" uuid NOT NULL REFERENCES "snapshots"("id"),
  "reason" text NOT NULL,
  "old_project_breakdown" jsonb NOT NULL,
  "old_total_hours_per_week" real,
  "old_hours_utilization_pct" real,
  "old_hours_load_tag" text,
  "old_excluded_project_count" integer NOT NULL,
  "new_project_breakdown" jsonb NOT NULL,
  "new_total_hours_per_week" real NOT NULL,
  "new_hours_utilization_pct" real NOT NULL,
  "new_hours_load_tag" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "snapshot_revisions_snapshot_reason_unique"
  ON "snapshot_revisions" ("snapshot_id", "reason");
