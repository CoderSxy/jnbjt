import type { FastifyInstance } from 'fastify';
import type { Layout, LayoutRuleSet } from '@jnbjt/contracts';
import { validateLayout } from '@jnbjt/domain';
import { assertCsrf, requireUser } from '../../plugins/auth.js';
import { getCity } from '../cities/repository.js';
import { getLayout, saveLayout, VersionConflictError } from './repository.js';

const defaultRules: LayoutRuleSet = {
  requireRoadAdjacent: false,
  allowRotate: true,
  statueEffects: [],
};

export async function registerLayoutRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/layouts/validate', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = request.body as { layout?: Layout; rules?: LayoutRuleSet };
    if (!body.layout) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'layout required' } });
    }
    return { validation: validateLayout(body.layout, body.rules ?? defaultRules) };
  });

  app.get('/api/v1/cities/:id/layout', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const city = await getCity(app.db, user.id, id);
    if (!city) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'city not found' } });
    const layout = await getLayout(app.db, user.id, id);
    return { layout: layout ?? null };
  });

  app.put('/api/v1/cities/:id/layout', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!assertCsrf(request, reply)) return;
    const { id } = request.params as { id: string };
    const city = await getCity(app.db, user.id, id);
    if (!city) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'city not found' } });
    const body = request.body as {
      expectedVersion?: number | null;
      layout?: Layout;
      rules?: LayoutRuleSet;
    };
    if (!body.layout) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'layout required' } });
    }
    const validation = validateLayout(body.layout, body.rules ?? defaultRules);
    if (!validation.ok) {
      return reply.code(400).send({ error: { code: 'INVALID_LAYOUT', message: 'layout invalid' }, validation });
    }
    try {
      const saved = await saveLayout(
        app.db,
        user.id,
        id,
        body.expectedVersion ?? null,
        body.layout,
      );
      return { layout: saved, validation };
    } catch (error) {
      if (error instanceof VersionConflictError) {
        return reply.code(409).send({ error: { code: 'VERSION_CONFLICT', message: 'version conflict' } });
      }
      if (error instanceof Error && error.name === 'LockedBuildingError') {
        return reply.code(400).send({ error: { code: 'LOCKED', message: error.message } });
      }
      throw error;
    }
  });
}
