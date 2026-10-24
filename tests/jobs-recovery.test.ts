import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/plugins/auth.js';
import {
  GLOBAL_CONCURRENCY,
  MAX_QUEUE_PER_USER,
  cancelJob,
  claimNextJob,
  completeJob,
  countRunning,
  enqueueJob,
  getJobForUser,
  renewLease,
} from '../apps/api/src/modules/jobs/repository.js';
import { registerJobHandler, runJob } from '../apps/api/src/modules/jobs/runner.js';
import { resetPlayerTables, testDatabaseUrl, withTestPool } from './helpers/db.js';

beforeAll(async () => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
  await withTestPool(async (pool) => {
    await resetPlayerTables(pool);
  });
});

async function seedUser(username: string) {
  return withTestPool(async (pool) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role) VALUES ($1,$2,$3,'user')`,
      [id, username, hashPassword('pw')],
    );
    return id;
  });
}

describe('jobs recovery and limits', () => {
  it('enforces concurrency 1, queue 10, idempotency, lease recovery, cancel, and isolation', async () => {
    const userId = await seedUser(`jobs_${Date.now()}`);
    const otherId = await seedUser(`jobs_other_${Date.now()}`);

    await withTestPool(async (pool) => {
      const first = await enqueueJob(pool, userId, 'same-key', {
        kind: 'assistant',
        question: 'hello',
      });
      const again = await enqueueJob(pool, userId, 'same-key', {
        kind: 'assistant',
        question: 'different',
      });
      expect(again.id).toBe(first.id);
      expect(again.input).toEqual(first.input);

      for (let i = 0; i < MAX_QUEUE_PER_USER - 1; i += 1) {
        await enqueueJob(pool, userId, `k-${i}`, { kind: 'assistant', question: `q${i}` });
      }
      await expect(
        enqueueJob(pool, userId, 'overflow', { kind: 'assistant', question: 'nope' }),
      ).rejects.toThrow(/queue limit/i);

      const w1 = await claimNextJob(pool, 'worker-a');
      expect(w1).toBeTruthy();
      expect(await countRunning(pool)).toBe(GLOBAL_CONCURRENCY);
      const w2 = await claimNextJob(pool, 'worker-b');
      expect(w2).toBeNull();

      expect(await renewLease(pool, w1!.id, 'worker-a')).toBe(true);

      // expire lease
      await pool.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [
        w1!.id,
      ]);
      const recovered = await claimNextJob(pool, 'worker-c');
      expect(recovered?.id).toBe(w1!.id);
      expect(recovered?.attempts).toBeGreaterThan(w1!.attempts);

      await cancelJob(pool, userId, recovered!.id);
      const cancelledComplete = await completeJob(pool, recovered!.id, 'worker-c', {
        ok: true,
        data: { shouldNotPersist: true },
      });
      expect(cancelledComplete).toBeNull();
      const afterCancel = await getJobForUser(pool, userId, recovered!.id);
      expect(afterCancel?.status).toBe('cancelled');
      expect(afterCancel?.result).toBeUndefined();

      const foreign = await getJobForUser(pool, otherId, first.id);
      expect(foreign).toBeNull();

      registerJobHandler('assistant', async () => ({ ok: true, data: { answer: 'ok' } }));
      const next = await claimNextJob(pool, 'worker-d');
      expect(next).toBeTruthy();
      const result = await runJob(next!, new AbortController().signal);
      expect(result.ok).toBe(true);
      const done = await completeJob(pool, next!.id, 'worker-d', result);
      expect(done?.status).toBe('succeeded');
    });

    const app = await buildApp({ databaseUrl: testDatabaseUrl() });
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' },
        payload: { username: `missing_${Date.now()}`, password: 'pw' },
      });
      // cross-user via API: create user and try reading other job — covered above at repo layer
      expect(login.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
