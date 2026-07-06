ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "remarks_claimed_at" timestamp;
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "remarks_processed_at" timestamp;
