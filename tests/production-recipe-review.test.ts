import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  buildKnowledgeBundle,
  importKnowledgeBundle,
  parseBuilding,
} from '@jnbjt/knowledge-import';
import type { SourceSnapshot } from '@jnbjt/contracts';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/plugins/auth.js';
import {
  applyRecipeReview,
  listDraftProductionRecipes,
} from '../apps/api/src/modules/knowledge/recipe-review.js';
import { calculateSavedProduction, eligibleRecipes } from '../apps/api/src/modules/production/service.js';
import { getCity } from '../apps/api/src/modules/cities/repository.js';
import { resetKnowledgeTables, resetPlayerTables, testDatabaseUrl, withTestPool } from './helpers/db.js';

const pages = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wiki', 'pages');
const reviewManifest = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'production',
  'yingtian-review-manifest.json',
);

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

async function publishWikiFixtures(pool: Pool) {
  const farm = loadSnapshot('农田');
  const restaurant = loadSnapshot('餐馆');
  const drafts = [parseBuilding(farm), parseBuilding(restaurant)];
  const htmlBySnapshotId = {
    [farm.snapshotId]: farm.html,
    [restaurant.snapshotId]: restaurant.html,
  };
  const bundle = buildKnowledgeBundle(drafts);
  const published = await importKnowledgeBundle(pool, bundle, { publish: true, htmlBySnapshotId });
  expect(published.status).toBe('published');
  return { bundle, htmlBySnapshotId };
}

describe('应天府配方审核 → 生产计算', () => {
  it('未审核 draft 不出现在可选配方且计算拒用', async () => {
    await withTestPool(async (pool) => {
      await resetKnowledgeTables(pool);
      await resetPlayerTables(pool);
      await publishWikiFixtures(pool);

      const userId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, username, password_hash, role) VALUES ($1,'review-user',$2,'user')`,
        [userId, hashPassword('pw')],
      );
      const state = {
        prefectLevel: 1,
        unlockedAreas: [],
        inventory: { 粮食: 0 },
        workersAvailable: 4,
        buildings: [{ typeName: '农田', level: 1, count: 2 }],
      };
      await pool.query(
        `INSERT INTO player_cities (id, user_id, city_key, display_name, state)
         VALUES ('yt',$1,'yingtian','应天府',$2::jsonb)`,
        [userId, state],
      );

      const drafts = await listDraftProductionRecipes(pool, '应天府');
      expect(drafts.length).toBeGreaterThanOrEqual(5);

      const city = (await getCity(pool, userId, 'yt'))!;
      expect(await eligibleRecipes(pool, city)).toEqual([]);

      const draftId = drafts[0]!.id;
      const blocked = await calculateSavedProduction(pool, userId, {
        cityId: 'yt',
        recipeId: draftId,
        targetInventory: { 粮食: 30 },
        onlineFrequencyPerDay: 4,
      });
      expect(blocked?.status).toBe('need_more_data');
      expect(blocked?.missingConditions[0]).toMatch(/已审核/);
    });
  });

  it('按 manifest 审核后仅完整配方可参与精确计算', async () => {
    await withTestPool(async (pool) => {
      await resetKnowledgeTables(pool);
      await resetPlayerTables(pool);
      await publishWikiFixtures(pool);

      const userId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, username, password_hash, role) VALUES ($1,'review-user',$2,'user')`,
        [userId, hashPassword('pw')],
      );
      const state = {
        prefectLevel: 1,
        unlockedAreas: [],
        inventory: { 粮食: 0, 银两: 0 },
        workersAvailable: 4,
        buildings: [
          { typeName: '农田', level: 1, count: 2 },
          { typeName: '餐馆', level: 1, count: 1 },
        ],
      };
      await pool.query(
        `INSERT INTO player_cities (id, user_id, city_key, display_name, state)
         VALUES ('yt',$1,'yingtian','应天府',$2::jsonb)`,
        [userId, state],
      );

      const manifest = JSON.parse(readFileSync(reviewManifest, 'utf8')) as {
        city: string;
        confirmation: 'reviewed';
        recipes: unknown[];
      };
      const report = await applyRecipeReview(pool, {
        city: manifest.city,
        confirmation: manifest.confirmation,
        selectors: manifest.recipes as Parameters<typeof applyRecipeReview>[1]['selectors'],
      });
      expect(report.updated).toBe(3);
      expect(report.errors).toEqual([]);

      const city = (await getCity(pool, userId, 'yt'))!;
      const options = await eligibleRecipes(pool, city);
      expect(options.length).toBe(3);
      expect(options.every((r) => r.city === '应天府')).toBe(true);

      const farm = options.find((r) => r.buildingName === '农田' && r.durationSeconds === 60);
      expect(farm).toBeTruthy();
      const calc = await calculateSavedProduction(pool, userId, {
        cityId: 'yt',
        recipeId: farm!.id,
        targetInventory: { 粮食: 30 },
        onlineFrequencyPerDay: 4,
      });
      expect(calc?.status).toBe('ok');
      expect(calc?.rounds).toBe(2);
    });
  });

  it('admin API 可列出 pending 并提交审核', async () => {
    await withTestPool(async (pool) => {
      await resetKnowledgeTables(pool);
      await publishWikiFixtures(pool);
      const adminId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, username, password_hash, role) VALUES ($1,'admin',$2,'admin')`,
        [adminId, hashPassword('adminpw')],
      );

      const app = await buildApp({ databaseUrl: testDatabaseUrl() });
      try {
        const login = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { origin: 'http://127.0.0.1:3100', host: '127.0.0.1:3100' },
          payload: { username: 'admin', password: 'adminpw' },
        });
        const cookie = login.headers['set-cookie'];
        const pending = await app.inject({
          method: 'GET',
          url: '/api/v1/admin/recipes/pending?city=应天府',
          headers: { cookie },
        });
        expect(pending.statusCode).toBe(200);
        expect(pending.json().recipes.length).toBeGreaterThanOrEqual(5);

        const manifest = JSON.parse(readFileSync(reviewManifest, 'utf8'));
        const review = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/recipes/review',
          headers: {
            cookie,
            origin: 'http://127.0.0.1:3100',
            host: '127.0.0.1:3100',
          },
          payload: manifest,
        });
        expect(review.statusCode).toBe(200);
        expect(review.json().report.updated).toBe(3);
      } finally {
        await app.close();
      }
    });
  });
});
