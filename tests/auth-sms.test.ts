import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { buildApp } from '../apps/api/src/app.js';
import { normalizePhone } from '../apps/api/src/modules/auth/phone.js';
import { resetSmsProviderForTests } from '../apps/api/src/modules/auth/sms/index.js';
import { hasTestDatabase, resetPlayerTables, testDatabaseUrl, withTestPool } from './helpers/db.js';

describe('phone normalize', () => {
  it('accepts CN 11-digit and +86', () => {
    expect(normalizePhone('13800138000')).toBe('+8613800138000');
    expect(normalizePhone('+8613800138000')).toBe('+8613800138000');
    expect(normalizePhone('123')).toBeNull();
  });
});

describe.skipIf(!hasTestDatabase())('SMS auth integration', () => {
  beforeAll(() => {
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl(), SMS_PROVIDER: 'mock', NODE_ENV: 'test' },
      stdio: 'pipe',
    });
  });

  const headers = { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' };

  it('send-code returns debugCode in test and verify registers + logs in', async () => {
    process.env.SMS_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    resetSmsProviderForTests();
    await withTestPool(async (pool) => {
      await resetPlayerTables(pool);
    });

    const app = await buildApp({ databaseUrl: testDatabaseUrl() });
    try {
      const send = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/sms/send-code',
        headers,
        payload: { phone: '13800138000', purpose: 'login' },
      });
      expect(send.statusCode).toBe(200);
      const debugCode = (send.json() as { debugCode?: string }).debugCode;
      expect(debugCode).toMatch(/^\d{6}$/);

      const verify = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/sms/verify',
        headers,
        payload: { phone: '13800138000', code: debugCode, displayName: '测试用户' },
      });
      expect(verify.statusCode).toBe(200);
      const body = verify.json() as { isNewUser: boolean; user: { displayName: string } };
      expect(body.isNewUser).toBe(true);
      expect(body.user.displayName).toBe('测试用户');
      const cookie = String(verify.headers['set-cookie']).split(';')[0]!;

      const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
      expect(me.statusCode).toBe(200);

      const bad = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/sms/verify',
        headers,
        payload: { phone: '13800138000', code: '000000' },
      });
      expect(bad.statusCode).toBe(401);

      const resend = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/sms/send-code',
        headers,
        payload: { phone: '13800138000' },
      });
      expect(resend.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
