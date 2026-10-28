import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyReply } from 'fastify';
import { createSession } from '../../plugins/auth.js';
import type { FastifyInstance } from 'fastify';
import { maskPhone, normalizePhone } from './phone.js';
import { getSmsProvider, shouldExposeMockCodeInResponse } from './sms/index.js';
import type { SmsPurpose } from './sms/types.js';
import { SmsNotConfiguredError } from './sms/types.js';

const CODE_TTL_SECONDS = Number(process.env.SMS_CODE_TTL_SECONDS ?? 300);
const SEND_COOLDOWN_SECONDS = Number(process.env.SMS_SEND_COOLDOWN_SECONDS ?? 60);
const MAX_SENDS_PER_HOUR = Number(process.env.SMS_MAX_SENDS_PER_HOUR ?? 5);

function hashCode(phone: string, code: string): string {
  const pepper = process.env.SESSION_SECRET ?? 'dev-pepper';
  return createHash('sha256').update(`${pepper}:${phone}:${code}`).digest('hex');
}

function generateCode(): string {
  return String(randomInt(100000, 999999));
}

function clientIp(request: { ip?: string; headers: Record<string, unknown> }): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return request.ip ?? 'unknown';
}

export async function sendSmsVerificationCode(
  pool: Pool,
  request: { ip?: string; headers: Record<string, unknown> },
  phoneRaw: string,
  purpose: SmsPurpose,
): Promise<{ ok: true; expiresInSeconds: number; debugCode?: string }> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    throw Object.assign(new Error('invalid phone'), { code: 'BAD_REQUEST' });
  }

  const userCheck = await pool.query<{ status: string }>(
    `SELECT status FROM users WHERE phone = $1 LIMIT 1`,
    [phone],
  );
  if (userCheck.rows[0]?.status === 'disabled') {
    throw Object.assign(new Error('account disabled'), { code: 'FORBIDDEN' });
  }

  const recent = await pool.query<{ n: string; last: string }>(
    `SELECT count(*)::text AS n, max(created_at)::text AS last
     FROM sms_verification_codes
     WHERE phone = $1 AND created_at > now() - interval '1 hour'`,
    [phone],
  );
  const sendCount = Number(recent.rows[0]?.n ?? 0);
  if (sendCount >= MAX_SENDS_PER_HOUR) {
    throw Object.assign(new Error('send rate limit exceeded'), { code: 'RATE_LIMIT' });
  }

  const cooldown = await pool.query<{ id: string }>(
    `SELECT id FROM sms_verification_codes
     WHERE phone = $1 AND created_at > now() - ($2 || ' seconds')::interval
     ORDER BY created_at DESC LIMIT 1`,
    [phone, String(SEND_COOLDOWN_SECONDS)],
  );
  if ((cooldown.rowCount ?? 0) > 0) {
    throw Object.assign(new Error('please wait before resending'), { code: 'RATE_LIMIT' });
  }

  const code = generateCode();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000);
  await pool.query(
    `INSERT INTO sms_verification_codes (id, phone, purpose, code_hash, expires_at, send_ip)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, phone, purpose, hashCode(phone, code), expiresAt.toISOString(), clientIp(request)],
  );

  try {
    await getSmsProvider().sendVerificationCode(phone, code, purpose);
  } catch (error) {
    if (error instanceof SmsNotConfiguredError) throw error;
    throw Object.assign(new Error('sms send failed'), { code: 'SMS_FAILED' });
  }

  const result: { ok: true; expiresInSeconds: number; debugCode?: string } = {
    ok: true,
    expiresInSeconds: CODE_TTL_SECONDS,
  };
  if (shouldExposeMockCodeInResponse() && (process.env.SMS_PROVIDER ?? 'mock') === 'mock') {
    result.debugCode = code;
  }
  return result;
}

export async function verifySmsAndLogin(
  pool: Pool,
  app: FastifyInstance,
  reply: FastifyReply,
  phoneRaw: string,
  codeRaw: string,
  displayName?: string,
): Promise<{
  user: { id: string; username: string; role: string; phone: string; displayName: string | null };
  isNewUser: boolean;
}> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    throw Object.assign(new Error('invalid phone'), { code: 'BAD_REQUEST' });
  }
  const code = codeRaw.trim();
  if (!/^\d{6}$/.test(code)) {
    throw Object.assign(new Error('invalid code'), { code: 'BAD_REQUEST' });
  }

  const row = await pool.query<{
    id: string;
    code_hash: string;
    expires_at: string;
    attempts: number;
    max_attempts: number;
    consumed_at: string | null;
  }>(
    `SELECT id, code_hash, expires_at, attempts, max_attempts, consumed_at
     FROM sms_verification_codes
     WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );
  const record = row.rows[0];
  if (!record) {
    throw Object.assign(new Error('code expired or not found'), { code: 'INVALID_CODE' });
  }
  if (record.attempts >= record.max_attempts) {
    throw Object.assign(new Error('too many attempts'), { code: 'INVALID_CODE' });
  }

  const valid = record.code_hash === hashCode(phone, code);
  await pool.query(`UPDATE sms_verification_codes SET attempts = attempts + 1 WHERE id = $1`, [
    record.id,
  ]);
  if (!valid) {
    throw Object.assign(new Error('invalid code'), { code: 'INVALID_CODE' });
  }

  await pool.query(`UPDATE sms_verification_codes SET consumed_at = now() WHERE id = $1`, [
    record.id,
  ]);

  const existing = await pool.query<{
    id: string;
    username: string;
    role: string;
    display_name: string | null;
    status: string;
  }>(`SELECT id, username, role, display_name, status FROM users WHERE phone = $1`, [phone]);

  let userId: string;
  let username: string;
  let role: string;
  let userDisplayName: string | null;
  let isNewUser = false;

  if (existing.rows[0]) {
    if (existing.rows[0].status === 'disabled') {
      throw Object.assign(new Error('account disabled'), { code: 'FORBIDDEN' });
    }
    userId = existing.rows[0].id;
    username = existing.rows[0].username;
    role = existing.rows[0].role;
    userDisplayName = existing.rows[0].display_name;
    if (displayName?.trim()) {
      await pool.query(`UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1`, [
        userId,
        displayName.trim(),
      ]);
      userDisplayName = displayName.trim();
    }
  } else {
    isNewUser = true;
    userId = randomUUID();
    username = `sms_${phone.replace(/\D/g, '').slice(-11)}`;
    userDisplayName = displayName?.trim() || `用户${phone.slice(-4)}`;
    role = 'user';
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role, phone, display_name, status)
       VALUES ($1,$2,NULL,$3,$4,$5,'active')`,
      [userId, username, role, phone, userDisplayName],
    );
  }

  await createSession(app, reply, userId);

  return {
    user: {
      id: userId,
      username,
      role,
      phone: maskPhone(phone),
      displayName: userDisplayName,
    },
    isNewUser,
  };
}
