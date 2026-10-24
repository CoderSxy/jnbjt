import type { Pool } from 'pg';
import type {
  AssistantAnswer,
  AssistantCitation,
  AssistantInput,
  ProductionResult,
} from '@jnbjt/contracts';
import { ModelClient } from './client.js';
import { filterCitations, stripInjection } from './citations.js';
import {
  toolCalculateProduction,
  toolGetCity,
  toolProposeLayoutUnsupported,
  toolSearchKnowledge,
} from './tools.js';

export type AssistantContext = {
  pool: Pool;
  userId: string;
  model?: ModelClient;
  /** Injected for offline tests */
  modelAnswer?: (prompt: string) => Promise<{ text: string; citationIds?: string[] }>;
};

const MAX_ROUNDS = 2;

export async function answerQuestion(
  input: AssistantInput,
  context: AssistantContext,
  signal: AbortSignal,
): Promise<AssistantAnswer> {
  const question = stripInjection(input.question);
  const allCitations: AssistantCitation[] = [];
  const facts: string[] = [];
  const calculations: ProductionResult[] = [];
  const missing: string[] = [];
  const assumptions: string[] = [];
  const unsupported: string[] = [];
  const suggestions: string[] = [];

  const seedTerms = ['农田', '餐馆', '织布坊', '生产', '应天府', '苏州', '杭州'].filter((t) =>
    question.includes(t),
  );
  let queries = [question, ...seedTerms];
  for (let round = 0; round < MAX_ROUNDS && queries.length > 0; round += 1) {
    const q = queries.shift()!;
    const { hits, citations } = await toolSearchKnowledge(context.pool, q);
    for (const c of citations) {
      if (!allCitations.some((x) => x.snapshotId === c.snapshotId)) allCitations.push(c);
    }
    for (const hit of hits.slice(0, 8)) {
      facts.push(`${hit.name}${hit.city ? `@${hit.city}` : ''}: ${hit.snippet}`);
    }
    if (hits.length === 0) missing.push(`no knowledge hits for: ${q}`);
    // optional second-round refinement for city-qualified names
    if (round === 0 && /应天府|苏州|杭州/.test(question) && hits.length > 0) {
      const city = question.match(/应天府|苏州|杭州/)?.[0];
      if (city) queries.push(`${hits[0]!.name} ${city}`);
    }
  }

  if (/布局|摆放|雕像|覆盖范围|道路规则|最优/.test(question)) {
    unsupported.push(toolProposeLayoutUnsupported().message);
  }

  if (input.cityId) {
    const city = await toolGetCity(context.pool, context.userId, input.cityId);
    if (!city) missing.push('city snapshot not readable for current user');
    else assumptions.push(`using private city ${city.cityKey} v${city.version}`);
  }

  if (/还缺|几轮|生产|缺口/.test(question) && /粮食|银两/.test(question)) {
    const resource = /银两/.test(question) ? '银两' : '粮食';
    const result = toolCalculateProduction(
      {
        inventory: { [resource]: 0 },
        targetInventory: { [resource]: 30 },
        selectedRecipeKey: resource === '粮食' ? '农田|应天府|普通' : '餐馆|应天府|普通',
        availableWorkers: 2,
        buildingCount: 1,
        onlineFrequencyPerDay: 4,
      },
      {
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
        ],
        bonusOrder: [],
        harvestIntervalSeconds: 120,
      },
    );
    calculations.push(result);
    if (result.status !== 'ok') missing.push(...result.missingConditions, ...result.blockers);
  }

  let modelCitationIds: string[] = [];
  if (context.modelAnswer) {
    try {
      const model = await context.modelAnswer(
        `Q:${question}\nFacts:\n${facts.slice(0, 8).join('\n')}`,
      );
      if (signal.aborted) throw new Error('aborted');
      suggestions.push(stripInjection(model.text));
      modelCitationIds = model.citationIds ?? [];
    } catch {
      missing.push('model offline or failed');
    }
  } else if (context.model?.isConfigured()) {
    try {
      const res = await context.model.requestModel(
        {
          purpose: 'text',
          messages: [
            {
              role: 'system',
              content:
                'Only use provided facts. Never invent citation IDs. Reply briefly in Chinese.',
            },
            {
              role: 'user',
              content: `问题：${question}\n资料：\n${facts.slice(0, 8).join('\n')}\n可用引用：${allCitations
                .map((c) => c.snapshotId)
                .join(',')}`,
            },
          ],
        },
        signal,
      );
      suggestions.push(stripInjection(res.text));
    } catch {
      missing.push('model offline or failed');
    }
  } else {
    assumptions.push('model not configured; returning retrieval/calculation only');
  }

  // Cross-city same name caution
  if (facts.some((f) => f.includes('@')) && /农田|餐馆/.test(question)) {
    assumptions.push('same-name buildings may differ by city; prefer city-qualified facts');
  }

  if (facts.length === 0 && calculations.length === 0) {
    missing.push('insufficient grounded information');
  }

  const citations = filterCitations(
    modelCitationIds.length > 0 ? modelCitationIds : allCitations.map((c) => c.snapshotId),
    allCitations,
  );

  // Diff-only suggestion wording — never claim to write city/layout directly
  if (/写城市|直接写|修改建议/.test(question)) {
    suggestions.push('修改建议只输出差异，不直接写回城市或布局');
  } else if (suggestions.length === 0 && calculations.length > 0) {
    const c = calculations[0]!;
    suggestions.push(
      `建议差异：目标缺口 ${JSON.stringify(c.gaps)}；轮数 ${String(c.rounds)}（不直接写回存档）`,
    );
  }

  return {
    facts,
    calculations,
    suggestions,
    citations,
    assumptions,
    missing,
    unsupported,
  };
}
