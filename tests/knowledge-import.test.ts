import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  buildKnowledgeBundle,
  importKnowledgeBundle,
  parseBuilding,
} from '@jnbjt/knowledge-import';
import type { SourceSnapshot } from '@jnbjt/contracts';
import { resetKnowledgeTables, testDatabaseUrl, withTestPool } from './helpers/db.js';

const pages = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wiki', 'pages');

function loadSnapshot(title: string): SourceSnapshot {
  const html = readFileSync(join(pages, `${title}.html`), 'utf8');
  const meta = JSON.parse(readFileSync(join(pages, `${title}.meta.json`), 'utf8')) as {
    title: string;
    revision: number;
    sourceUrl: string;
    fetchedAt: string;
  };
  return {
    snapshotId: `snap_${title}`,
    title: meta.title,
    sourceUrl: meta.sourceUrl,
    revision: meta.revision,
    html,
    fetchedAt: meta.fetchedAt,
  };
}

beforeAll(() => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
});

describe('importKnowledgeBundle', () => {
  it('re-importing same bundle does not duplicate published entities', async () => {
    await withTestPool(async (pool) => {
      await resetKnowledgeTables(pool);
      const farm = loadSnapshot('农田');
      const draft = parseBuilding(farm);
      const bundle = buildKnowledgeBundle([draft]);
      const htmlBySnapshotId = { [farm.snapshotId]: farm.html };

      const first = await importKnowledgeBundle(pool, bundle, {
        publish: true,
        htmlBySnapshotId,
      });
      expect(first.status).toBe('published');
      expect(first.activatedVersionId).toBeTruthy();

      const second = await importKnowledgeBundle(pool, bundle, {
        publish: true,
        htmlBySnapshotId,
      });
      expect(second.status).toBe('published');

      const counts = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM building_types bt
         JOIN knowledge_versions kv ON kv.id = bt.knowledge_version_id AND kv.is_active`,
      );
      expect(Number(counts.rows[0]!.n)).toBe(1);
    });
  });

  it('preserves manual overrides and does not activate on failed candidate import', async () => {
    await withTestPool(async (pool) => {
      await resetKnowledgeTables(pool);
      const farm = loadSnapshot('农田');
      const draft = parseBuilding(farm);
      const bundle = buildKnowledgeBundle([draft]);
      const htmlBySnapshotId = { [farm.snapshotId]: farm.html };

      const published = await importKnowledgeBundle(pool, bundle, {
        publish: true,
        htmlBySnapshotId,
      });
      expect(published.status).toBe('published');

      const recipe = await pool.query<{ id: string }>(
        `SELECT pr.id FROM production_recipes pr
         JOIN building_variants bv ON bv.id = pr.variant_id
         JOIN building_types bt ON bt.id = bv.building_type_id
         JOIN knowledge_versions kv ON kv.id = bt.knowledge_version_id AND kv.is_active
         WHERE bt.name = '农田' AND bv.city = '应天府' AND pr.tier = '普通'
         ORDER BY pr.duration_seconds NULLS LAST
         LIMIT 1`,
      );
      await pool.query(
        `UPDATE production_recipes
         SET manual_override = true, confirmation = 'reviewed', workers = 9, workers_unknown = false
         WHERE id = $1`,
        [recipe.rows[0]!.id],
      );

      // Stage-only import must not flip active version
      const staged = await importKnowledgeBundle(pool, bundle, { publish: false, htmlBySnapshotId });
      expect(staged.status).toBe('staged');
      const activeStill = await pool.query<{ id: string }>(
        `SELECT id FROM knowledge_versions WHERE is_active = true`,
      );
      expect(activeStill.rows[0]!.id).toBe(published.activatedVersionId);

      // Mutate bundle hash so publish creates a new version; override should copy forward
      const mutated = {
        ...bundle,
        drafts: [
          {
            ...draft,
            notes: ['refresh'],
          },
        ],
        contentHash: `${bundle.contentHash}ff`,
        bundleId: `${bundle.bundleId}_2`,
      };
      const refreshed = await importKnowledgeBundle(pool, mutated, {
        publish: true,
        htmlBySnapshotId,
      });
      expect(refreshed.status).toBe('published');
      expect(refreshed.preservedManualOverrides).toBeGreaterThanOrEqual(1);

      const overridden = await pool.query<{ workers: number; manual_override: boolean }>(
        `SELECT pr.workers, pr.manual_override FROM production_recipes pr
         JOIN building_variants bv ON bv.id = pr.variant_id
         JOIN building_types bt ON bt.id = bv.building_type_id
         JOIN knowledge_versions kv ON kv.id = bt.knowledge_version_id AND kv.is_active
         WHERE bt.name = '农田' AND bv.city = '应天府' AND pr.manual_override = true`,
      );
      expect(overridden.rows[0]?.workers).toBe(9);
      expect(overridden.rows[0]?.manual_override).toBe(true);

      const evidence = await pool.query(
        `SELECT snapshot_id FROM production_recipes pr
         JOIN building_variants bv ON bv.id = pr.variant_id
         JOIN building_types bt ON bt.id = bv.building_type_id
         JOIN knowledge_versions kv ON kv.id = bt.knowledge_version_id AND kv.is_active
         WHERE bt.name = '农田' LIMIT 1`,
      );
      expect(evidence.rows[0]?.snapshot_id).toBeTruthy();
    });
  });
});
