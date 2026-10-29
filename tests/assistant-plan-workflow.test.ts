import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { hashPassword } from '../apps/api/src/plugins/auth.js';
import { answerQuestion } from '../apps/api/src/modules/ai/assistant.js';
import {
  applyPlanDraft,
  createPlanDraftFromAnswer,
  getPlanDraft,
} from '../apps/api/src/modules/ai/plan-draft.js';
import { getCity } from '../apps/api/src/modules/cities/repository.js';
import { resetKnowledgeTables, resetPlayerTables, testDatabaseUrl, withTestPool } from './helpers/db.js';

beforeAll(() => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
});

async function seedReviewedFarmRecipe(pool: Pool) {
  await resetKnowledgeTables(pool);
  await pool.query(
    `INSERT INTO source_pages(id,canonical_url,title) VALUES ('p','https://example.test/farm','农田');
     INSERT INTO source_snapshots(id,source_page_id,content_hash,html,fetched_at) VALUES ('snap','p','hash','<p></p>',now());
     INSERT INTO knowledge_imports(id,bundle_id,content_hash,status) VALUES ('i','b','hash','published');
     INSERT INTO knowledge_versions(id,import_id,label,is_active) VALUES ('k','i','v1',true);
     INSERT INTO building_types(id,name,knowledge_version_id) VALUES ('bt','农田','k');
     INSERT INTO building_variants(id,building_type_id,city) VALUES ('bv','bt','应天府');
     INSERT INTO production_recipes(id,variant_id,tier,duration_seconds,workers,workers_unknown,inputs,outputs,confirmation,snapshot_id)
     VALUES ('ry','bv','普通',60,1,false,'[]',$1,'reviewed','snap')`,
    [
      JSON.stringify([
        { resourceName: '经验', quantity: { kind: 'number', value: 1, raw: '1' } },
        { resourceName: '粮食', quantity: { kind: 'number', value: 15, raw: '15' } },
      ]),
    ],
  );
  return 'ry';
}

async function seedUserCity(pool: pg.Pool, userId: string, cityId: string) {
  const state = {
    prefectLevel: 1,
    unlockedAreas: [],
    inventory: { 粮食: 0 },
    workersAvailable: 4,
    buildings: [{ typeName: '农田', level: 1, count: 2 }],
  };
  await pool.query(
    `INSERT INTO users (id, username, password_hash, role) VALUES ($1,'u',$2,'user')`,
    [userId, hashPassword('pw')],
  );
  await pool.query(
    `INSERT INTO player_cities (id, user_id, city_key, display_name, state)
     VALUES ($1,$2,'yingtian','应天府',$3::jsonb)`,
    [cityId, userId, state],
  );
}

