-- Assistant production plan drafts (confirm before writing city archive)

CREATE TABLE IF NOT EXISTS plan_drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id TEXT NOT NULL REFERENCES player_cities(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_review', 'applied', 'rejected')),
  question TEXT NOT NULL,
  city_version_at_create INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS plan_drafts_job_id_unique ON plan_drafts(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS plan_drafts_user_city_status ON plan_drafts(user_id, city_id, status);
