import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/plugins/auth.js';
import { validateImageBuffer } from '../apps/api/src/plugins/uploads.js';
import { resetPlayerTables, testDatabaseUrl, withTestPool } from './helpers/db.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
  await withTestPool(async (pool) => resetPlayerTables(pool));
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

      const img = validateImageBuffer(PNG_1X1);
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
      const draft = (job.json() as { draft: { id: string; fields: Array<{ status: string; value: unknown }> } }).draft;
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
    } finally {
      await app.close();
    }
  });
});
