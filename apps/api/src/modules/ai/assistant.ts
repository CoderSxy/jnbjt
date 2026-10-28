import type { Pool } from 'pg';
import type {
  AssistantAnswer,
  AssistantCitation,
  AssistantInput,
  ProductionResult,
} from '@jnbjt/contracts';
import { calculateSavedProduction, eligibleRecipes, cityVariant } from '../production/service.js';
import { ModelClient } from './client.js';
import { filterCitations, stripInjection } from './citations.js';
import {
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

  const selectedCity = input.cityId ? await toolGetCity(context.pool, context.userId, input.cityId) : null;
  const seedTerms = ['农田', '餐馆', '织布坊', '生产', '应天府', '苏州', '杭州'].filter((t) =>
    question.includes(t),
  );
  let queries = [question, ...seedTerms];
  for (let round = 0; round < MAX_ROUNDS && queries.length > 0; round += 1) {
    const q = queries.shift()!;
    const { hits, citations } = await toolSearchKnowledge(context.pool, q, selectedCity ? cityVariant(selectedCity) : undefined);
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

  const city = selectedCity;
  if (input.cityId && !city) missing.push('city snapshot not readable for current user');
  if (city) assumptions.push(`using private city ${cityVariant(city)} v${city.version}`);

  if (/还缺|几轮|生产|缺口|目标|到|达到|至/.test(question) && /粮食|银两/.test(question)) {
    if (!input.cityId) missing.push('cityId required: 请先选择城市存档');
    // Deliberately narrow grammar: one named resource followed by an explicit total target.
    const targets = [...question.matchAll(/(粮食|银两)(?:生产)?(?:目标(?:为)?|达到|到|至)\s*(\d+)(?=\s*(?:$|[，,](?!\s*\d)|[。！？!?；;]|每天))/g)];
    const frequency = question.match(/每天(?:上线)?\s*(\d+(?:\.\d+)?)\s*次/);
    const validTarget = targets.length === 1 && Number.isSafeInteger(Number(targets[0]![2]));
    if (!validTarget) missing.push('请明确一个目标总库存，例如：粮食到10000；不支持模糊或多个目标');
    if (!frequency || Number(frequency[1]) <= 0) missing.push('请明确每天上线次数，例如：每天上线4次');
    const mentionedCity = question.match(/应天府|苏州|杭州|松江|扬州|嘉兴|湖州|镇江/);
    if (city && mentionedCity && mentionedCity[0] !== cityVariant(city)) missing.push('问题中的城市与所选存档不一致');
    else if (city && validTarget && frequency && Number(frequency[1]) > 0) {
      const resource = targets[0]![1]!;
      const options = (await eligibleRecipes(context.pool, city)).filter((r) => r.outputs.some((o) => o.resource === resource));
      const named = options.filter((r) => question.includes(r.buildingName) && question.includes(r.tier));
      const candidates = named.length ? named : options;
      if (candidates.length !== 1) missing.push('请补充唯一的已审核生产配方（建筑与档位）；当前城市无可用配方或存在多个选择');
      else {
        const recipe = candidates[0]!;
        const result = await calculateSavedProduction(context.pool, context.userId, {cityId: city.id, recipeId: recipe.id, targetInventory: {[resource]: Number(targets[0]![2])}, onlineFrequencyPerDay: Number(frequency[1])});
        if (result) {
          calculations.push(result);
          missing.push(...result.missingConditions, ...result.blockers);
          if (!allCitations.some((c) => c.snapshotId === recipe.snapshotId)) allCitations.push({snapshotId: recipe.snapshotId, entityName: recipe.buildingName, sourceUrl: recipe.sourceUrl, snippet: recipe.sourceNote!});
        }
      }
    }
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
