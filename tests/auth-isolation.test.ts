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

async function seedUser(username: string, password: string) {
  return withTestPool(async (pool) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role) VALUES ($1,$2,$3,'user')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [id, username, hashPassword(password)],
    );
    const row = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [
      username,
    ]);
    return row.rows[0]!.id;
  });
}

describe('auth isolation', () => {
  it('returns 401 when unauthenticated and never leaks password hashes', async () => {
    await seedUser('alice', 'secret-alice');
    const app = await buildApp({ databaseUrl: testDatabaseUrl() });
    try {
      const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(me.statusCode).toBe(401);

      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' },
        payload: { username: 'alice', password: 'secret-alice' },
      });
      expect(login.statusCode).toBe(200);
      const body = login.json() as { user: Record<string, unknown> };
      expect(body.user.password_hash).toBeUndefined();
      expect(body.user.password).toBeUndefined();
      expect(JSON.stringify(body)).not.toMatch(/scrypt\$/);

      const setCookie = login.headers['set-cookie'];
      expect(String(setCookie)).toMatch(/HttpOnly/i);
      expect(String(setCookie)).not.toMatch(/Domain=/i);
    } finally {
      await app.close();
    }
  });

  it('rejects CSRF on write and hides other users cities as 404', async () => {
    const aliceId = await seedUser('alice2', 'secret-alice');
    const bobId = await seedUser('bob2', 'secret-bob');
    const app = await buildApp({ databaseUrl: testDatabaseUrl() });
    try {
      const badOrigin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'https://evil.example', host: '127.0.0.1:3100' },
        payload: { username: 'alice2', password: 'secret-alice' },
      });
      expect(badOrigin.statusCode).toBe(403);

      const aliceLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' },
        payload: { username: 'alice2', password: 'secret-alice' },
      });
      const aliceCookie = String(aliceLogin.headers['set-cookie']).split(';')[0]!;

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/cities',
        headers: {
          origin: 'http://127.0.0.1:3100',
          host: '127.0.0.1:3100',
          cookie: aliceCookie,
        },
        payload: {
          cityKey: 'yingtian',
          displayName: '应天府',
          state: {
            prefectLevel: 3,
            unlockedAreas: ['a'],
            inventory: { 粮食: 10 },
            buildings: [],
            workersAvailable: 2,
          },
        },
      });
      expect(created.statusCode).toBe(201);
      const cityId = (created.json() as { city: { id: string } }).city.id;

      const bobLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' },
        payload: { username: 'bob2', password: 'secret-bob' },
      });
      const bobCookie = String(bobLogin.headers['set-cookie']).split(';')[0]!;
      const cross = await app.inject({
        method: 'GET',
        url: `/api/v1/cities/${cityId}`,
        headers: { cookie: bobCookie },
      });
      expect(cross.statusCode).toBe(404);
      expect(aliceId).not.toBe(bobId);
    } finally {
      await app.close();
    }
  });
});
