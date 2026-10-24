import type { Layout, LayoutIssue, LayoutRuleSet, LayoutValidation } from '@jnbjt/contracts';
import {
  adjacentToRoad,
  buildingFootprint,
  cellInRects,
  cellsOf,
  rectsOverlap,
  rotatedSize,
} from './grid.js';

export function validateLayout(layout: Layout, rules: LayoutRuleSet): LayoutValidation {
  const issues: LayoutIssue[] = [];

  for (const b of layout.buildings) {
    if (!rules.allowRotate && b.rotation !== 0) {
      issues.push({
        code: 'ROTATION_FORBIDDEN',
        message: `${b.id} rotation not allowed`,
        buildingId: b.id,
        severity: 'error',
      });
    }

    const size = rotatedSize(b.w, b.h, b.rotation);
    const foot = { x: b.x, y: b.y, w: size.w, h: size.h };
    if (foot.x < 0 || foot.y < 0 || foot.x + foot.w > layout.width || foot.y + foot.h > layout.height) {
      issues.push({
        code: 'OUT_OF_BOUNDS',
        message: `${b.id} outside map`,
        buildingId: b.id,
        severity: 'error',
      });
    }

    for (const cell of cellsOf(foot)) {
      if (layout.buildable.length > 0 && !cellInRects(cell.x, cell.y, layout.buildable)) {
        issues.push({
          code: 'NOT_BUILDABLE',
          message: `${b.id} on non-buildable cell`,
          buildingId: b.id,
          severity: 'error',
        });
        break;
      }
      if (cellInRects(cell.x, cell.y, layout.blocked)) {
        issues.push({
          code: 'BLOCKED',
          message: `${b.id} on blocked cell`,
          buildingId: b.id,
          severity: 'error',
        });
        break;
      }
    }

    if (rules.requireRoadAdjacent && layout.roads.length > 0 && !adjacentToRoad(foot, layout.roads)) {
      issues.push({
        code: 'ROAD_REQUIRED',
        message: `${b.id} must touch a road`,
        buildingId: b.id,
        severity: 'error',
      });
    }
  }

  for (let i = 0; i < layout.buildings.length; i += 1) {
    for (let j = i + 1; j < layout.buildings.length; j += 1) {
      const a = buildingFootprint(layout.buildings[i]!);
      const b = buildingFootprint(layout.buildings[j]!);
      if (rectsOverlap(a, b)) {
        issues.push({
          code: 'COLLISION',
          message: `${layout.buildings[i]!.id} collides with ${layout.buildings[j]!.id}`,
          buildingId: layout.buildings[i]!.id,
          severity: 'error',
        });
      }
    }
  }

  // Locked buildings must keep their coordinates if a previous snapshot is encoded in notes — runtime check is route-level.
  for (const effect of rules.statueEffects) {
    if (effect.mode === 'unknown') {
      issues.push({
        code: 'STATUE_RANGE_UNKNOWN',
        message: `statue effect for ${effect.typeName} is unverified`,
        severity: 'unknown',
      });
    }
  }

  const hasError = issues.some((i) => i.severity === 'error');
  return { ok: !hasError, issues };
}
