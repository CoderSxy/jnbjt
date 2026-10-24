#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  buildKnowledgeBundle,
  importKnowledgeBundle,
  parseBuilding,
} from '@jnbjt/knowledge-import';
import type { SourceSnapshot } from '@jnbjt/contracts';

function loadEnv(): void {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
}

function parseArgs(argv: string[]): { fixtures: string[]; publish: boolean } {
  const fixtures: string[] = [];
  let publish = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--publish') publish = true;
    else if (argv[i] === '--fixture' && argv[i + 1]) fixtures.push(argv[++i]!);
  }
  return { fixtures, publish };
}

async function main(): Promise<void> {
  loadEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL required');
  const { fixtures, publish } = parseArgs(process.argv.slice(2));
  if (fixtures.length === 0) {
    throw new Error('Usage: npm run import:bundle -- --fixture tests/fixtures/wiki/pages/农田 [--publish]');
  }

  const drafts = [];
  const htmlBySnapshotId: Record<string, string> = {};
  for (const fixture of fixtures) {
    const htmlPath = fixture.endsWith('.html') ? fixture : `${fixture}.html`;
    const metaPath = htmlPath.replace(/\.html$/, '.meta.json');
    const html = readFileSync(htmlPath, 'utf8');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      title: string;
      revision: number;
      sourceUrl: string;
      fetchedAt: string;
    };
    const snapshot: SourceSnapshot = {
      snapshotId: `snap_${meta.title}`,
      title: meta.title,
      sourceUrl: meta.sourceUrl,
      revision: meta.revision,
      html,
      fetchedAt: meta.fetchedAt,
    };
    htmlBySnapshotId[snapshot.snapshotId] = html;
    drafts.push(parseBuilding(snapshot));
  }

  const bundle = buildKnowledgeBundle(drafts);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  try {
    const report = await importKnowledgeBundle(pool, bundle, { publish, htmlBySnapshotId });
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'rejected') process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
