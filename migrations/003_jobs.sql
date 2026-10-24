CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('assistant', 'recognition', 'layout')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input JSONB NOT NULL,
  result JSONB,
  error JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS jobs_status_lease_idx ON jobs (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS jobs_user_id_idx ON jobs (user_id);
