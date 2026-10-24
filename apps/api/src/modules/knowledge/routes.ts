import type { FastifyInstance } from 'fastify';
import { getBuildingById, searchKnowledge } from './repository.js';

export async function registerKnowledgeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/knowledge/search', async (request) => {
    const query = request.query as { q?: string; city?: string; limit?: string };
    const q = query.q?.trim() ?? '';
    if (!q) {
      return { hits: [], error: { code: 'BAD_REQUEST', message: 'q is required' } };
    }
    const hits = await searchKnowledge(app.db, {
      q,
      ...(query.city ? { city: query.city } : {}),
      ...(query.limit ? { limit: Number(query.limit) } : {}),
    });
    return { hits };
  });

  app.get('/api/v1/buildings/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const building = await getBuildingById(app.db, id);
    if (!building) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'building not found' },
      });
    }
    return { building };
  });
}
