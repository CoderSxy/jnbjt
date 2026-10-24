import type { AssistantCitation } from '@jnbjt/contracts';

export function filterCitations(
  proposedIds: string[],
  allowed: AssistantCitation[],
): AssistantCitation[] {
  const byId = new Map(allowed.map((c) => [c.snapshotId, c]));
  const out: AssistantCitation[] = [];
  for (const id of proposedIds) {
    const hit = byId.get(id);
    if (hit) out.push(hit);
  }
  return out;
}

export function stripInjection(text: string): string {
  return text
    .replace(/忽略以上|ignore previous|system prompt/gi, '[filtered]')
    .slice(0, 4000);
}
