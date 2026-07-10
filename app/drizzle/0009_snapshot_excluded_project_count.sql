ALTER TABLE "snapshots"
ADD COLUMN IF NOT EXISTS "excluded_project_count" integer NOT NULL DEFAULT 0;
