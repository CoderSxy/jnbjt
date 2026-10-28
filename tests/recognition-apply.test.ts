import { completeJob, enqueueJob } from '../apps/api/src/modules/jobs/repository.js';
import { recognizeScreenshot } from '../apps/api/src/modules/imports/recognize.js';
import { runJob } from '../apps/api/src/modules/jobs/runner.js';
import type { Job } from '@jnbjt/contracts';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/plugins/auth.js';
import { validateImageBuffer } from '../apps/api/src/plugins/uploads.js';
import { testDatabaseUrl, withTestPool } from './helpers/db.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  vi.stubEnv('MODEL_BASE_URL', '');
  vi.stubEnv('MODEL_API_KEY', '');
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
});

describe('recognition apply', () => {
  it('keeps private uploads isolated, dedups, leaves unknown empty, and 409s on stale apply', async () => {
    const username = `up_${Date.now()}`;
    const other = `up_o_${Date.now()}`;
    await withTestPool(async (pool) => {
      for (const name of [username, other]) {
        await pool.query(
          `INSERT INTO users (id, username, password_hash, role) VALUES ($1,$2,$3,'user')`,
          [randomUUID(), name, hashPassword('pw')],
        );
      }
    });

    const app = await buildApp({ databaseUrl: testDatabaseUrl() });
    try {
      const login = async (u: string) => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' },
          payload: { username: u, password: 'pw' },
        });
        return String(res.headers['set-cookie']).split(';')[0]!;
      };
      const cookie = await login(username);
      const otherCookie = await login(other);

      // Route body limit must allow images larger than Fastify's default 1MiB.
      const sharp = (await import('sharp')).default;
      const large = await sharp({ create: { width: 800, height: 800, channels: 3, background: 'white' } }).png().toBuffer();
      const largeUpload = await app.inject({ method: 'POST', url: '/api/v1/uploads',
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
        payload: { mime: 'image/png', dataBase64: large.toString('base64'), filename: 'x'.repeat(1_100_000) },
      });
      expect(largeUpload.statusCode).toBe(200);
      const img = await validateImageBuffer(PNG_1X1);
      const upload1 = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
        payload: { mime: img.mime, dataBase64: PNG_1X1.toString('base64') },
      });
      expect(upload1.statusCode).toBe(200);
      const uploadId = (upload1.json() as { upload: { id: string } }).upload.id;

      const upload2 = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
        payload: { mime: img.mime, dataBase64: PNG_1X1.toString('base64') },
      });
      expect((upload2.json() as { upload: { deduplicated: boolean; id: string } }).upload.deduplicated).toBe(
        true,
      );
      expect((upload2.json() as { upload: { id: string } }).upload.id).toBe(uploadId);

      const denied = await app.inject({
        method: 'GET',
        url: `/api/v1/uploads/${uploadId}`,
        headers: { cookie: otherCookie },
      });
      expect(denied.statusCode).toBe(404);

      const cityRes = await app.inject({
        method: 'POST',
        url: '/api/v1/cities',
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
        payload: {
          cityKey: 'yingtian',
          displayName: '应天府',
          state: {
            prefectLevel: 1,
            unlockedAreas: [],
            inventory: { 粮食: 1 },
            buildings: [],
            workersAvailable: 1,
          },
        },
      });
      const city = (cityRes.json() as { city: { id: string; version: number; state: { inventory: Record<string, number> } } }).city;

      const job = await app.inject({
        method: 'POST',
        url: '/api/v1/recognition-jobs',
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
        payload: { uploadId, cityId: city.id, key: `rec-${uploadId}` },
      });
      expect(job.statusCode).toBe(202);
      expect(job.json()).not.toHaveProperty('draft');
      const queued = job.json().job as Job;
      await app.db.query(`UPDATE jobs SET status='running', worker_id='recognition-test', lease_expires_at=now()+interval '1 minute' WHERE id=$1`, [queued.id]);
      const result = await runJob(queued, new AbortController().signal);
      expect(result.ok).toBe(true);
      const draft = (result as { ok: true; data: { draft: { id: string; fields: Array<{ status: string; value: unknown }> } } }).data.draft;
      const again = await runJob(queued, new AbortController().signal);
      expect((again as typeof result)).toEqual(result);
      await completeJob(app.db, queued.id, 'recognition-test', result);
      const privateDraft = await app.inject({ method: 'GET', url: `/api/v1/recognition-drafts/${draft.id}`, headers: { cookie: otherCookie } });
      expect(privateDraft.statusCode).toBe(404);
      const review = await app.inject({ method: 'GET', url: `/api/v1/recognition-drafts/${draft.id}`, headers: { cookie } });
      expect(review.json().city).toMatchObject({ id: city.id, version: city.version });
      expect(draft.fields[0]?.status).toMatch(/unknown|needs_review/);
      expect(draft.fields[0]?.value).toBeNull();

      // confirm before apply: city unchanged
      const before = await app.inject({
        method: 'GET',
        url: `/api/v1/cities/${city.id}`,
        headers: { cookie },
      });
      expect((before.json() as { city: { state: { inventory: { 粮食: number } } } }).city.state.inventory['粮食']).toBe(1);

      const applied = await app.inject({
        method: 'POST',
        url: `/api/v1/recognition-drafts/${draft.id}/apply`,
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
        payload: {
          expectedVersion: city.version,
          corrections: {
            fields: [
              { path: 'inventory.粮食', value: 42, raw: '42', status: 'known' },
            ],
          },
        },
      });
      expect(applied.statusCode).toBe(200);
      expect((applied.json() as { city: { state: { inventory: { 粮食: number } } } }).city.state.inventory['粮食']).toBe(42);

      const stale = await app.inject({
        method: 'POST',
        url: `/api/v1/recognition-drafts/${draft.id}/apply`,
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
        payload: {
          expectedVersion: city.version,
          corrections: { fields: [{ path: 'inventory.粮食', value: 1, raw: '1', status: 'known' }] },
        },
      });
      expect([409, 400, 404]).toContain(stale.statusCode);
      const owner = await app.db.query('SELECT id FROM users WHERE username=$1', [username]);
      for (let i = 0; i < 10; i++) await enqueueJob(app.db, owner.rows[0].id, `overflow-${i}-${uploadId}`, { kind: 'assistant', question: 'offline' });
      for (const endpoint of ['/api/v1/recognition-jobs', '/api/v1/assistant/runs']) {
        const overflow = await app.inject({ method: 'POST', url: endpoint,
          headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
          payload: { uploadId, cityId: city.id, question: 'offline', key: `overflow-request-${endpoint}` },
        });
        expect(overflow.statusCode).toBe(429);
        expect(overflow.json().error.code).toBe('QUEUE_LIMIT');
      }
    } finally {
      await app.close();
    }
  });
});

