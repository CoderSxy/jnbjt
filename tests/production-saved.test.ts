import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { testDatabaseUrl } from './helpers/db.js';
import { eligibleRecipes, calculateSavedProduction } from '../apps/api/src/modules/production/service.js';
import { getCity } from '../apps/api/src/modules/cities/repository.js';
import { answerQuestion } from '../apps/api/src/modules/ai/assistant.js';

const schema = `production_${randomUUID().replaceAll('-', '')}`;
let pool: pg.Pool;
beforeAll(async () => {
  pool = new pg.Pool({connectionString: testDatabaseUrl(), max: 1});
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`SET search_path TO ${schema}, public`);
  for (const name of ['001_knowledge.sql', '002_player_data.sql']) await pool.query(readFileSync(`migrations/${name}`, 'utf8'));
  await pool.query(`INSERT INTO users(id,username,password_hash,role) VALUES ('u','production-owner','unused','user'),('other','production-other','unused','user')`);
  const state = {prefectLevel: 1, unlockedAreas: [], inventory: {粮食: 0}, workersAvailable: 4, buildings: [{typeName: '农田', level: 1, count: 2}]};
  for (const [id, key] of [['yt','yingtian'], ['sz','suzhou']]) await pool.query(`INSERT INTO player_cities(id,user_id,city_key,display_name,state) VALUES ($1,'u',$2,$2,$3)`, [id,key,state]);
  await pool.query(`INSERT INTO source_pages(id,canonical_url,title) VALUES ('p','https://example.test/farm','农田'); INSERT INTO source_snapshots(id,source_page_id,content_hash,html,fetched_at) VALUES ('snap','p','hash','<p>source</p>',now()); INSERT INTO knowledge_imports(id,bundle_id,content_hash,status) VALUES ('i','b','hash','published'); INSERT INTO knowledge_versions(id,import_id,label,is_active) VALUES ('k','i','reviewed',true); INSERT INTO building_types(id,name,knowledge_version_id) VALUES ('b','农田','k'); INSERT INTO building_variants(id,building_type_id,city) VALUES ('vy','b','应天府'),('vs','b','苏州');`);
  for (const [id, variant, amount, confirmation] of [['ry','vy',15,'reviewed'], ['rs','vs',10,'published'],['draft','vs',999,'draft']] as const) {
    await pool.query(`INSERT INTO production_recipes(id,variant_id,tier,duration_seconds,workers,inputs,outputs,confirmation,snapshot_id) VALUES ($1,$2,'普通',60,1,'[]',$3,$4,'snap')`, [id,variant, JSON.stringify([{resourceName: '经验', quantity: {kind:'number',value:1,raw:'1'}},{resourceName: '粮食', quantity: {kind:'number',value:amount,raw:String(amount)}}]),confirmation]);
  }
});
afterAll(async () => {if (pool) {await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end();}});
it('only offers reviewed active exact-city recipes backed by snapshots', async () => {
  const city = (await getCity(pool,'u','sz'))!;
  expect((await eligibleRecipes(pool,city)).map((r) => r.id)).toEqual(['rs']);
  expect((await calculateSavedProduction(pool,'u',{cityId:'sz',recipeId:'draft',targetInventory:{粮食:100},onlineFrequencyPerDay:4}))?.status).toBe('need_more_data');
});
it('uses saved inventory and building count with different city recipe yields', async () => {
  const yt = await calculateSavedProduction(pool,'u',{cityId:'yt',recipeId:'ry',targetInventory:{粮食:30},onlineFrequencyPerDay:4});
  const sz = await calculateSavedProduction(pool,'u',{cityId:'sz',recipeId:'rs',targetInventory:{粮食:10000},onlineFrequencyPerDay:4});
  expect(yt?.rounds).toBe(1); expect(sz?.rounds).toBe(500);
  expect(sz?.assumptions.join(' ')).toContain('snapshot:snap');
  expect(await calculateSavedProduction(pool,'other',{cityId:'sz',recipeId:'rs',targetInventory:{粮食:100},onlineFrequencyPerDay:4})).toBeNull();
});
it('assistant honors explicit target and city and refuses missing or mismatched context', async () => {
  const ask = (question: string, cityId?: string, userId = 'u') => answerQuestion({question,...(cityId ? {cityId} : {})}, {pool,userId}, new AbortController().signal);
  expect((await ask('应天府粮食生产到30，每天上线4次','yt')).calculations[0]).toMatchObject({rounds:1,gaps:{粮食:30}});
  expect((await ask('苏州粮食生产到10000，每天上线4次','sz')).calculations[0]).toMatchObject({rounds:500,gaps:{粮食:10000}});
  for (const [question,cityId,userId] of [['粮食生产还缺几轮','sz','u'],['粮食生产到30，每天上线4次',undefined,'u'],['粮食生产到30，每天上线4次','sz','other'],['应天府粮食生产到30，每天上线4次','sz','u']] as const) expect((await ask(question,cityId,userId)).calculations).toEqual([]);
});
it.each([
  '粮食到1万，每天上线4次',
  '粮食到10,000，每天上线4次',
  '我现有粮食100，想生产到1000，每天上线4次',
  '粮食到10.5，每天上线4次',
  '粮食到-10，每天上线4次',
])('assistant refuses incomplete or unsupported target syntax: %s', async (question) => {
  const answer = await answerQuestion({ question, cityId: 'yt' }, { pool, userId: 'u' }, new AbortController().signal);
  expect(answer.calculations).toEqual([]);
  expect(answer.missing.join(' ')).toContain('目标');
});
