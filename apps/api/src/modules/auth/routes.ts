import type { FastifyInstance } from 'fastify';
import {
  assertCsrf,
  createSession,
  destroySession,
  requireUser,
} from '../../plugins/auth.js';
import { sendSmsVerificationCode, verifySmsAndLogin } from './sms-service.js';
import { SmsNotConfiguredError } from './sms/types.js';
import { maskPhone } from './phone.js';
import {
  bindPhoneForUser,
  loginWithPassword,
  registerWithPassword,
  setUserPassword,
} from './password-auth.js';

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
  app.post('/api/v1/auth/register', async (request, reply) => {
    if (!assertCsrf(request, reply)) return;
    const body = request.body as { username?: string; password?: string; displayName?: string };
    if (!body.username || !body.password) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'username/password required' } });
    }
    try {
      const user = await registerWithPassword(
        app.db,
        body.username,
        body.password,
        body.displayName,
      );
      await createSession(app, reply, user.id);
      return { user: publicUser({ ...user, phone: null }), isNewUser: true };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'BAD_REQUEST') {
        return reply.code(400).send({ error: { code, message: (error as Error).message } });
      }
      if (code === 'CONFLICT') {
        return reply.code(409).send({ error: { code, message: '用户名已被占用' } });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    if (!assertCsrf(request, reply)) return;
    const body = request.body as { username?: string; password?: string };
    if (!body.username || !body.password) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'username/password required' } });
    }
    try {
      const result = await loginWithPassword(app.db, app, reply, request, body.username, body.password);
      return result;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'RATE_LIMIT') {
        return reply.code(429).send({
          error: {
            code,
            message: '登录尝试过多，请稍后再试',
            retryAfterSeconds: (error as { retryAfterSeconds?: number }).retryAfterSeconds,
          },
        });
      }
      if (code === 'INVALID_CREDENTIALS') {
        return reply.code(401).send({ error: { code, message: '用户名或密码错误' } });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/set-password', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user || !assertCsrf(request, reply)) return;
    const body = request.body as { password?: string; currentPassword?: string };
    if (!body.password) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'password required' } });
    }
    try {
      await setUserPassword(app.db, user.id, body.password, body.currentPassword);
      return { ok: true };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'BAD_REQUEST') {
        return reply.code(400).send({ error: { code, message: (error as Error).message } });
      }
      if (code === 'INVALID_CREDENTIALS') {
        return reply.code(401).send({ error: { code, message: '当前密码不正确' } });
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/bind-phone', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user || !assertCsrf(request, reply)) return;
    const body = request.body as { phone?: string; code?: string };
    if (!body.phone || !body.code) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'phone and code required' } });
    }
    try {
      const result = await bindPhoneForUser(app.db, user.id, body.phone, body.code);
      return result;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'BAD_REQUEST') {
        return reply.code(400).send({ error: { code, message: '手机号或验证码无效' } });
      }
      if (code === 'INVALID_CODE') {
        return reply.code(401).send({ error: { code, message: '验证码错误或已失效' } });
      }
      if (code === 'CONFLICT') {
        return reply.code(409).send({ error: { code, message: (error as Error).message } });
      }
      throw error;
    }
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
