import type { Pool } from 'pg';
import type {
  AssistantCitation,
  KnowledgeHit,
  ProductionInput,
  ProductionResult,
  RuleSet,
} from '@jnbjt/contracts';
import { calculateProduction } from '@jnbjt/domain';
import { searchKnowledge } from '../knowledge/repository.js';
import { getCity } from '../cities/repository.js';

export async function toolSearchKnowledge(
  pool: Pool,
  q: string,
  city?: string,
): Promise<{ hits: KnowledgeHit[]; citations: AssistantCitation[] }> {
  const hits = await searchKnowledge(pool, { q, ...(city ? { city } : {}), limit: 8 });
  const citations: AssistantCitation[] = hits
    .filter((h) => h.snapshotId)
    .map((h) => ({
      snapshotId: h.snapshotId!,
      entityName: h.name,
      sourceUrl: h.sourceUrl,
      snippet: h.snippet,
    }));
  return { hits, citations };
}

export async function toolGetCity(pool: Pool, userId: string, cityId: string) {
  return getCity(pool, userId, cityId);
}

export function toolCalculateProduction(
  input: ProductionInput,
  rules: RuleSet,
): ProductionResult {
  return calculateProduction(input, rules);
}

export function toolProposeLayoutUnsupported(): { status: 'unsupported'; message: string } {
  return { status: 'unsupported', message: 'layout proposal not available in this handler yet' };
}
