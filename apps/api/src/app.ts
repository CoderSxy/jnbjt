import Fastify from 'fastify';
import { registerDb } from './plugins/db.js';
import { registerAuth } from './plugins/auth.js';
import { registerKnowledgeRoutes } from './modules/knowledge/routes.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerCityRoutes } from './modules/cities/routes.js';
import { registerProductionRoutes } from './modules/production/routes.js';

export type BuildAppOptions = {
  databaseUrl: string;
  poolMax?: number;
};

export async function buildApp(opts: BuildAppOptions) {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  await registerDb(app, {
    connectionString: opts.databaseUrl,
    max: opts.poolMax ?? 3,
  });
  await registerAuth(app);

  app.get('/api/v1/health', async () => ({ ok: true }));
  app.get('/api/v1/ready', async (_request, reply) => {
    try {
      await app.db.query('SELECT 1');
      return { ready: true };
    } catch {
      return reply.code(503).send({ ready: false });
    }
  });

  await registerAuthRoutes(app);
  await registerKnowledgeRoutes(app);
  await registerCityRoutes(app);
  await registerProductionRoutes(app);
  return app;
}