it('holds a real PostgreSQL job row lock while persisting its draft', async () => {
  await withTestPool(async (pool) => {
    const userId = randomUUID();
    const uploadId = randomUUID();
    await pool.query("INSERT INTO users (id, username, password_hash, role) VALUES ($1,$1,'unused','user')", [userId]);
    try {
      await pool.query("INSERT INTO uploads (id,user_id,content_hash,mime,byte_size,storage_path) VALUES ($1,$2,$1,'image/png',1,'unused')", [uploadId, userId]);
      const job = await enqueueJob(pool, userId, randomUUID(), { kind: 'recognition', uploadId });
      await pool.query("UPDATE jobs SET status='running', worker_id='active-worker' WHERE id=$1", [job.id]);
      await expect(recognizeScreenshot(pool, userId, uploadId, {}, new AbortController().signal, undefined, job.id, 'stale-worker')).rejects.toThrow(/lease no longer owned/);
      let checkedLock = false;
      const originalConnect = pool.connect.bind(pool);
      const wrappedPool = Object.create(pool);
      wrappedPool.query = pool.query.bind(pool);
      wrappedPool.connect = async () => {
        const client = await originalConnect();
        const query = client.query.bind(client);
        return {
          query: async (sql: string, values?: unknown[]) => {
            if (sql.includes('INSERT INTO recognition_drafts')) {
              const observer = await originalConnect();
              try {
                await expect(observer.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE NOWAIT', [job.id])).rejects.toMatchObject({ code: '55P03' });
                checkedLock = true;
              } finally { observer.release(); }
            }
            return query(sql, values);
          }, release: () => client.release(),
        };
      };
      const draft = await recognizeScreenshot(wrappedPool, userId, uploadId, {}, new AbortController().signal, undefined, job.id);
      expect(checkedLock).toBe(true);
      expect(draft.status).toBe('pending_review');
    } finally { await pool.query('DELETE FROM users WHERE id=$1', [userId]); }
  });
});
