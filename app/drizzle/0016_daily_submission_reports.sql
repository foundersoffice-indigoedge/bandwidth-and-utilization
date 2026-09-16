-- Additive delivery log. Stores one immutable report per system and IST date.
CREATE TABLE IF NOT EXISTS daily_submission_reports (
  report_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  message_id text
);
