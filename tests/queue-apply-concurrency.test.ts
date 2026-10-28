import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { enqueueJob, claimNextJob, cancelJob, getJobForUser, QueueLimitError } from '../apps/api/src/modules/jobs/repository.js';
import { applyRecognition } from '../apps/api/src/modules/imports/apply.js';
import { createCity, getCity } from '../apps/api/src/modules/cities/repository.js';
import { testDatabaseUrl, withTestPool } from './helpers/db.js';

const schema = `queue_apply_${randomUUID().replaceAll('-', '')}`;
let isolatedDatabaseUrl: string;

beforeAll(async () => {
  const url = new URL(testDatabaseUrl());
  url.searchParams.set('options', `-c search_path=${schema},public`);
  isolatedDatabaseUrl = url.toString();
  await withTestPool(async (pool) => {
    await pool.query(`CREATE SCHEMA ${schema}`);
  });
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: isolatedDatabaseUrl }, stdio: 'pipe',
  });
});

afterAll(async () => {
  await withTestPool(async (pool) => {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });
});

async function withUser(run: (pool: pg.Pool, userId: string) => Promise<void>) {
  const pool = new pg.Pool({ connectionString: isolatedDatabaseUrl, max: 3 });
  try {
    const userId = randomUUID();
    await pool.query(`INSERT INTO users (id, username, password_hash, role) VALUES ($1, $1, 'unused', 'user')`, [userId]);
    try { await run(pool, userId); }
    finally { await pool.query('DELETE FROM users WHERE id = $1', [userId]); }
  } finally { await pool.end(); }
}

// A database lock holds both operations at their write boundary. With correct
// serialization the second operation instead waits on the first operation's lock.
async function race<T>(table: 'jobs' | 'recognition_drafts', operations: ((pool: pg.Pool) => Promise<T>)[], stagger = false) {
  const name = `race_${randomUUID()}`;
  const pool = new pg.Pool({ connectionString: isolatedDatabaseUrl, application_name: name, max: 3, statement_timeout: 10_000 });
  const blocker = new pg.Client({ connectionString: isolatedDatabaseUrl });
  await blocker.connect();
  await blocker.query('BEGIN');
  await blocker.query(`LOCK TABLE ${table} IN SHARE MODE`);
  const first = operations[0]!(pool);
  // Attach rejection handling immediately while the first write is blocked.
  const pending = [first];
  let outcomes = Promise.allSettled(pending);
  let launched = !stagger;
  if (launched) outcomes = Promise.allSettled([first, ...operations.slice(1).map((operation) => operation(pool))]);
  try {
    const deadline = Date.now() + 5_000;
    let waiting = 0;
    while (Date.now() < deadline) {
      await blocker.query('SELECT pg_stat_clear_snapshot()');
      const result = await blocker.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'`, [name],
      );
      waiting = Number(result.rows[0]!.n);
      if (!launched && waiting === 1) {
        launched = true;
        outcomes = Promise.allSettled([first, ...operations.slice(1).map((operation) => operation(pool))]);
      }
      if (launched && waiting === operations.length) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting, 'all competing database operations reached the barrier').toBe(operations.length);
  } finally {
    await blocker.query('ROLLBACK');
    await blocker.end();
    await outcomes;
    await pool.end();
  }
  return outcomes;
}

it('parallel enqueues with the same key return the same original job', async () => {
  await withUser(async (_pool, userId) => {
    const results = await race('jobs', [0, 1].map(() => (pool: pg.Pool) =>
      enqueueJob(pool, userId, 'same', { kind: 'assistant', question: 'hello' })));
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const ids = results.flatMap((result) => result.status === 'fulfilled' ? [result.value.id] : []);
    expect(new Set(ids).size).toBe(1);
  });
});

