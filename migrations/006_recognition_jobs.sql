ALTER TABLE recognition_drafts ADD COLUMN IF NOT EXISTS job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS recognition_drafts_job_id_unique ON recognition_drafts(job_id) WHERE job_id IS NOT NULL;
