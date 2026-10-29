import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';

export type AuthUser = {
  id: string;
  username: string;
  role: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

const COOKIE_NAME = 'jnbjt_session';
const SESSION_DAYS = 14;

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function parseCookieHeader(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(cookie);

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    request.user = null;
    const sid =
      request.cookies?.[COOKIE_NAME] ??
      parseCookieHeader(request.headers.cookie, COOKIE_NAME);
    if (!sid) return;
    const result = await app.db.query<{
      user_id: string;
      username: string;
      role: string;
    }>(
      `SELECT u.id AS user_id, u.username, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [sid],
    );
    const row = result.rows[0];
    if (!row) return;
    request.user = { id: row.user_id, username: row.username, role: row.role };
  });
}

export function requireUser(request: FastifyRequest, reply: FastifyReply): AuthUser | null {
  if (!request.user) {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } });
    return null;
  }
  return request.user;
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply): AuthUser | null {
  const user = requireUser(request, reply);
  if (!user) return null;
  if (user.role !== 'admin') {
    reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'admin required' } });
    return null;
  }
  return user;
}

export function assertCsrf(request: FastifyRequest, reply: FastifyReply): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) {
    reply.code(403).send({ error: { code: 'CSRF', message: 'origin required' } });
    return false;
  }
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    reply.code(403).send({ error: { code: 'CSRF', message: 'invalid origin' } });
    return false;
  }
  const allowed = new Set<string>([
    host,
    ...(process.env.CSRF_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((value) => {
        try {
          return new URL(value).host;
        } catch {
          return value;
        }
      }),
  ]);
  if (!allowed.has(originUrl.host)) {
    reply.code(403).send({ error: { code: 'CSRF', message: 'origin mismatch' } });
    return false;
  }
  return true;
}

export async function createSession(
  app: FastifyInstance,
  reply: FastifyReply,
  userId: string,
): Promise<void> {
  const id = createHash('sha256').update(randomBytes(32)).digest('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await app.db.query(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
    [id, userId, expires.toISOString()],
  );
  reply.setCookie(COOKIE_NAME, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    // omit Domain → host-only cookie
    expires,
  });
}

export async function destroySession(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sid =
    request.cookies?.[COOKIE_NAME] ?? parseCookieHeader(request.headers.cookie, COOKIE_NAME);
  if (sid) {
    await app.db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sid]);
  }
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

export { COOKIE_NAME };
