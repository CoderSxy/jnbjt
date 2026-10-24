import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBuilding } from '@jnbjt/knowledge-import';
import type { SourceSnapshot } from '@jnbjt/contracts';

const pages = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wiki', 'pages');

function loadSnapshot(title: string): SourceSnapshot {
  const html = readFileSync(join(pages, `${title}.html`), 'utf8');
  const meta = JSON.parse(readFileSync(join(pages, `${title}.meta.json`), 'utf8')) as {
    title: string;
    revision: number;
    sourceUrl: string;
    fetchedAt: string;
  };
  return {
    snapshotId: `snap_${title}`,
    title: meta.title,
    sourceUrl: meta.sourceUrl,
    revision: meta.revision,
    html,
    fetchedAt: meta.fetchedAt,
  };
}

describe('parseBuilding fixtures', () => {
  it('keeps city variants, tiers, rowspan, and sum expressions for 农田', () => {
    const draft = parseBuilding(loadSnapshot('农田'));
    expect(draft.variants.map((v) => v.city).sort()).toEqual(['苏州', '应天府'].sort());

    const yingtian = draft.variants.find((v) => v.city === '应天府');
    expect(yingtian?.recipes.length).toBeGreaterThanOrEqual(3);

    const ordinary = yingtian!.recipes.filter((r) => r.tier === '普通');
    expect(ordinary.length).toBe(2);
    // rowspan keeps tier on both rows
    expect(ordinary.every((r) => r.tier === '普通')).toBe(true);

    const sumRow = ordinary.find((r) => r.outputs.some((o) => o.quantity.kind === 'sum'));
    expect(sumRow).toBeTruthy();
    const food = sumRow!.outputs.find((o) => o.resourceName === '粮食');
    expect(food?.quantity).toMatchObject({ kind: 'sum', parts: [15, 60], raw: '15+60' });
    expect(food?.quantity.value).toBeUndefined();

    const unknownExp = sumRow!.outputs.find((o) => o.resourceName === '经验');
    expect(unknownExp?.quantity.kind).toBe('unknown');
    expect(unknownExp?.quantity.value).not.toBe(0);

    const emptyWorkers = sumRow!.workers;
    expect(emptyWorkers === 'unknown' || emptyWorkers === null).toBe(true);
  });

  it('uses image alt as unit and does not ingest nav tables for 餐馆', () => {
    const draft = parseBuilding(loadSnapshot('餐馆'));
    expect(draft.variants.map((v) => v.city).sort()).toEqual(['杭州', '应天府'].sort());

    const yingtian = draft.variants.find((v) => v.city === '应天府')!;
    expect(yingtian.recipes.length).toBe(2);

    const known = yingtian.recipes[0]!;
    expect(known.inputs[0]?.resourceName).toBe('粮食');
    expect(known.inputs[0]?.quantity.kind).toBe('number');
    expect(known.inputs[0]?.quantity.value).toBe(10);
    expect(known.outputs[0]?.resourceName).toBe('银两');
    expect(known.outputs[0]?.quantity.value).toBe(25);

    const unknownRow = yingtian.recipes[1]!;
    expect(unknownRow.inputs[0]?.quantity.kind).toBe('unknown');
    expect(unknownRow.outputs[0]?.quantity.kind).toBe('unknown');
    expect(unknownRow.durationSeconds).toBe('unknown');

    // nav text must not become a recipe
    const allRaw = draft.variants.flatMap((v) => v.recipes.flatMap((r) => Object.values(r.rawCells)));
    expect(allRaw.some((t) => /不要解析成配方/.test(t))).toBe(false);
  });
});
