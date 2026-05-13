-- Director sign-off table
CREATE TABLE director_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  director_fellow_id text NOT NULL,
  director_email text NOT NULL,
  director_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('email_sent','confirmed','flagged','flagged_resolved')),
  signoff_token text NOT NULL UNIQUE,
  email_message_id text,
  last_reminder_sent_at timestamp,
  confirmed_at timestamp,
  confirmed_by text,
  flagged_at timestamp,
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, director_fellow_id)
);

-- Conflicts table extensions
ALTER TABLE conflicts
  ADD COLUMN source text NOT NULL DEFAULT 'submission',
  ADD COLUMN flagged_submission_id uuid REFERENCES submissions(id),
  ADD COLUMN flagged_by_fellow_id text,
  ADD COLUMN flagged_original_hours_per_day real,
  ADD COLUMN proposed_hours_per_day real,
  ADD COLUMN director_comment text,
  ADD COLUMN signoff_id uuid REFERENCES director_signoffs(id),
  ADD COLUMN resolver_fellow_id text,
  ADD COLUMN resolver_email text;

ALTER TABLE conflicts ALTER COLUMN vp_submission_id DROP NOT NULL;
ALTER TABLE conflicts ALTER COLUMN associate_submission_id DROP NOT NULL;
ALTER TABLE conflicts ALTER COLUMN vp_hours_per_day DROP NOT NULL;
ALTER TABLE conflicts ALTER COLUMN associate_hours_per_day DROP NOT NULL;
ALTER TABLE conflicts ALTER COLUMN difference DROP NOT NULL;
