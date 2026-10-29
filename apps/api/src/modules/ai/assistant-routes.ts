import { recognizeScreenshot } from '../imports/recognize.js';
import type { FastifyInstance } from 'fastify';
import { assertCsrf, requireUser } from '../../plugins/auth.js';
import { getCity, VersionConflictError } from '../cities/repository.js';
import { enqueueJob, QueueLimitError } from '../jobs/repository.js';
import { registerJobHandler } from '../jobs/runner.js';
import { ModelClient } from './client.js';
import { answerQuestion } from './assistant.js';
import { applyPlanDraft, createPlanDraftFromAnswer, getPlanDraft } from './plan-draft.js';

export function registerAssistantHandlers(app: FastifyInstance): void {
  registerJobHandler('assistant', async (job, signal) => {
    if (job.input.kind !== 'assistant') {
      return { ok: false, error: { code: 'BAD_INPUT', message: 'not assistant' } };
    }
    const input = {
      question: job.input.question,
      ...(job.input.cityId ? { cityId: job.input.cityId } : {}),
    };
    const answer = await answerQuestion(input, {
      pool: app.db,
      userId: job.userId,
      model: new ModelClient(),
    }, signal);

    let planDraftId: string | null = null;
    if (job.input.cityId) {
      const city = await getCity(app.db, job.userId, job.input.cityId);
      if (city) {
        const draft = await createPlanDraftFromAnswer(
          app.db,
          job.userId,
          job.id,
          input,
          city,
          answer,
        );
        planDraftId = draft?.id ?? null;
      }
    }

    return { ok: true, data: { answer, planDraftId } };
  });

  registerJobHandler('recognition', async (job, signal) => {
    if (job.input.kind !== 'recognition') {
      return { ok: false, error: { code: 'BAD_INPUT', message: 'not recognition' } };
    }
    const draft = await recognizeScreenshot(app.db, job.userId, job.input.uploadId, { ...(job.input.cityId ? { cityId: job.input.cityId } : {}) }, signal, new ModelClient(), job.id, job.workerId);
    return { ok: true, data: { draft } };
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
    try {
      const job = await enqueueJob(app.db, user.id, body.key, {
        kind: 'assistant',
        question: body.question,
        ...(body.cityId ? { cityId: body.cityId } : {}),
      });
      return reply.code(202).send({ job });
    } catch (error) {
      if (error instanceof QueueLimitError) {
        return reply.code(429).send({ error: { code: 'QUEUE_LIMIT', message: error.message } });
      }
      throw error;
    }
  });

  app.get('/api/v1/plan-drafts/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const draft = await getPlanDraft(app.db, user.id, id);
    if (!draft) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'plan draft not found' } });
    }
    return { draft };
  });

  app.post('/api/v1/plan-drafts/:id/apply', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user || !assertCsrf(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { expectedVersion?: number };
    if (typeof body.expectedVersion !== 'number' || !Number.isInteger(body.expectedVersion)) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'expectedVersion required' },
      });
    }
    try {
      const city = await applyPlanDraft(app.db, user.id, id, body.expectedVersion);
      return { city };
    } catch (error) {
      if (error instanceof VersionConflictError) {
        return reply.code(409).send({ error: { code: 'VERSION_CONFLICT', message: 'city version mismatch' } });
      }
      const code = (error as { code?: string }).code;
      if (code === 'NOT_FOUND') return reply.code(404).send({ error: { code, message: (error as Error).message } });
      if (code === 'CONFLICT') return reply.code(409).send({ error: { code, message: (error as Error).message } });
      if (code === 'UNPROCESSABLE') {
        return reply.code(422).send({ error: { code, message: (error as Error).message } });
      }
      if (code === 'BAD_REQUEST') {
        return reply.code(400).send({ error: { code, message: (error as Error).message } });
      }
      throw error;
    }
  });
}
