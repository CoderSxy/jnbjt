import type { FastifyInstance } from 'fastify';
import {
  assertCsrf,
  createSession,
  destroySession,
  requireUser,
  verifyPassword,
} from '../../plugins/auth.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/login', async (request, reply) => {
    if (!assertCsrf(request, reply)) return;
    const body = request.body as { username?: string; password?: string };
    if (!body.username || !body.password) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'username/password required' } });
    }
    const result = await app.db.query<{ id: string; username: string; role: string; password_hash: string }>(
      `SELECT id, username, role, password_hash FROM users WHERE username = $1`,
      [body.username],
    );
    const user = result.rows[0];
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'invalid credentials' } });
    }
    await createSession(app, reply, user.id);
    return { user: { id: user.id, username: user.username, role: user.role } };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    if (!assertCsrf(request, reply)) return;
    await destroySession(app, request, reply);
    return { ok: true };
  });

  app.get('/api/v1/auth/me', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return { user: { id: user.id, username: user.username, role: user.role } };
  });
}
