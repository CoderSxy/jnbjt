import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

const WINDOW_MINUTES = Number(process.env.AUTH_LOGIN_WINDOW_MINUTES ?? 15);
const MAX_FAILURES = Number(process.env.AUTH_LOGIN_MAX_FAILURES ?? 10);
const LOCK_MINUTES = Number(process.env.AUTH_LOGIN_LOCK_MINUTES ?? 15);

function bucketKey(username: string, ip: string): string {
  return createHash('sha256').update(`${username.toLowerCase()}|${ip}`).digest('hex');
}

export async function checkLoginAllowed(
  pool: Pool,
  username: string,
  ip: string,
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const bucket = bucketKey(username, ip);
  const row = await pool.query<{ locked_until: string | null; failure_count: number }>(
    `SELECT locked_until, failure_count FROM auth_login_failures WHERE bucket = $1`,
    [bucket],
  );
  const lockedUntil = row.rows[0]?.locked_until;
  if (lockedUntil && new Date(lockedUntil) > new Date()) {
    const retryAfterSeconds = Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }
  return { allowed: true };
}

export async function recordLoginFailure(pool: Pool, username: string, ip: string): Promise<void> {
  const bucket = bucketKey(username, ip);
  const existing = await pool.query<{ failure_count: number; window_start: string }>(
    `SELECT failure_count, window_start FROM auth_login_failures WHERE bucket = $1`,
    [bucket],
  );
  const windowStart = existing.rows[0]?.window_start
    ? new Date(existing.rows[0].window_start)
    : null;
  const expired =
    !windowStart || Date.now() - windowStart.getTime() > WINDOW_MINUTES * 60_000;
  let failureCount = expired ? 1 : (existing.rows[0]?.failure_count ?? 0) + 1;
  const newWindowStart = expired ? new Date() : windowStart!;
  let lockedUntil: Date | null = null;
  if (failureCount >= MAX_FAILURES) {
    lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
    failureCount = MAX_FAILURES;
  }
  await pool.query(
    `INSERT INTO auth_login_failures (bucket, failure_count, window_start, locked_until)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (bucket) DO UPDATE SET
       failure_count = EXCLUDED.failure_count,
       window_start = EXCLUDED.window_start,
       locked_until = EXCLUDED.locked_until`,
    [bucket, failureCount, newWindowStart.toISOString(), lockedUntil?.toISOString() ?? null],
  );
}

export async function clearLoginFailures(pool: Pool, username: string, ip: string): Promise<void> {
  await pool.query(`DELETE FROM auth_login_failures WHERE bucket = $1`, [bucketKey(username, ip)]);
}
