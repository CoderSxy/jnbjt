import type { EffectEvaluation, EffectRule, Layout } from '@jnbjt/contracts';
import { buildingFootprint, cellsOf, rectsOverlap } from './grid.js';

export function getAffectedBuildings(layout: Layout, effect: EffectRule): EffectEvaluation {
  if (effect.mode === 'unknown' || !effect.relativeCoverage) {
    return {
      status: 'unknown',
      affectedBuildingIds: [],
      reason: 'unsupported or unverified range rule; not defaulting to hit',
    };
  }

  const statues = layout.buildings.filter((b) => b.typeName === effect.typeName);
  const affected = new Set<string>();
  for (const statue of statues) {
    const foot = buildingFootprint(statue);
    const coverage = {
      x: foot.x + effect.relativeCoverage.x,
      y: foot.y + effect.relativeCoverage.y,
      w: effect.relativeCoverage.w,
      h: effect.relativeCoverage.h,
    };
    for (const building of layout.buildings) {
      if (building.id === statue.id) continue;
      if (rectsOverlap(buildingFootprint(building), coverage)) {
        affected.add(building.id);
      }
    }
    // touch cells to keep helper used / future point-in-coverage
    void cellsOf(coverage);
  }

  return { status: 'ok', affectedBuildingIds: [...affected] };
}
