#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  throw new Error('DATABASE_URL is required');
}

async function main(): Promise<void> {
  const databaseUrl = loadDatabaseUrl();
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(728301)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const dir = join(ROOT, 'migrations');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const id = file;
      const exists = await client.query(`SELECT 1 FROM schema_migrations WHERE id = $1`, [id]);
      if ((exists.rowCount ?? 0) > 0) {
        console.log(`skip ${id}`);
        continue;
      }
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
        await client.query('COMMIT');
        console.log(`applied ${id}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(728301)`);
    } catch {
      // ignore unlock errors on failed connection
    }
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
