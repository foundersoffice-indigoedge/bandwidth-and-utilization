ALTER TABLE pending_projects ADD COLUMN IF NOT EXISTS processing_claim_id text;
ALTER TABLE pending_projects ADD COLUMN IF NOT EXISTS processing_claimed_at timestamp;
ALTER TABLE pending_projects ADD COLUMN IF NOT EXISTS processing_step text;
ALTER TABLE pending_projects ADD COLUMN IF NOT EXISTS processing_progress jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE pending_projects ADD COLUMN IF NOT EXISTS processing_error text;
ALTER TABLE pending_projects ADD COLUMN IF NOT EXISTS processing_updated_at timestamp;
CREATE INDEX IF NOT EXISTS pending_projects_unresolved_processing_idx ON pending_projects(status, processing_claimed_at) WHERE status <> 'finished';
