import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createSession, hashPassword, verifyPassword } from '../../plugins/auth.js';
import { maskPhone, normalizePhone } from './phone.js';
import {
  normalizeUsername,
  validatePassword,
  validatePasswordPolicy,
} from './password-policy.js';
import {
  checkLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} from './login-rate-limit.js';
import { verifyAndConsumeSmsCode } from './sms-service.js';

function clientIp(request: { ip?: string; headers: Record<string, unknown> }): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return request.ip ?? 'unknown';
}

export async function registerWithPassword(
  pool: Pool,
  usernameRaw: string,
  password: string,
  displayName?: string,
): Promise<{ id: string; username: string; role: string; displayName: string | null }> {
  const username = normalizeUsername(usernameRaw);
  const policy = validatePasswordPolicy(username, password);
  if (!policy.ok) {
    throw Object.assign(new Error(policy.message), { code: 'BAD_REQUEST' });
  }

  const dup = await pool.query(`SELECT 1 FROM users WHERE username = $1`, [username]);
  if ((dup.rowCount ?? 0) > 0) {
    throw Object.assign(new Error('username taken'), { code: 'CONFLICT' });
  }

  const id = randomUUID();
  const name = displayName?.trim() || null;
  await pool.query(
    `INSERT INTO users (id, username, password_hash, role, display_name, status)
     VALUES ($1,$2,$3,'user',$4,'active')`,
    [id, username, hashPassword(password), name],
  );
  return { id, username, role: 'user', displayName: name };
}

export async function loginWithPassword(
  pool: Pool,
  app: FastifyInstance,
  reply: FastifyReply,
  request: { ip?: string; headers: Record<string, unknown> },
  usernameRaw: string,
  password: string,
): Promise<{ user: ReturnType<typeof mapPublicUser> }> {
  const username = normalizeUsername(usernameRaw);
  const ip = clientIp(request);
  const allowed = await checkLoginAllowed(pool, username, ip);
  if (!allowed.allowed) {
    throw Object.assign(new Error('too many login attempts'), {
      code: 'RATE_LIMIT',
      retryAfterSeconds: allowed.retryAfterSeconds,
    });
  }

  const result = await pool.query<{
    id: string;
    username: string;
    role: string;
    password_hash: string | null;
    status: string;
    phone: string | null;
    display_name: string | null;
  }>(
    `SELECT id, username, role, password_hash, status, phone, display_name FROM users WHERE username = $1`,
    [username],
  );
  const user = result.rows[0];
  const ok =
    user &&
    user.status === 'active' &&
    user.password_hash &&
    verifyPassword(password, user.password_hash);

  if (!ok) {
    await recordLoginFailure(pool, username, ip);
    throw Object.assign(new Error('invalid credentials'), { code: 'INVALID_CREDENTIALS' });
  }

  await clearLoginFailures(pool, username, ip);
  await createSession(app, reply, user.id);
  return { user: mapPublicUser(user) };
}

function mapPublicUser(user: {
  id: string;
  username: string;
  role: string;
  phone: string | null;
  display_name: string | null;
}) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    ...(user.phone ? { phone: maskPhone(user.phone) } : {}),
    ...(user.display_name ? { displayName: user.display_name } : {}),
  };
}

export async function setUserPassword(
  pool: Pool,
  userId: string,
  newPassword: string,
  currentPassword?: string,
): Promise<void> {
  const p = validatePassword(newPassword);
  if (!p.ok) throw Object.assign(new Error(p.message), { code: 'BAD_REQUEST' });

  const row = await pool.query<{ username: string; password_hash: string | null }>(
    `SELECT username, password_hash FROM users WHERE id = $1 AND status = 'active'`,
    [userId],
  );
  const user = row.rows[0];
  if (!user) throw Object.assign(new Error('user not found'), { code: 'NOT_FOUND' });

  if (user.password_hash) {
    if (!currentPassword || !verifyPassword(currentPassword, user.password_hash)) {
      throw Object.assign(new Error('current password invalid'), { code: 'INVALID_CREDENTIALS' });
    }
  }

  const policy = validatePasswordPolicy(user.username, newPassword);
  if (!policy.ok) throw Object.assign(new Error(policy.message), { code: 'BAD_REQUEST' });

  await pool.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
    userId,
    hashPassword(newPassword),
  ]);
}

export async function bindPhoneForUser(
  pool: Pool,
  userId: string,
  phoneRaw: string,
  codeRaw: string,
): Promise<{ phone: string }> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw Object.assign(new Error('invalid phone'), { code: 'BAD_REQUEST' });
  await verifyAndConsumeSmsCode(pool, phone, codeRaw);

  const self = await pool.query<{ phone: string | null }>(
    `SELECT phone FROM users WHERE id = $1 AND status = 'active'`,
    [userId],
  );
  if (!self.rows[0]) throw Object.assign(new Error('user not found'), { code: 'NOT_FOUND' });
  if (self.rows[0].phone && self.rows[0].phone !== phone) {
    throw Object.assign(new Error('phone already bound'), { code: 'CONFLICT' });
  }

  const other = await pool.query(`SELECT 1 FROM users WHERE phone = $1 AND id <> $2`, [phone, userId]);
  if ((other.rowCount ?? 0) > 0) {
    throw Object.assign(new Error('phone used by another account'), { code: 'CONFLICT' });
  }

  await pool.query(`UPDATE users SET phone = $2, updated_at = now() WHERE id = $1`, [userId, phone]);
  return { phone: maskPhone(phone) };
}
