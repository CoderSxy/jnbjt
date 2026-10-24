import type { FastifyInstance } from 'fastify';
import type { JobInput } from '@jnbjt/contracts';
import { assertCsrf, requireUser } from '../../plugins/auth.js';
import {
  cancelJob,
  enqueueJob,
  getJobForUser,
  QueueLimitError,
} from './repository.js';

function isJobInput(value: unknown): value is JobInput {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: string }).kind;
  return kind === 'assistant' || kind === 'recognition' || kind === 'layout';
}

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/jobs', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!assertCsrf(request, reply)) return;
    const body = request.body as { key?: string; input?: unknown };
    if (!body.key || !isJobInput(body.input)) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'key and typed input required' },
      });
    }
    try {
      const job = await enqueueJob(app.db, user.id, body.key, body.input);
      return reply.code(202).send({ job });
    } catch (error) {
      if (error instanceof QueueLimitError) {
        return reply.code(429).send({ error: { code: 'QUEUE_LIMIT', message: error.message } });
      }
      throw error;
    }
  });

  app.get('/api/v1/jobs/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const job = await getJobForUser(app.db, user.id, id);
    if (!job) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'job not found' } });
    }
    return { job };
  });

  app.post('/api/v1/jobs/:id/cancel', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!assertCsrf(request, reply)) return;
    const { id } = request.params as { id: string };
    const job = await cancelJob(app.db, user.id, id);
    if (!job) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'job not cancellable' } });
    }
    return { job };
  });
}
