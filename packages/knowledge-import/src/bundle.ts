import { createHash } from 'node:crypto';
import type { KnowledgeBundle, ParsedBuildingDraft } from '@jnbjt/contracts';
import { normalizeBuildingDraft } from './normalize.js';

export const PARSER_VERSION = '1.0.0';

export function buildKnowledgeBundle(drafts: ParsedBuildingDraft[]): KnowledgeBundle {
  const normalized = drafts.map(normalizeBuildingDraft);
  const chunks = normalized.flatMap((draft) =>
    draft.variants.map((variant) => ({
      entityName: draft.name,
      city: variant.city,
      heading: `${draft.name} · ${variant.city ?? 'unknown'}`,
      body: variant.recipes
        .map((r) =>
          [
            `档位=${r.tier}`,
            `耗时=${String(r.durationSeconds)}`,
            `工人=${String(r.workers)}`,
            `投入=${r.inputs.map((i) => `${i.resourceName}:${i.quantity.raw}`).join(',')}`,
            `产出=${r.outputs.map((o) => `${o.resourceName}:${o.quantity.raw}`).join(',')}`,
          ].join('; '),
        )
        .join('\n'),
      snapshotId: draft.snapshotId,
    })),
  );

  const payload = JSON.stringify({ parserVersion: PARSER_VERSION, drafts: normalized, chunks });
  const contentHash = createHash('sha256').update(payload).digest('hex');
  return {
    bundleId: `bundle_${contentHash.slice(0, 16)}`,
    contentHash,
    createdAt: new Date().toISOString(),
    parserVersion: PARSER_VERSION,
    drafts: normalized,
    chunks,
  };
}
