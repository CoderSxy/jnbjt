import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Job, JobInput, JobResult } from '@jnbjt/contracts';

export const MAX_QUEUE_PER_USER = 10;
export const GLOBAL_CONCURRENCY = 1;
export const LEASE_MS = 15_000;

type JobRow = {
  id: string;
  user_id: string;
  idempotency_key: string;
  kind: Job['kind'];
  status: Job['status'];
  input: JobInput;
  result: unknown;
  error: unknown;
  attempts: number;
  worker_id: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapJob(row: JobRow): Job {
  const job: Job = {
    id: row.id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    status: row.status,
    input: row.input,
    attempts: row.attempts,
    workerId: row.worker_id,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.result != null) job.result = row.result;
  if (row.error != null) job.error = row.error;
  return job;
}

export class QueueLimitError extends Error {
  constructor() {
    super('job queue limit exceeded');
    this.name = 'QueueLimitError';
  }
}

export async function enqueueJob(
  pool: Pool,
  userId: string,
  key: string,
  input: JobInput,
): Promise<Job> {
  const existing = await pool.query<JobRow>(
    `SELECT id, user_id, idempotency_key, kind, status, input, result, error, attempts,
            worker_id, lease_expires_at::text, created_at::text, updated_at::text
     FROM jobs WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, key],
  );
  if (existing.rows[0]) return mapJob(existing.rows[0]);

  const queued = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM jobs
     WHERE user_id = $1 AND status IN ('queued', 'running')`,
    [userId],
  );
  if (Number(queued.rows[0]!.n) >= MAX_QUEUE_PER_USER) {
    throw new QueueLimitError();
  }

  const id = randomUUID();
  const result = await pool.query<JobRow>(
    `INSERT INTO jobs (id, user_id, idempotency_key, kind, status, input)
     VALUES ($1, $2, $3, $4, 'queued', $5::jsonb)
     RETURNING id, user_id, idempotency_key, kind, status, input, result, error, attempts,
               worker_id, lease_expires_at::text, created_at::text, updated_at::text`,
    [id, userId, key, input.kind, JSON.stringify(input)],
  );
  return mapJob(result.rows[0]!);
}

export async function getJobForUser(
  pool: Pool,
  userId: string,
  jobId: string,
): Promise<Job | null> {
  const result = await pool.query<JobRow>(
    `SELECT id, user_id, idempotency_key, kind, status, input, result, error, attempts,
            worker_id, lease_expires_at::text, created_at::text, updated_at::text
     FROM jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId],
  );
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function cancelJob(
  pool: Pool,
  userId: string,
  jobId: string,
): Promise<Job | null> {
  const result = await pool.query<JobRow>(
    `UPDATE jobs
     SET status = 'cancelled', updated_at = now(), worker_id = NULL, lease_expires_at = NULL
     WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running')
     RETURNING id, user_id, idempotency_key, kind, status, input, result, error, attempts,
               worker_id, lease_expires_at::text, created_at::text, updated_at::text`,
    [jobId, userId],
  );
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function claimNextJob(pool: Pool, workerId: string): Promise<Job | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const running = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM jobs
       WHERE status = 'running' AND lease_expires_at > now()`,
    );
    if (Number(running.rows[0]!.n) >= GLOBAL_CONCURRENCY) {
      await client.query('COMMIT');
      return null;
    }

    // Recover expired leases back to queued
    await client.query(
      `UPDATE jobs
       SET status = 'queued', worker_id = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= now())`,
    );

    const next = await client.query<JobRow>(
      `SELECT id, user_id, idempotency_key, kind, status, input, result, error, attempts,
              worker_id, lease_expires_at::text, created_at::text, updated_at::text
       FROM jobs
       WHERE status = 'queued'
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    const row = next.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }

    const lease = new Date(Date.now() + LEASE_MS).toISOString();
    const claimed = await client.query<JobRow>(
      `UPDATE jobs
       SET status = 'running', worker_id = $2, lease_expires_at = $3,
           attempts = attempts + 1, updated_at = now()
       WHERE id = $1
       RETURNING id, user_id, idempotency_key, kind, status, input, result, error, attempts,
                 worker_id, lease_expires_at::text, created_at::text, updated_at::text`,
      [row.id, workerId, lease],
    );
    await client.query('COMMIT');
    return mapJob(claimed.rows[0]!);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function renewLease(pool: Pool, jobId: string, workerId: string): Promise<boolean> {
  const lease = new Date(Date.now() + LEASE_MS).toISOString();
  const result = await pool.query(
    `UPDATE jobs SET lease_expires_at = $3, updated_at = now()
     WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
    [jobId, workerId, lease],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function completeJob(
  pool: Pool,
  jobId: string,
  workerId: string,
  result: JobResult,
): Promise<Job | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ status: string }>(
      `SELECT status FROM jobs WHERE id = $1 FOR UPDATE`,
      [jobId],
    );
    const status = current.rows[0]?.status;
    if (!status || status === 'cancelled') {
      // cancelled: do not persist result
      await client.query('COMMIT');
      return null;
    }
    if (status !== 'running') {
      await client.query('COMMIT');
      return null;
    }

    const owned = await client.query(
      `SELECT 1 FROM jobs WHERE id = $1 AND worker_id = $2`,
      [jobId, workerId],
    );
    if ((owned.rowCount ?? 0) === 0) {
      await client.query('COMMIT');
      return null;
    }

    const updated = await client.query<JobRow>(
      `UPDATE jobs
       SET status = $3, result = $4::jsonb, error = $5::jsonb,
           worker_id = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND worker_id = $2
       RETURNING id, user_id, idempotency_key, kind, status, input, result, error, attempts,
                 worker_id, lease_expires_at::text, created_at::text, updated_at::text`,
      [
        jobId,
        workerId,
        result.ok ? 'succeeded' : 'failed',
        JSON.stringify(result.data ?? null),
        JSON.stringify(result.error ?? null),
      ],
    );
    await client.query('COMMIT');
    return updated.rows[0] ? mapJob(updated.rows[0]) : null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function countRunning(pool: Pool | PoolClient): Promise<number> {
  const result = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM jobs
     WHERE status = 'running' AND lease_expires_at > now()`,
  );
  return Number(result.rows[0]!.n);
}
