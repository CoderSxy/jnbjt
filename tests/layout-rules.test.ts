import { describe, expect, it } from 'vitest';
import { getAffectedBuildings, rotatedSize, validateLayout } from '@jnbjt/domain';
import type { Layout, LayoutRuleSet } from '@jnbjt/contracts';

const baseLayout = (): Layout => ({
  schemaVersion: 1,
  knowledgeVersion: null,
  width: 10,
  height: 10,
  buildable: [{ x: 0, y: 0, w: 10, h: 10 }],
  blocked: [{ x: 8, y: 8, w: 2, h: 2 }],
  roads: [{ x: 0, y: 5, w: 10, h: 1 }],
  buildings: [],
  customBasemap: true,
});

describe('layout rules', () => {
  it('rotates dimensions and rejects bounds/collision/blocked/road/locked-related issues', () => {
    expect(rotatedSize(2, 3, 90)).toEqual({ w: 3, h: 2 });

    const layout = baseLayout();
    layout.buildings = [
      { id: 'a', typeName: '农田', x: 0, y: 4, w: 2, h: 1, rotation: 0, locked: false },
      { id: 'b', typeName: '农田', x: 1, y: 4, w: 2, h: 1, rotation: 0, locked: false },
      { id: 'c', typeName: '仓库', x: 8, y: 8, w: 1, h: 1, rotation: 0, locked: true },
      { id: 'd', typeName: '民居', x: 9, y: 0, w: 2, h: 1, rotation: 0, locked: false },
      { id: 'e', typeName: '远房', x: 0, y: 0, w: 1, h: 1, rotation: 0, locked: false },
    ];

    const rules: LayoutRuleSet = {
      requireRoadAdjacent: true,
      allowRotate: true,
      statueEffects: [{ typeName: '雕像', mode: 'unknown' }],
    };

    const result = validateLayout(layout, rules);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'COLLISION')).toBe(true);
    expect(result.issues.some((i) => i.code === 'BLOCKED' && i.buildingId === 'c')).toBe(true);
    expect(result.issues.some((i) => i.code === 'OUT_OF_BOUNDS' && i.buildingId === 'd')).toBe(true);
    expect(result.issues.some((i) => i.code === 'ROAD_REQUIRED' && i.buildingId === 'e')).toBe(true);
    expect(result.issues.some((i) => i.code === 'STATUE_RANGE_UNKNOWN' && i.severity === 'unknown')).toBe(
      true,
    );
  });

  it('does not invent hits for unknown statue ranges', () => {
    const layout = baseLayout();
    layout.buildings = [
      { id: 's', typeName: '雕像', x: 2, y: 2, w: 1, h: 1, rotation: 0, locked: true },
      { id: 'f', typeName: '农田', x: 3, y: 2, w: 1, h: 1, rotation: 0, locked: false },
    ];
    const unknown = getAffectedBuildings(layout, { typeName: '雕像', mode: 'unknown' });
    expect(unknown.status).toBe('unknown');
    expect(unknown.affectedBuildingIds).toEqual([]);

    const verified = getAffectedBuildings(layout, {
      typeName: '雕像',
      mode: 'verified_rect',
      relativeCoverage: { x: 0, y: 0, w: 3, h: 1 },
    });
    expect(verified.status).toBe('ok');
    expect(verified.affectedBuildingIds).toContain('f');
  });
});
