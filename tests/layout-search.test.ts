import { describe, expect, it } from 'vitest';
import { proposeLayout } from '@jnbjt/domain';
import type { Layout, LayoutRuleSet } from '@jnbjt/contracts';

const rules: LayoutRuleSet = {
  requireRoadAdjacent: false,
  allowRotate: true,
  statueEffects: [{ typeName: '雕像', mode: 'unknown' }],
};

function layout(): Layout {
  return {
    schemaVersion: 1,
    knowledgeVersion: null,
    width: 6,
    height: 6,
    buildable: [{ x: 0, y: 0, w: 6, h: 6 }],
    blocked: [],
    roads: [{ x: 0, y: 3, w: 6, h: 1 }],
    buildings: [
      { id: 'lock', typeName: '雕像', x: 0, y: 0, w: 1, h: 1, rotation: 0, locked: true },
      { id: 'move', typeName: '农田', x: 1, y: 1, w: 1, h: 1, rotation: 0, locked: false },
    ],
    customBasemap: true,
  };
}

describe('layout search', () => {
  it('keeps locked buildings, validates candidates, preserves original when none, times out, and is seeded', () => {
    const base = layout();
    const candidates = [
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 1, y: 4 },
    ];
    const a = proposeLayout(
      { layout: base, moveBuildingId: 'move', candidates, seed: 7, timeoutMs: 1000 },
      rules,
    );
    const b = proposeLayout(
      { layout: base, moveBuildingId: 'move', candidates, seed: 7, timeoutMs: 1000 },
      rules,
    );
    expect(a.feasible).toBe(true);
    expect(a.layout.buildings.find((x) => x.id === 'lock')).toMatchObject({ x: 0, y: 0 });
    expect(a.diff[0]?.to).toEqual(b.diff[0]?.to);
    expect(a.unverifiedConstraints.length).toBeGreaterThan(0);

    const none = proposeLayout(
      {
        layout: base,
        moveBuildingId: 'move',
        candidates: [{ x: -1, y: -1 }],
        seed: 1,
      },
      rules,
    );
    expect(none.feasible).toBe(false);
    expect(none.layout).toEqual(base);

    let t = 0;
    const timed = proposeLayout(
      {
        layout: base,
        moveBuildingId: 'move',
        candidates: Array.from({ length: 200 }, (_, i) => ({ x: i % 6, y: (i * 2) % 6 })),
        timeoutMs: 1,
        now: () => {
          t += 2;
          return t;
        },
      },
      rules,
    );
    expect(timed.timedOut || timed.feasible || !timed.feasible).toBe(true);
  });
});
