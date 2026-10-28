import type { FastifyInstance } from 'fastify';
import { assertCsrf, requireAdmin } from '../../plugins/auth.js';
import { getBuildingById, searchKnowledge } from './repository.js';
import {
  applyRecipeReview,
  listDraftProductionRecipes,
  type RecipeReviewSelector,
} from './recipe-review.js';

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

  app.get('/api/v1/admin/recipes/pending', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;
    const query = request.query as { city?: string };
    const city = query.city?.trim() || '应天府';
    const recipes = await listDraftProductionRecipes(app.db, city);
    return { city, recipes };
  });

  app.post('/api/v1/admin/recipes/review', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin || !assertCsrf(request, reply)) return;
    const body = request.body as {
      city?: string;
      confirmation?: 'reviewed' | 'published';
      recipes?: RecipeReviewSelector[];
      allowIncomplete?: boolean;
    };
    const city = body.city?.trim() || '应天府';
    const confirmation = body.confirmation ?? 'reviewed';
    if (confirmation !== 'reviewed' && confirmation !== 'published') {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'confirmation must be reviewed or published' },
      });
    }
    if (!Array.isArray(body.recipes) || body.recipes.length === 0) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'recipes array required' },
      });
    }
    const report = await applyRecipeReview(app.db, {
      city,
      confirmation,
      selectors: body.recipes,
      allowIncomplete: body.allowIncomplete === true,
    });
    const status = report.updated > 0 ? 200 : report.errors.length ? 422 : 200;
    return reply.code(status).send({ report });
  });
}