it('parallel enqueues cannot exceed a user queue limit', async () => {
  await withUser(async (pool, userId) => {
    for (let i = 0; i < 9; i++) await enqueueJob(pool, userId, `seed-${i}`, { kind: 'assistant', question: 'hello' });
    const results = await race('jobs', [0, 1].map((i) => (racingPool: pg.Pool) =>
      enqueueJob(racingPool, userId, `race-${i}`, { kind: 'assistant', question: 'hello' })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: expect.any(QueueLimitError) });
    expect((await pool.query('SELECT count(*)::int AS n FROM jobs WHERE user_id = $1', [userId])).rows[0].n).toBe(10);
  });
});

it('simultaneous workers claim at most one job globally', async () => {
  await withUser(async (pool, userId) => {
    for (let i = 0; i < 2; i++) await enqueueJob(pool, userId, `worker-${i}`, { kind: 'assistant', question: 'hello' });
    const results = await race('jobs', [0, 1].map((i) => (racingPool: pg.Pool) => claimNextJob(racingPool, `worker-${i}`)));
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(results.filter((result) => result.status === 'fulfilled' && result.value !== null)).toHaveLength(1);
    expect((await pool.query(`SELECT count(*)::int AS n FROM jobs WHERE status = 'running' AND lease_expires_at > now()`)).rows[0].n).toBe(1);
  });
});

async function draftFixture(pool: pg.Pool, userId: string) {
  const city = await createCity(pool, userId, 'yingtian', '应天府', {
    prefectLevel: 1, unlockedAreas: [], inventory: { 粮食: 1 }, buildings: [], workersAvailable: 1,
  });
  const uploadId = randomUUID();
  const draftId = randomUUID();
  await pool.query(`INSERT INTO uploads (id, user_id, content_hash, mime, byte_size, storage_path) VALUES ($1, $2, $1, 'image/png', 1, 'unused')`, [uploadId, userId]);
  await pool.query(`INSERT INTO recognition_drafts (id, user_id, upload_id, city_id, status) VALUES ($1, $2, $3, $4, 'pending_review')`, [draftId, userId, uploadId, city.id]);
  return { city, draftId };
}

const corrections = { fields: [{ path: 'inventory.粮食', value: 42, raw: '42', status: 'known' as const }] };

