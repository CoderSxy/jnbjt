import Fastify from 'fastify';
import { registerDb } from './plugins/db.js';
import { registerAuth } from './plugins/auth.js';
import { registerKnowledgeRoutes } from './modules/knowledge/routes.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerCityRoutes } from './modules/cities/routes.js';
import { registerProductionRoutes } from './modules/production/routes.js';
import { registerJobRoutes } from './modules/jobs/routes.js';
import { JobRunner } from './modules/jobs/runner.js';
import { getModelCapabilities } from './modules/ai/capabilities.js';
import { registerLayoutRoutes } from './modules/layouts/routes.js';
import { registerImportRoutes } from './modules/imports/routes.js';
import {
  registerAssistantHandlers,
  registerAssistantRoutes,
} from './modules/ai/assistant-routes.js';

export type BuildAppOptions = {
  databaseUrl: string;
  poolMax?: number;
  startJobRunner?: boolean;
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
  registerAssistantHandlers(app);

  app.get('/api/v1/health', async () => ({ ok: true }));
  app.get('/api/v1/ready', async (_request, reply) => {
    try {
      await app.db.query('SELECT 1');
      return { ready: true };
    } catch {
      return reply.code(503).send({ ready: false });
    }
  });
  app.get('/api/v1/ai/capabilities', async () => {
    const capabilities = await getModelCapabilities();
    return { capabilities };
  });

  await registerAuthRoutes(app);
  await registerKnowledgeRoutes(app);
  await registerCityRoutes(app);
  await registerProductionRoutes(app);
  await registerJobRoutes(app);
  await registerLayoutRoutes(app);
  await registerImportRoutes(app);
  await registerAssistantRoutes(app);

  if (opts.startJobRunner) {
    const runner = new JobRunner({
      pool: app.db,
      workerId: `api-${process.pid}`,
      pollIntervalMs: 500,
    });
    runner.start();
    app.addHook('onClose', async () => {
      await runner.stop();
    });
  }

  return app;
}
