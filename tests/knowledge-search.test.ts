import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildKnowledgeBundle,
  importKnowledgeBundle,
  parseBuilding,
} from '@jnbjt/knowledge-import';
import { buildApp } from '../apps/api/src/app.js';
import { resetKnowledgeTables, testDatabaseUrl, withTestPool } from './helpers/db.js';

const pages = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wiki', 'pages');

beforeAll(() => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
});

describe('knowledge search API', () => {
  it('finds by name and short-word LIKE fallback', async () => {
    await withTestPool(async (pool) => {
      await resetKnowledgeTables(pool);
      const drafts = [];
      const htmlBySnapshotId: Record<string, string> = {};
      for (const title of ['农田', '餐馆']) {
        const html = readFileSync(join(pages, `${title}.html`), 'utf8');
        const meta = JSON.parse(readFileSync(join(pages, `${title}.meta.json`), 'utf8')) as {
          title: string;
          revision: number;
          sourceUrl: string;
          fetchedAt: string;
        };
        const snap = {
          snapshotId: `snap_${title}`,
          title: meta.title,
          sourceUrl: meta.sourceUrl,
          revision: meta.revision,
          html,
          fetchedAt: meta.fetchedAt,
        };
        htmlBySnapshotId[snap.snapshotId] = html;
        drafts.push(parseBuilding(snap));
      }
      const bundle = buildKnowledgeBundle(drafts);
      const report = await importKnowledgeBundle(pool, bundle, {
        publish: true,
        htmlBySnapshotId,
      });
      expect(report.status).toBe('published');
      const restaurant = await pool.query<{ id: string }>(
        `SELECT id FROM building_types WHERE name = '餐馆' AND knowledge_version_id = $1`,
        [report.activatedVersionId],
      );
      await pool.query(
        `INSERT INTO entity_aliases (id, building_type_id, alias, city)
         VALUES ($1, $2, '饭店', NULL)`,
        ['alias_restaurant', restaurant.rows[0]!.id],
      );

      const app = await buildApp({ databaseUrl: testDatabaseUrl(), poolMax: 3 });
      try {
        const byName = await app.inject({
          method: 'GET',
          url: '/api/v1/knowledge/search?q=' + encodeURIComponent('农田'),
        });
        expect(byName.statusCode).toBe(200);
        const nameBody = byName.json() as { hits: Array<{ name: string; snapshotId: string | null }> };
        expect(nameBody.hits[0]?.name).toBe('农田');
        expect(nameBody.hits[0]?.snapshotId).toBeTruthy();

        const short = await app.inject({
          method: 'GET',
          url: '/api/v1/knowledge/search?q=' + encodeURIComponent('农'),
        });
        expect(short.statusCode).toBe(200);
        expect((short.json() as { hits: unknown[] }).hits.length).toBeGreaterThan(0);

        const alias = await app.inject({
          method: 'GET',
          url: '/api/v1/knowledge/search?q=' + encodeURIComponent('饭店'),
        });
        expect(alias.statusCode).toBe(200);
        expect((alias.json() as { hits: Array<{ name: string }> }).hits[0]?.name).toBe('餐馆');

        const detailId = nameBody.hits[0]!.name;
        const searchAgain = await app.inject({
          method: 'GET',
          url: '/api/v1/knowledge/search?q=' + encodeURIComponent(detailId),
        });
        const id = (searchAgain.json() as { hits: Array<{ entityId: string }> }).hits[0]!.entityId;
        const detail = await app.inject({ method: 'GET', url: `/api/v1/buildings/${id}` });
        expect(detail.statusCode).toBe(200);
        expect((detail.json() as { building: { name: string } }).building.name).toBe('农田');
      } finally {
        await app.close();
      }
    });
  });
});