it('rolls back the city if persisting the applied draft fails', async () => {
  await withUser(async (pool, userId) => {
    const { city, draftId } = await draftFixture(pool, userId);
    const functionName = `fail_apply_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${draftId}' THEN RAISE EXCEPTION 'draft persistence failed'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${functionName} BEFORE UPDATE ON recognition_drafts FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      await expect(applyRecognition(pool, userId, draftId, 1, corrections)).rejects.toThrow('draft persistence failed');
      const unchanged = await getCity(pool, userId, city.id);
      expect(unchanged?.version).toBe(1);
      expect(unchanged?.state.inventory['粮食']).toBe(1);
      expect((await pool.query('SELECT status FROM recognition_drafts WHERE id = $1', [draftId])).rows[0].status).toBe('pending_review');
    } finally {
      await pool.query(`DROP TRIGGER ${functionName} ON recognition_drafts`);
      await pool.query(`DROP FUNCTION ${functionName}()`);
    }
  });
});

it('a concurrent reapply cannot apply a pending draft twice with successive city versions', async () => {
  await withUser(async (pool, userId) => {
    const { city, draftId } = await draftFixture(pool, userId);
    const results = await race('recognition_drafts', [1, 2].map((version) => (racingPool: pg.Pool) =>
      applyRecognition(racingPool, userId, draftId, version, corrections)), true);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getCity(pool, userId, city.id))?.version).toBe(2);
    expect((await pool.query('SELECT status FROM recognition_drafts WHERE id = $1', [draftId])).rows[0].status).toBe('applied');
  });
});

it.each([
  { path: 'inventory.粮食', value: -1 },
  { path: 'inventory.粮食', value: 1.5 },
  { path: 'inventory.粮食', value: Number.MAX_SAFE_INTEGER + 1 },
  { path: 'inventory.粮食', value: '-1' },
  { path: 'inventory.粮食', value: 'not-a-number' },
  { path: 'inventory.', value: 2 },
  { path: 'inventory.a.b', value: 2 },
  { path: 'inventory.a b', value: 2 },
  { path: `inventory.${'a'.repeat(65)}`, value: 2 },
  { path: 'workersAvailable', value: 2 },
])('rejects invalid inventory correction $path = $value without changing city or draft', async (field) => {
  await withUser(async (pool, userId) => {
    const { city, draftId } = await draftFixture(pool, userId);
    await expect(applyRecognition(pool, userId, draftId, 1, {
      fields: [{ ...field, raw: String(field.value), status: 'known' }],
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await getCity(pool, userId, city.id))?.version).toBe(1);
    expect((await pool.query('SELECT status FROM recognition_drafts WHERE id = $1', [draftId])).rows[0].status).toBe('pending_review');
  });
});

it('rejects malformed correction fields without changing city', async () => {
  await withUser(async (pool, userId) => {
    const { city, draftId } = await draftFixture(pool, userId);
    await expect(applyRecognition(pool, userId, draftId, 1, { fields: [null] } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await getCity(pool, userId, city.id))?.version).toBe(1);
  });
});

async function linkDraftJob(pool: pg.Pool, userId: string, draftId: string, status: string) {
  const job = await enqueueJob(pool, userId, randomUUID(), { kind: 'assistant', question: 'recognition fixture' });
  await pool.query('UPDATE jobs SET status = $2 WHERE id = $1', [job.id, status]);
  await pool.query('UPDATE recognition_drafts SET job_id = $2 WHERE id = $1', [draftId, job.id]);
  return job;
}

it('cancelling a running job removes its persisted pending draft', async () => {
  await withUser(async (pool, userId) => {
    const { draftId } = await draftFixture(pool, userId);
    const job = await linkDraftJob(pool, userId, draftId, 'running');
    expect((await cancelJob(pool, userId, job.id))?.status).toBe('cancelled');
    expect((await pool.query('SELECT id FROM recognition_drafts WHERE id = $1', [draftId])).rowCount).toBe(0);
  });
});

it('cancellation rolls back the job status if draft removal fails', async () => {
  await withUser(async (pool, userId) => {
    const { draftId } = await draftFixture(pool, userId);
    const job = await linkDraftJob(pool, userId, draftId, 'running');
    const functionName = `fail_cancel_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'draft removal failed'; END $$`);
    await pool.query(`CREATE TRIGGER ${functionName} BEFORE DELETE ON recognition_drafts FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    try {
      await expect(cancelJob(pool, userId, job.id)).rejects.toThrow('draft removal failed');
      expect((await getJobForUser(pool, userId, job.id))?.status).toBe('running');
      expect((await pool.query('SELECT id FROM recognition_drafts WHERE id = $1', [draftId])).rowCount).toBe(1);
    } finally {
      await pool.query(`DROP TRIGGER ${functionName} ON recognition_drafts`);
      await pool.query(`DROP FUNCTION ${functionName}()`);
    }
  });
});

it.each(['queued', 'running', 'cancelled', 'failed'])('a draft linked to a %s job cannot be applied', async (status) => {
  await withUser(async (pool, userId) => {
    const { city, draftId } = await draftFixture(pool, userId);
    await linkDraftJob(pool, userId, draftId, status);
    await expect(applyRecognition(pool, userId, draftId, 1, corrections)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await getCity(pool, userId, city.id))?.version).toBe(1);
    expect((await pool.query('SELECT status FROM recognition_drafts WHERE id = $1', [draftId])).rows[0].status).toBe('pending_review');
  });
});

it('a succeeded job cannot be cancelled and its pending draft remains applicable', async () => {
  await withUser(async (pool, userId) => {
    const { draftId } = await draftFixture(pool, userId);
    const job = await linkDraftJob(pool, userId, draftId, 'succeeded');
    expect(await cancelJob(pool, userId, job.id)).toBeNull();
    expect((await applyRecognition(pool, userId, draftId, 1, corrections)).version).toBe(2);
  });
});
