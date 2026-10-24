import type { FastifyInstance } from 'fastify';
import pg from 'pg';

declare module 'fastify' {
  interface FastifyInstance {
    db: pg.Pool;
  }
}

export type DbPluginOptions = {
  connectionString: string;
  max?: number;
};

export async function registerDb(app: FastifyInstance, opts: DbPluginOptions): Promise<void> {
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  app.decorate('db', pool);
  app.addHook('onClose', async () => {
    await pool.end();
  });
}
