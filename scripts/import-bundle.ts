#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  buildKnowledgeBundle,
  buildKnowledgeBundleFromWikiSnapshotDir,
  importKnowledgeBundle,
  loadWikiFixtures,
  loadWikiSnapshotBundle,
} from '@jnbjt/knowledge-import';
import { loadEnvFromDotenv } from './lib/load-env.js';

function parseArgs(argv: string[]): { fixtures: string[]; bundles: string[]; publish: boolean } {
  const fixtures: string[] = [];
  const bundles: string[] = [];
  let publish = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--publish') publish = true;
    else if (argv[i] === '--fixture' && argv[i + 1]) fixtures.push(argv[++i]!);
    else if (argv[i] === '--bundle' && argv[i + 1]) bundles.push(argv[++i]!);
  }
  return { fixtures, bundles, publish };
}

function printUsage(): never {
  throw new Error(
    [
      'Usage:',
      '  npm run import:bundle -- --bundle tests/fixtures/wiki/bundles/sample [--publish]',
      '  npm run import:bundle -- --fixture tests/fixtures/wiki/pages/农田 [--fixture ...] [--publish]',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  loadEnvFromDotenv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL required');
  const { fixtures, bundles, publish } = parseArgs(process.argv.slice(2));
  if (fixtures.length === 0 && bundles.length === 0) printUsage();

  let drafts;
  let htmlBySnapshotId: Record<string, string> = {};
  const validationReports: unknown[] = [];

  if (bundles.length > 0) {
    for (const bundlePath of bundles) {
      const dir = resolve(bundlePath);
      if (!existsSync(dir)) throw new Error(`bundle directory not found: ${dir}`);
      const { bundle: _ignored, load } = buildKnowledgeBundleFromWikiSnapshotDir(dir);
      validationReports.push({
        bundleDir: dir,
        validation: load.validation,
        manifest: {
          producer: load.manifest.producer,
          producedAt: load.manifest.producedAt,
          license: load.manifest.license,
        },
      });
      drafts = drafts ? [...drafts, ...load.drafts] : load.drafts;
      htmlBySnapshotId = { ...htmlBySnapshotId, ...load.htmlBySnapshotId };
    }
  } else {
    const loaded = loadWikiFixtures(fixtures.map((f) => resolve(f)));
    drafts = loaded.drafts;
    htmlBySnapshotId = loaded.htmlBySnapshotId;
  }

  const bundle = buildKnowledgeBundle(drafts!);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  try {
    const report = await importKnowledgeBundle(pool, bundle, { publish, htmlBySnapshotId });
    console.log(
      JSON.stringify(
        {
          bundle: {
            bundleId: bundle.bundleId,
            contentHash: bundle.contentHash,
            draftCount: bundle.drafts.length,
            parserVersion: bundle.parserVersion,
          },
          validation: validationReports.length ? validationReports : undefined,
          import: report,
        },
        null,
        2,
      ),
    );
    if (report.status === 'rejected') process.exitCode = 1;
    if (validationReports.some((v) => (v as { validation: { errors: string[] } }).validation.errors.length)) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
