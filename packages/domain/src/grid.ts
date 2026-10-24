import type { GridRect, LayoutBuilding } from '@jnbjt/contracts';

export function rotatedSize(w: number, h: number, rotation: 0 | 90 | 180 | 270): { w: number; h: number } {
  if (rotation === 90 || rotation === 270) return { w: h, h: w };
  return { w, h };
}

export function buildingFootprint(b: LayoutBuilding): GridRect {
  const size = rotatedSize(b.w, b.h, b.rotation);
  return { x: b.x, y: b.y, w: size.w, h: size.h };
}

export function cellsOf(rect: GridRect): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function cellInRects(x: number, y: number, rects: GridRect[]): boolean {
  return rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}

export function adjacentToRoad(footprint: GridRect, roads: GridRect[]): boolean {
  const neighbors = [
    ...cellsOf({ x: footprint.x - 1, y: footprint.y, w: 1, h: footprint.h }),
    ...cellsOf({ x: footprint.x + footprint.w, y: footprint.y, w: 1, h: footprint.h }),
    ...cellsOf({ x: footprint.x, y: footprint.y - 1, w: footprint.w, h: 1 }),
    ...cellsOf({ x: footprint.x, y: footprint.y + footprint.h, w: footprint.w, h: 1 }),
  ];
  return neighbors.some((c) => cellInRects(c.x, c.y, roads));
}
