import { describe, expect, it } from 'vitest';
import { answerQuestion } from '../apps/api/src/modules/ai/assistant.js';
import type { Pool } from 'pg';

describe('assistant failures', () => {
  it('handles model offline and unknown facts without forged citations', async () => {
    const pool = {
      query: async () => ({ rows: [], rowCount: 0 }),
    } as unknown as Pool;

    const answer = await answerQuestion(
      { question: '不存在的建筑紫霄殿等级上限？' },
      {
        pool,
        userId: 'u1',
        modelAnswer: async () => {
          throw new Error('offline');
        },
      },
      new AbortController().signal,
    );

    expect(answer.missing.some((m) => /model offline|no knowledge|insufficient/i.test(m))).toBe(
      true,
    );
    expect(answer.citations).toEqual([]);
  });
});

it('refuses invented production target and city', async () => {
  const pool = {query: async () => ({ rows: [], rowCount: 0 })} as unknown as Pool;
  for (const question of ['粮食生产还缺几轮？', '粮食生产到30，每天上线4次']) {
    const answer = await answerQuestion({question}, {pool, userId: 'u'}, new AbortController().signal);
    expect(answer.calculations).toEqual([]);
    expect(answer.missing.join(' ')).toMatch(/city|城市/);
  }
});

it('recognizes explicit target even without the word production', async () => {
  const pool = {query: async () => ({rows: [], rowCount: 0})} as unknown as Pool;
  const answer = await answerQuestion({question:'粮食到10000，每天上线4次'}, {pool,userId:'u'}, new AbortController().signal);
  expect(answer.missing.join(' ')).toMatch(/cityId/);
});
