import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Layout } from '@jnbjt/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/plugins/auth.js';
import { resetPlayerTables, testDatabaseUrl, withTestPool } from './helpers/db.js';

beforeAll(async () => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
  await withTestPool(async (pool) => resetPlayerTables(pool));
});

describe('layout roundtrip', () => {
  it('saves and reloads layout; stale version returns 409', async () => {
    const username = `layout_${Date.now()}`;
    await withTestPool(async (pool) => {
      await pool.query(
        `INSERT INTO users (id, username, password_hash, role) VALUES ($1,$2,$3,'user')`,
        [randomUUID(), username, hashPassword('pw')],
      );
    });

    const app = await buildApp({ databaseUrl: testDatabaseUrl() });
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' },
        payload: { username, password: 'pw' },
      });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
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
            inventory: {},
            buildings: [],
            workersAvailable: 1,
          },
        },
      });
      const cityId = (cityRes.json() as { city: { id: string } }).city.id;

      const layout: Layout = {
        schemaVersion: 1,
        knowledgeVersion: null,
        width: 8,
        height: 8,
        buildable: [{ x: 0, y: 0, w: 8, h: 8 }],
        blocked: [],
        roads: [{ x: 0, y: 3, w: 8, h: 1 }],
        buildings: [
          { id: 'farm1', typeName: '农田', x: 1, y: 2, w: 2, h: 1, rotation: 0, locked: false },
        ],
        customBasemap: true,
        notes: '练习地图',
      };

      const missingBase = await app.inject({
        method: 'PUT', url: `/api/v1/cities/${cityId}/layout`,
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
        payload: { expectedVersion: 9, layout },
      });
      expect(missingBase.statusCode).toBe(409);

      const saved = await app.inject({
        method: 'PUT',
        url: `/api/v1/cities/${cityId}/layout`,
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
        payload: { expectedVersion: null, layout },
      });
      expect(saved.statusCode).toBe(200);
      const version = (saved.json() as { layout: { version: number } }).layout.version;

      const loaded = await app.inject({
        method: 'GET',
        url: `/api/v1/cities/${cityId}/layout`,
        headers: { cookie },
      });
      expect(loaded.statusCode).toBe(200);
      expect((loaded.json() as { layout: { layout: Layout } }).layout.layout.buildings[0]?.x).toBe(1);

      const conflict = await app.inject({
        method: 'PUT',
        url: `/api/v1/cities/${cityId}/layout`,
        headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100', cookie },
        payload: { expectedVersion: version - 1, layout },
      });
      expect(conflict.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
});
