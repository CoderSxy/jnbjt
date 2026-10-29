CREATE TABLE IF NOT EXISTS auth_login_failures (
  bucket TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS auth_login_failures_locked_idx ON auth_login_failures (locked_until);
