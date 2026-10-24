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
