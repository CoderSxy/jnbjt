import type { Layout, LayoutRuleSet } from '@jnbjt/contracts';
import { validateLayout } from './layout-validation.js';

export type LayoutSearchInput = {
  layout: Layout;
  moveBuildingId: string;
  candidates: Array<{ x: number; y: number }>;
  seed?: number;
  timeoutMs?: number;
  now?: () => number;
};

export type LayoutProposal = {
  feasible: boolean;
  score: number;
  layout: Layout;
  diff: Array<{ buildingId: string; from: { x: number; y: number }; to: { x: number; y: number } }>;
  unverifiedConstraints: string[];
  timedOut: boolean;
};

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function scoreLayout(layout: Layout, moveId: string): number {
  const building = layout.buildings.find((b) => b.id === moveId);
  if (!building) return -Infinity;
  // Prefer closer to roads (lower y distance to any road row) — simple heuristic
  const roadYs = layout.roads.flatMap((r) => {
    const ys: number[] = [];
    for (let y = r.y; y < r.y + r.h; y += 1) ys.push(y);
    return ys;
  });
  const dist = roadYs.length
    ? Math.min(...roadYs.map((y) => Math.abs(y - building.y)))
    : 0;
  return 100 - dist * 10 - building.x * 0.01;
}

export function proposeLayout(input: LayoutSearchInput, rules: LayoutRuleSet): LayoutProposal {
  const start = input.now?.() ?? Date.now();
  const timeoutMs = input.timeoutMs ?? 50;
  const rng = mulberry32(input.seed ?? 1);
  const target = input.layout.buildings.find((b) => b.id === input.moveBuildingId);
  if (!target) {
    return {
      feasible: false,
      score: -Infinity,
      layout: input.layout,
      diff: [],
      unverifiedConstraints: ['building not found'],
      timedOut: false,
    };
  }
  if (target.locked) {
    return {
      feasible: true,
      score: 0,
      layout: input.layout,
      diff: [],
      unverifiedConstraints: ['locked building unchanged'],
      timedOut: false,
    };
  }

  const ordered = [...input.candidates].sort((a, b) => {
    const jitter = rng() - 0.5;
    return a.x + a.y * 100 + jitter - (b.x + b.y * 100);
  });

  let best: LayoutProposal | null = null;
  let timedOut = false;
  const unverified = rules.statueEffects
    .filter((e) => e.mode === 'unknown')
    .map((e) => `unverified statue ${e.typeName}`);

  for (const cand of ordered) {
    if ((input.now?.() ?? Date.now()) - start > timeoutMs) {
      timedOut = true;
      break;
    }
    const next: Layout = {
      ...input.layout,
      buildings: input.layout.buildings.map((b) =>
        b.id === target.id ? { ...b, x: cand.x, y: cand.y } : b,
      ),
    };
    // locked positions unchanged
    for (const b of next.buildings) {
      const prev = input.layout.buildings.find((p) => p.id === b.id);
      if (prev?.locked && (prev.x !== b.x || prev.y !== b.y)) {
        continue;
      }
    }
    const validation = validateLayout(next, rules);
    if (!validation.ok) continue;
    const score = scoreLayout(next, target.id);
    const proposal: LayoutProposal = {
      feasible: true,
      score,
      layout: next,
      diff: [{ buildingId: target.id, from: { x: target.x, y: target.y }, to: { x: cand.x, y: cand.y } }],
      unverifiedConstraints: unverified,
      timedOut: false,
    };
    if (!best || score > best.score) best = proposal;
  }

  if (!best) {
    return {
      feasible: false,
      score: -Infinity,
      layout: input.layout,
      diff: [],
      unverifiedConstraints: unverified,
      timedOut,
    };
  }
  return { ...best, timedOut };
}
