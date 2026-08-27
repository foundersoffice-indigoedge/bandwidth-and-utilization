ALTER TABLE "conflicts"
ADD COLUMN IF NOT EXISTS "email_sent_at" timestamp;
--> statement-breakpoint
UPDATE "conflicts"
SET "email_sent_at" = now()
WHERE "email_message_id" IS NOT NULL
  AND "email_sent_at" IS NULL;
