import { expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { CitySnapshot } from '@jnbjt/contracts';
import { eligibleRecipes } from '../apps/api/src/modules/production/service.js';
it('converts persisted quantity expressions without inventing unknown amounts', async () => {
  const pool = {query: async () => ({rows: [{id:'r',building_name:'农田',city:'苏州',tier:'普通',duration_seconds:60,workers:1,source_snapshot:'s',canonical_url:'https://example.test',inputs:[],outputs:[{resourceName:'粮食',quantity:{kind:'number',value:15,raw:'15'}},{resourceName:'经验',quantity:{kind:'sum',parts:[2,3],raw:'2+3'}},{resourceName:'未知',quantity:{kind:'unknown',raw:'?'}}]}]})} as unknown as Pool;
  const recipes = await eligibleRecipes(pool,{cityKey:'suzhou'} as CitySnapshot);
  expect(recipes[0]?.outputs).toEqual([{resource:'粮食',amount:15},{resource:'经验',amount:'unknown'},{resource:'未知',amount:'unknown'}]);
});
