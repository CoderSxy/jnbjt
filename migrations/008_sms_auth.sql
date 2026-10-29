-- Phone + SMS verification login (planner accounts)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users (phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS sms_verification_codes (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'register')),
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  send_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sms_verification_codes_phone_created_idx
  ON sms_verification_codes (phone, created_at DESC);
