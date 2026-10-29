import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { buildApp } from '../apps/api/src/app.js';
import {
  validatePassword,
  validatePasswordPolicy,
  validateUsername,
} from '../apps/api/src/modules/auth/password-policy.js';
import { hasTestDatabase, resetPlayerTables, testDatabaseUrl, withTestPool } from './helpers/db.js';

describe('password policy', () => {
  it('validates username and password rules', () => {
    expect(validateUsername('ab')).toMatchObject({ ok: false });
    expect(validateUsername('sms_bot')).toMatchObject({ ok: false });
    expect(validateUsername('good_user')).toMatchObject({ ok: true });
    expect(validatePassword('short')).toMatchObject({ ok: false });
    expect(validatePasswordPolicy('good_user', 'good_user123456')).toMatchObject({ ok: true });
  });
});

describe.skipIf(!hasTestDatabase())('password auth integration', () => {
  beforeAll(() => {
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl(), NODE_ENV: 'test' },
      stdio: 'pipe',
    });
  });

  const headers = { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' };

  it('registers and logs in with same session stack', async () => {
    await withTestPool(async (pool) => {
      await resetPlayerTables(pool);
    });
    const app = await buildApp({ databaseUrl: testDatabaseUrl() });
    try {
      const reg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers,
        payload: { username: 'planner1', password: 'securepass1', displayName: '规划者' },
      });
      expect(reg.statusCode).toBe(200);
      expect(reg.headers['set-cookie']).toBeTruthy();

      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers,
        payload: { username: 'planner1', password: 'securepass1' },
      });
      expect(login.statusCode).toBe(200);

      const bad = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers,
        payload: { username: 'planner1', password: 'wrongpass' },
      });
      expect(bad.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
