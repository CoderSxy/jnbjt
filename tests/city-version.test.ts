import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/plugins/auth.js';
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

describe('city version conflicts', () => {
  it('returns 409 when expectedVersion is stale', async () => {
    await withTestPool(async (pool) => {
      const userId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, username, password_hash, role)
         VALUES ($1, $2, $3, 'user')`,
        [userId, 'versioner', hashPassword('pw')],
      );
    });

    const app = await buildApp({ databaseUrl: testDatabaseUrl() });
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' },
        payload: { username: 'versioner', password: 'pw' },
      });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const created = await app.inject({
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
      const city = (created.json() as { city: { id: string; version: number; state: { inventory: Record<string, number> } } }).city;

      const first = await app.inject({
        method: 'PUT',
        url: `/api/v1/cities/${city.id}`,
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
        payload: {
          expectedVersion: city.version,
          state: { ...city.state, inventory: { 粮食: 9 } },
        },
      });
      expect(first.statusCode).toBe(200);

      const stale = await app.inject({
        method: 'PUT',
        url: `/api/v1/cities/${city.id}`,
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
        payload: {
          expectedVersion: city.version,
          state: { ...city.state, inventory: { 粮食: 99 } },
        },
      });
      expect(stale.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
});
