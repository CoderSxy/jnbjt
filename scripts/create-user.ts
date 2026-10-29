#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { hashPassword } from '../apps/api/src/plugins/auth.js';
import { validatePasswordPolicy } from '../apps/api/src/modules/auth/password-policy.js';

function loadEnv(): void {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
}

async function main(): Promise<void> {
  loadEnv();
  const username = process.argv[2];
  const password = process.argv[3];
  const role = process.argv[4] === 'admin' ? 'admin' : 'user';
  if (!username || !password) {
    throw new Error('Usage: npm run create-user -- <username> <password> [admin]');
  }
  const policy = validatePasswordPolicy(username, password);
  if (!policy.ok) throw new Error(policy.message);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL required');

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  try {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role, status) VALUES ($1, $2, $3, $4, 'active')`,
      [id, username, hashPassword(password), role],
    );
    console.log(JSON.stringify({ id, username, role }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
