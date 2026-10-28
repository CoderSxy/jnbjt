import type { FastifyInstance } from 'fastify';
import { assertCsrf, requireUser } from '../../plugins/auth.js';
import { getCity } from '../cities/repository.js';
import { calculateSavedProduction, eligibleRecipes } from './service.js';

export async function registerProductionRoutes(app: FastifyInstance): Promise<void> {
  app.get<{Params: {id: string}}>('/api/v1/cities/:id/production-recipes', async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    const city = await getCity(app.db, user.id, request.params.id);
    if (!city) return reply.code(404).send({error: {code: 'NOT_FOUND', message: 'city not found'}});
    return {recipes: await eligibleRecipes(app.db, city)};
  });
  app.post('/api/v1/production/calculate', async (request, reply) => {
    const user = requireUser(request, reply); if (!user || !assertCsrf(request, reply)) return;
    const body = request.body as {cityId?: string; recipeId?: string; targetInventory?: Record<string, number>; onlineFrequencyPerDay?: number; rules?: unknown; input?: unknown};
    if (!body || typeof body.cityId !== 'string' || typeof body.recipeId !== 'string' || !body.targetInventory || typeof body.targetInventory !== 'object' || Array.isArray(body.targetInventory) || Object.keys(body.targetInventory).length !== 1 || !Object.values(body.targetInventory).every((v) => Number.isSafeInteger(v) && v >= 0) || typeof body.onlineFrequencyPerDay !== 'number' || !Number.isFinite(body.onlineFrequencyPerDay) || body.onlineFrequencyPerDay <= 0 || body.rules || body.input) {
      return reply.code(400).send({error: {code: 'BAD_REQUEST', message: 'cityId, recipeId, one targetInventory and positive onlineFrequencyPerDay required; rules are server-owned'}});
    }
    const result = await calculateSavedProduction(app.db, user.id, {cityId: body.cityId, recipeId: body.recipeId, targetInventory: body.targetInventory, onlineFrequencyPerDay: body.onlineFrequencyPerDay});
    if (!result) return reply.code(404).send({error: {code: 'NOT_FOUND', message: 'city not found'}});
    return {result};
  });
}
