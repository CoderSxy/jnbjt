import { describe, expect, it } from 'vitest';
import { calculateProduction } from '@jnbjt/domain';
import type { ProductionInput, RuleSet } from '@jnbjt/contracts';

const syntheticRules: RuleSet = {
  recipes: [
    {
      buildingName: '农田',
      city: '应天府',
      tier: '普通',
      synthetic: true,
      durationSeconds: 60,
      workers: 1,
      inputs: [],
      outputs: [{ resource: '粮食', amount: 15 }],
    },
    {
      buildingName: '餐馆',
      city: '应天府',
      tier: '普通',
      synthetic: true,
      durationSeconds: 90,
      workers: 1,
      inputs: [{ resource: '粮食', amount: 10 }],
      outputs: [{ resource: '银两', amount: 25 }],
    },
    {
      buildingName: '坏链A',
      city: '应天府',
      tier: '普通',
      synthetic: true,
      durationSeconds: 10,
      workers: 1,
      inputs: [{ resource: 'B', amount: 1 }],
      outputs: [{ resource: 'A', amount: 1 }],
    },
    {
      buildingName: '坏链B',
      city: '应天府',
      tier: '普通',
      synthetic: true,
      durationSeconds: 10,
      workers: 1,
      inputs: [{ resource: 'A', amount: 1 }],
      outputs: [{ resource: 'B', amount: 1 }],
    },
    {
      buildingName: '未知田',
      city: '应天府',
      tier: '普通',
      synthetic: true,
      durationSeconds: 'unknown',
      workers: 1,
      inputs: [],
      outputs: [{ resource: '粮食', amount: 10 }],
    },
    {
      buildingName: '空产',
      city: '应天府',
      tier: '普通',
      synthetic: true,
      durationSeconds: 30,
      workers: 1,
      inputs: [],
      outputs: [{ resource: '粮食', amount: 'unknown' }],
    },
  ],
  bonusOrder: ['statue', 'tech'],
  harvestIntervalSeconds: 120,
};

function baseInput(partial: Partial<ProductionInput> & Pick<ProductionInput, 'selectedRecipeKey'>): ProductionInput {
  return {
    inventory: {},
    targetInventory: { 粮食: 40 },
    availableWorkers: 2,
    buildingCount: 1,
    onlineFrequencyPerDay: 4,
    ...partial,
  };
}

describe('calculateProduction', () => {
  it('ceils single-recipe rounds and estimates calendar time from harvest/online', () => {
    const result = calculateProduction(
      baseInput({
        selectedRecipeKey: '农田|应天府|普通',
        inventory: { 粮食: 5 },
        targetInventory: { 粮食: 40 },
      }),
      syntheticRules,
    );
    expect(result.status).toBe('ok');
    expect(result.rounds).toBe(3); // ceil(35/15)
    expect(result.gaps['粮食']).toBe(35);
    expect(result.theoreticalSeconds).toBe(180);
    expect(result.calendarSecondsEstimate).toBeGreaterThan(result.theoreticalSeconds!);
    expect(result.assumptions.some((a) => a.includes('bonusOrder=statue,tech'))).toBe(true);
  });

  it('reports input shortfalls without inventing zero fills', () => {
    const result = calculateProduction(
      baseInput({
        selectedRecipeKey: '餐馆|应天府|普通',
        inventory: { 粮食: 5, 银两: 0 },
        targetInventory: { 银两: 50 },
      }),
      syntheticRules,
    );
    expect(result.status).toBe('need_more_data');
    expect(result.rounds).toBe(2);
    expect(result.gaps['粮食']).toBe(15);
    expect(result.blockers.some((b) => /粮食/.test(b))).toBe(true);
  });

  it('rejects zero/unknown output and unknown duration', () => {
    const unknown = calculateProduction(
      baseInput({ selectedRecipeKey: '未知田|应天府|普通' }),
      syntheticRules,
    );
    expect(unknown.status).toBe('need_more_data');
    expect(unknown.missingConditions.some((m) => /duration/.test(m))).toBe(true);

    const empty = calculateProduction(
      baseInput({ selectedRecipeKey: '空产|应天府|普通' }),
      syntheticRules,
    );
    expect(empty.status).toBe('need_more_data');
  });

  it('rejects circular chains', () => {
    const result = calculateProduction(
      baseInput({
        selectedRecipeKey: '坏链A|应天府|普通',
        targetInventory: { A: 1 },
      }),
      syntheticRules,
    );
    expect(result.status).toBe('rejected');
    expect(result.blockers[0]).toMatch(/circular/i);
  });

  it('keeps city variant keys distinct', () => {
    const rules: RuleSet = {
      ...syntheticRules,
      recipes: [
        ...syntheticRules.recipes,
        {
          buildingName: '农田',
          city: '苏州',
          tier: '普通',
          synthetic: true,
          sourceNote: 'synthetic-suzhou',
          durationSeconds: 60,
          workers: 1,
          inputs: [],
          outputs: [{ resource: '粮食', amount: 12 }],
        },
      ],
    };
    const result = calculateProduction(
      baseInput({
        selectedRecipeKey: '农田|苏州|普通',
        inventory: {},
        targetInventory: { 粮食: 24 },
      }),
      rules,
    );
    expect(result.status).toBe('ok');
    expect(result.rounds).toBe(2);
  });
});