describe('assistant plan workflow', () => {
  it('does not change city until plan draft is applied', async () => {
    await withTestPool(async (pool) => {
      await resetPlayerTables(pool);
      const userId = randomUUID();
      const cityId = randomUUID();
      await seedReviewedFarmRecipe(pool);
      await seedUserCity(pool, userId, cityId);

      const cityBefore = (await getCity(pool, userId, cityId))!;
      const answer = await answerQuestion(
        {
          question: '应天府农田普通档粮食到30，每天上线4次',
          cityId,
        },
        { pool, userId },
        new AbortController().signal,
      );
      expect(answer.calculations[0]).toMatchObject({ status: 'ok', rounds: 2 });
      expect(answer.planContext?.recipeId).toBe('ry');

      const jobId = randomUUID();
      await pool.query(
        `INSERT INTO jobs (id, user_id, idempotency_key, kind, status, input, attempts)
         VALUES ($1,$2,'k','assistant','succeeded',$3::jsonb,1)`,
        [jobId, userId, JSON.stringify({ kind: 'assistant', question: 'q', cityId })],
      );
      const draft = await createPlanDraftFromAnswer(
        pool,
        userId,
        jobId,
        { question: '应天府农田普通档粮食到30，每天上线4次', cityId },
        cityBefore,
        answer,
      );
      expect(draft?.status).toBe('pending_review');

      const cityMid = (await getCity(pool, userId, cityId))!;
      expect(cityMid.version).toBe(cityBefore.version);
      expect(cityMid.state.productionPlan).toBeUndefined();

      const applied = await applyPlanDraft(pool, userId, draft!.id, cityBefore.version);
      expect(applied.version).toBe(cityBefore.version + 1);
      expect(applied.state.productionPlan?.rounds).toBe(2);
      expect(applied.state.productionPlan?.gaps).toMatchObject({ 粮食: 30 });

      const loaded = await getPlanDraft(pool, userId, draft!.id);
      expect(loaded?.status).toBe('applied');
    });
  });

  it('rejects apply when production is not ok (unreviewed recipe)', async () => {
    await withTestPool(async (pool) => {
      await resetPlayerTables(pool);
      await resetKnowledgeTables(pool);
      const userId = randomUUID();
      const cityId = randomUUID();
      await pool.query(
        `INSERT INTO source_pages(id,canonical_url,title) VALUES ('p','https://example.test/farm','农田');
         INSERT INTO source_snapshots(id,source_page_id,content_hash,html,fetched_at) VALUES ('snap','p','hash','<p></p>',now());
         INSERT INTO knowledge_imports(id,bundle_id,content_hash,status) VALUES ('i','b','hash','published');
         INSERT INTO knowledge_versions(id,import_id,label,is_active) VALUES ('k','i','v1',true);
         INSERT INTO building_types(id,name,knowledge_version_id) VALUES ('bt','农田','k');
         INSERT INTO building_variants(id,building_type_id,city) VALUES ('bv','bt','应天府');
         INSERT INTO production_recipes(id,variant_id,tier,duration_seconds,workers,inputs,outputs,confirmation,snapshot_id)
         VALUES ('draft-only','bv','普通',60,1,'[]',$1,'draft','snap')`,
        [
          JSON.stringify([
            { resourceName: '粮食', quantity: { kind: 'number', value: 15, raw: '15' } },
          ]),
        ],
      );
      await seedUserCity(pool, userId, cityId);
      const city = (await getCity(pool, userId, cityId))!;
      const answer = await answerQuestion(
        { question: '应天府农田普通档粮食到30，每天上线4次', cityId },
        { pool, userId },
        new AbortController().signal,
      );
      expect(answer.calculations).toEqual([]);
      expect(answer.missing.join(' ')).toMatch(/配方/);

      const jobId = randomUUID();
      await pool.query(
        `INSERT INTO jobs (id, user_id, idempotency_key, kind, status, input, attempts)
         VALUES ($1,$2,'k2','assistant','succeeded',$3::jsonb,1)`,
        [jobId, userId, JSON.stringify({ kind: 'assistant', question: 'q', cityId })],
      );
      const draft = await createPlanDraftFromAnswer(
        pool,
        userId,
        jobId,
        { question: '应天府农田普通档粮食到30，每天上线4次', cityId },
        city,
        answer,
      );
      expect(draft).toBeTruthy();
      await expect(applyPlanDraft(pool, userId, draft!.id, city.version)).rejects.toMatchObject({
        code: 'UNPROCESSABLE',
      });
    });
  });

  it('works without model (retrieval/calculation only)', async () => {
    await withTestPool(async (pool) => {
      await resetPlayerTables(pool);
      const userId = randomUUID();
      const cityId = randomUUID();
      await seedReviewedFarmRecipe(pool);
      await seedUserCity(pool, userId, cityId);
      const answer = await answerQuestion(
        { question: '应天府农田普通档粮食到30，每天上线4次', cityId },
        { pool, userId },
        new AbortController().signal,
      );
      expect(answer.assumptions.some((a) => /model not configured/i.test(a))).toBe(true);
      expect(answer.calculations[0]).toMatchObject({ status: 'ok' });
    });
  });
});
