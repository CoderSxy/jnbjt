import type { FastifyInstance } from 'fastify';
import {
  assertCsrf,
  createSession,
  destroySession,
  requireUser,
  verifyPassword,
} from '../../plugins/auth.js';
import { sendSmsVerificationCode, verifySmsAndLogin } from './sms-service.js';
import { SmsNotConfiguredError } from './sms/types.js';
import { maskPhone } from './phone.js';

function publicUser(user: {
  id: string;
  username: string;
  role: string;
  phone?: string | null;
  displayName?: string | null;
}) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    ...(user.phone ? { phone: maskPhone(user.phone) } : {}),
    ...(user.displayName ? { displayName: user.displayName } : {}),
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/login', async (request, reply) => {
    if (!assertCsrf(request, reply)) return;
    const body = request.body as { username?: string; password?: string };
    if (!body.username || !body.password) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'username/password required' } });
    }
    const result = await app.db.query<{
      id: string;
      username: string;
      role: string;
      password_hash: string | null;
      status: string;
      phone: string | null;
      display_name: string | null;
    }>(
      `SELECT id, username, role, password_hash, status, phone, display_name FROM users WHERE username = $1`,
      [body.username],
    );
    const user = result.rows[0];
    if (
      !user ||
      user.status !== 'active' ||
      !user.password_hash ||
      !verifyPassword(body.password, user.password_hash)
    ) {
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'invalid credentials' } });
    }
    await createSession(app, reply, user.id);
    return {
      user: publicUser({
        id: user.id,
        username: user.username,
        role: user.role,
        phone: user.phone,
        displayName: user.display_name,
      }),
    };
  });

  app.post('/api/v1/auth/sms/send-code', async (request, reply) => {
    if (!assertCsrf(request, reply)) return;
    const body = request.body as { phone?: string; purpose?: 'login' | 'register' };
    if (!body.phone) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'phone required' } });
    }
    const purpose = body.purpose === 'register' ? 'register' : 'login';
    try {
      const result = await sendSmsVerificationCode(app.db, request, body.phone, purpose);
      return result;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'BAD_REQUEST') {
        return reply.code(400).send({ error: { code, message: '手机号格式无效' } });
      }
      if (code === 'RATE_LIMIT') {
        return reply.code(429).send({ error: { code, message: '发送过于频繁，请稍后再试' } });
      }
      if (code === 'FORBIDDEN') {
        return reply.code(403).send({ error: { code, message: '账号已停用' } });
      }
      if (error instanceof SmsNotConfiguredError) {
        return reply.code(503).send({ error: { code: 'SMS_NOT_CONFIGURED', message: error.message } });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/sms/verify', async (request, reply) => {
    if (!assertCsrf(request, reply)) return;
    const body = request.body as { phone?: string; code?: string; displayName?: string };
    if (!body.phone || !body.code) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'phone and code required' } });
    }
    try {
      const result = await verifySmsAndLogin(
        app.db,
        app,
        reply,
        body.phone,
        body.code,
        body.displayName,
      );
      return result;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'BAD_REQUEST') {
        return reply.code(400).send({ error: { code, message: '手机号或验证码格式无效' } });
      }
      if (code === 'INVALID_CODE') {
        return reply.code(401).send({ error: { code, message: '验证码错误或已失效' } });
      }
      if (code === 'FORBIDDEN') {
        return reply.code(403).send({ error: { code, message: '账号已停用' } });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    if (!assertCsrf(request, reply)) return;
    await destroySession(app, request, reply);
    return { ok: true };
  });

  app.get('/api/v1/auth/me', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return { user: publicUser(user) };
  });
}
