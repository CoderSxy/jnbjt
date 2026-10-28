import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

function loadEnv(): void {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
}

export function hasTestDatabase(): boolean {
  loadEnv();
  return Boolean(process.env.TEST_DATABASE_URL);
}

export function testDatabaseUrl(): string {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL required');
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error('refusing non-loopback TEST_DATABASE_URL');
  }
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must point at jnbjt_test');
  }
  return url;
}

export async function withTestPool<T>(fn: (pool: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 3 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

export async function resetKnowledgeTables(pool: pg.Pool): Promise<void> {
  await pool.query(`
    DO $$ BEGIN
      PERFORM 1 FROM information_schema.tables WHERE table_name = 'entity_evidence';
      IF FOUND THEN
        TRUNCATE entity_evidence, knowledge_chunks, production_recipes, entity_aliases,
                 building_variants, building_types, knowledge_versions, knowledge_imports,
                 source_snapshots, source_pages RESTART IDENTITY CASCADE;
      END IF;
    END $$;
  `);
}

async function truncateIfExists(pool: pg.Pool, tables: string[]): Promise<void> {
  const existing = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tables],
  );
  const names = existing.rows.map((r) => r.table_name);
  if (names.length === 0) return;
  await pool.query(`TRUNCATE ${names.map((n) => `"${n}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export async function resetPlayerTables(pool: pg.Pool): Promise<void> {
  await truncateIfExists(pool, [
    'sms_verification_codes',
    'recognition_drafts',
    'uploads',
    'layouts',
    'jobs',
    'player_city_exports',
    'player_cities',
    'sessions',
    'users',
  ]);
}
