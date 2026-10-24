import type { FastifyInstance } from 'fastify';
import { assertCsrf, requireUser } from '../../plugins/auth.js';
import { enqueueJob } from '../jobs/repository.js';
import { registerJobHandler } from '../jobs/runner.js';
import { ModelClient } from './client.js';
import { answerQuestion } from './assistant.js';

export function registerAssistantHandlers(app: FastifyInstance): void {
  registerJobHandler('assistant', async (job, signal) => {
    if (job.input.kind !== 'assistant') {
      return { ok: false, error: { code: 'BAD_INPUT', message: 'not assistant' } };
    }
    const answer = await answerQuestion(
      {
        question: job.input.question,
        ...(job.input.cityId ? { cityId: job.input.cityId } : {}),
      },
      { pool: app.db, userId: job.userId, model: new ModelClient() },
      signal,
    );
    return { ok: true, data: answer };
  });

  registerJobHandler('recognition', async (job) => {
    // Draft is created at enqueue time in routes; handler acknowledges.
    if (job.input.kind !== 'recognition') {
      return { ok: false, error: { code: 'BAD_INPUT', message: 'not recognition' } };
    }
    return { ok: true, data: { uploadId: job.input.uploadId, status: 'draft_ready' } };
  });

  registerJobHandler('layout', async (job) => {
    if (job.input.kind !== 'layout') {
      return { ok: false, error: { code: 'BAD_INPUT', message: 'not layout' } };
    }
    return {
      ok: true,
      data: { status: 'use_proposeLayout_offline', cityId: job.input.cityId },
    };
  });
}

export async function registerAssistantRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/assistant/runs', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!assertCsrf(request, reply)) return;
    const body = request.body as { question?: string; cityId?: string; key?: string };
    if (!body.question || !body.key) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'question and key required' } });
    }
    const job = await enqueueJob(app.db, user.id, body.key, {
      kind: 'assistant',
      question: body.question,
      ...(body.cityId ? { cityId: body.cityId } : {}),
    });
    return reply.code(202).send({ job });
  });
}
