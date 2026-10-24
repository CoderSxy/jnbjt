import type { FastifyInstance } from 'fastify';
import type { ProductionInput, RuleSet } from '@jnbjt/contracts';
import { calculateProduction } from '@jnbjt/domain';
import { assertCsrf, requireUser } from '../../plugins/auth.js';

export async function registerProductionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/production/calculate', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!assertCsrf(request, reply)) return;
    const body = request.body as { input?: ProductionInput; rules?: RuleSet };
    if (!body.input || !body.rules) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'input and rules required' } });
    }
    const result = calculateProduction(body.input, body.rules);
    return { result, userId: user.id };
  });
}
