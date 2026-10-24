import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

function loadEnvFile(): void {
  // Workspace `npm run -w` uses apps/api as cwd; .env lives at repo root.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(here, '../../../.env'),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
}

async function main(): Promise<void> {
  loadEnvFile();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL required');
  const host = process.env.API_HOST ?? '127.0.0.1';
  const port = Number(process.env.API_PORT ?? 3100);

  const app = await buildApp({
    databaseUrl,
    poolMax: Number(process.env.DATABASE_POOL_MAX ?? 3),
    startJobRunner: process.env.JOB_RUNNER !== '0',
  });

  await app.listen({ host, port });
  console.log(`api listening on http://${host}:${port}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
