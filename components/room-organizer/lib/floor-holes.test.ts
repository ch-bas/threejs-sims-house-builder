import { ShapeUtils, Vector2 } from 'three';
import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { floorHoleOutlines, rectUnionOutlines } from './floor-holes';
import { floorKeepOut } from './floor-keep-out';
import { hasCollisions } from './geometry';
import { stairwellOutlines } from './plan-export/plan-geometry';
import { computeFloorOpenings } from './stairs';
import { buildWalkWorld, walkSurfaceAt, type WalkSurface } from './walk-world';
import type { FurnitureItem } from './types';

type Outline = ReadonlyArray<readonly [number, number]>;

const area = (outline: Outline) =>
  outline.reduce((sum, [ax, ay], i) => {
    const [bx, by] = outline[(i + 1) % outline.length]!;
    return sum + (ax * by - bx * ay) / 2;
  }, 0);

function inside(outline: Outline, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i]!;
    const [xj, yj] = outline[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function distanceTo(outline: Outline, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, ay] = outline[j]!;
    const [bx, by] = outline[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

/** No vertex repeats, so earcut gets a simple ring. */
const distinctCorners = (outline: Outline) => new Set(outline.map(([x, y]) => `${x},${y}`)).size === outline.length;

describe('rectUnionOutlines (#963)', () => {
  it('cuts one rectangle as a plain box', () => {
    expect(rectUnionOutlines([[0, 0, 2, 1]])).toEqual([
      [
        [0, 0],
        [2, 0],
        [2, 1],
        [0, 1],
      ],
    ]);
  });

  it('cuts two overlapping rectangles of different reach as their union, not their box', () => {
    const [outline, ...rest] = rectUnionOutlines([
      [0, 0, 1, 3],
      [0.5, 1, 2, 2],
    ])!;
    expect(rest).toEqual([]);
    expect(area(outline!)).toBeCloseTo(3 + 1, 9);
    expect(outline).toHaveLength(8);
    expect(inside(outline!, 1.5, 2.5)).toBe(false);
    expect(inside(outline!, 1.5, 1.5)).toBe(true);
  });

  it('fuses rectangles sharing an edge into one outline', () => {
    expect(
      rectUnionOutlines([
        [0, 0, 1, 1],
        [1, 0, 2, 1],
      ])
    ).toEqual([
      [
        [0, 0],
        [2, 0],
        [2, 1],
        [0, 1],
      ],
    ]);
  });

  it('joins rectangles that meet only at a corner without the outline touching itself', () => {
    const outlines = rectUnionOutlines([
      [0, 0, 1, 1],
      [1, 1, 2, 2],
    ]);
    expect(outlines).toHaveLength(1);
    expect(distinctCorners(outlines![0]!)).toBe(true);
    expect(area(outlines![0]!)).toBeCloseTo(2, 5);
  });

  it('snaps float noise so no sliver of floor is left between two holes', () => {
    expect(
      rectUnionOutlines([
        [0, 0, 1, 1],
        [1 + 1e-9, 0, 2, 1],
      ])
    ).toHaveLength(1);
  });

  it('keeps a pocket of floor holes close round, joined to the rest by a millimetre strip', () => {
    const ring = rectUnionOutlines([
      [0, 0, 3, 1],
      [0, 2, 3, 3],
      [0, 0, 1, 3],
      [2, 0, 3, 3],
    ])!;
    expect(ring).toHaveLength(1);
    expect(distinctCorners(ring[0]!)).toBe(true);
    expect(area(ring[0]!)).toBeCloseTo(8 - 0.001, 9);
    // The pocket is floor; the ring round it is hole.
    expect(inside(ring[0]!, 1.5, 1.5)).toBe(false);
    expect(inside(ring[0]!, 0.5, 1.5)).toBe(true);
  });

  it('settles a corner whose next grid line is a few microns away (it used to loop forever)', () => {
    const outlines = rectUnionOutlines([
      [0, 0, 1, 1],
      [1, 1, 2, 2],
      [1.0000015, -1, 1.5, 0.2],
    ]);
    expect(outlines).not.toBeNull();
    expect(new Set(outlines!.flat().map(([x, y]) => `${x},${y}`)).size).toBe(outlines!.flat().length);
  });

  it('always settles into simple, disjoint outlines that triangulate to the union (seeded fuzz)', () => {
    let seed = 0x963;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Coordinates on a coarse grid, so edges and corners meet, each with a few microns of noise.
    const coordinate = () => Math.floor(random() * 9) * 0.5 + (random() < 0.5 ? (random() - 0.5) * 6e-6 : 0);
    const unionArea = (rects: ReadonlyArray<readonly [number, number, number, number]>) => {
      const xs = [...new Set(rects.flatMap(([x0, , x1]) => [x0, x1]))].sort((a, b) => a - b);
      const ys = [...new Set(rects.flatMap(([, y0, , y1]) => [y0, y1]))].sort((a, b) => a - b);
      let sum = 0;
      for (let i = 0; i + 1 < xs.length; i++) {
        for (let j = 0; j + 1 < ys.length; j++) {
          const cx = (xs[i]! + xs[i + 1]!) / 2;
          const cy = (ys[j]! + ys[j + 1]!) / 2;
          if (rects.some(([x0, y0, x1, y1]) => cx > x0 && cx < x1 && cy > y0 && cy < y1)) sum += (xs[i + 1]! - xs[i]!) * (ys[j + 1]! - ys[j]!);
        }
      }
      return sum;
    };
    for (let run = 0; run < 400; run++) {
      const rects: Array<[number, number, number, number]> = [];
      const count = 2 + Math.floor(random() * 6);
      for (let n = 0; n < count; n++) {
        const [a, b, c, d] = [coordinate(), coordinate(), coordinate(), coordinate()];
        if (Math.abs(a - b) < 0.1 || Math.abs(c - d) < 0.1) continue;
        rects.push([Math.min(a, b), Math.min(c, d), Math.max(a, b), Math.max(c, d)]);
      }
      const outlines = rectUnionOutlines(rects);
      const label = JSON.stringify(rects);
      expect(outlines, label).not.toBeNull();
      for (const outline of outlines!) expect(area(outline), label).toBeGreaterThan(0);
      const corners = outlines!.flat().map(([x, y]) => `${x},${y}`);
      expect(new Set(corners).size, label).toBe(corners.length);
      const holeArea = outlines!.reduce((sum, outline) => sum + area(outline), 0);
      // Bridges add and strips take a millimetre here and there.
      expect(Math.abs(holeArea - unionArea(rects)), label).toBeLessThan(0.02);
      // A floor round them, triangulated as the slab is: its area is the floor less the holes.
      const contour = [new Vector2(-1, -1), new Vector2(-1, 6), new Vector2(6, 6), new Vector2(6, -1)];
      const holes = outlines!.map((outline) => outline.map(([x, y]) => new Vector2(x, y)));
      const points = [...contour, ...holes.flat()];
      const triangles = ShapeUtils.triangulateShape(contour, holes);
      const floorArea = triangles.reduce((sum, [a, b, c]) => sum + Math.abs(ShapeUtils.area([points[a!]!, points[b!]!, points[c!]!])), 0);
      expect(Math.abs(floorArea - (49 - holeArea)), label).toBeLessThan(1e-6);
    }
  }, 30_000);
});

describe('merged stairwells: slab, plan, walker and keep-out are one shape (#963)', () => {
  const W = 8;
  const D = 8;
  const stair = (overrides: Partial<FurnitureItem>) =>
    makeItem({ id: 's', type: 'stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 0, z: 0 }, rotation: 0, ...overrides });

  interface Disagreement {
    x: number;
    z: number;
    hole: boolean;
    plan: boolean;
    floor: boolean;
    keptOut: boolean;
  }

  function disagreements(items: FurnitureItem[]): Disagreement[] {
    const floors = [makeFloor({ id: 'ground', items, height: 3 }), makeFloor({ id: 'first', height: 3 })];
    const layout = makeLayout({ width: W, height: D, floors });
    // The slab's holes, back in world [x, z].
    const holes = floorHoleOutlines(W, D, computeFloorOpenings(floors[0])).map((hole) => hole.map(([x, y]): [number, number] => [x, -y]));
    const plan = stairwellOutlines(layout, 1).map((outline) => outline.map(({ x, z }): [number, number] => [x, z]));
    const keepOut = floorKeepOut({ width: W, height: D, floors }, 1);
    const world = buildWalkWorld({ width: W, depth: D, floors });
    const out: WalkSurface = { y: 0, kind: 'floor', floorIndex: 0 };
    const found: Disagreement[] = [];
    for (let x = -3.0123; x <= 3; x += 0.05) {
      for (let z = -3.0071; z <= 3; z += 0.05) {
        // Points on the boundary itself may go either way. The grid is offset
        // off round numbers: the walker keeps a micron seam between a winder's legs.
        if (holes.some((hole) => distanceTo(hole, x, z) < 0.01)) continue;
        const hole = holes.some((outline) => inside(outline, x, z));
        const inPlan = plan.some((outline) => inside(outline, x, z));
        const floor = walkSurfaceAt(world, x, z, 3, 'floor', out) && out.kind === 'floor' && out.floorIndex === 1;
        const probe = makeItem({ id: 'probe', type: 'cabinet', width: 0.004, depth: 0.004, height: 0.9, rotation: 0, position: { x, z } });
        const keptOut = hasCollisions(probe, [probe], W, D, { keepOut });
        if (hole !== inPlan || hole === floor || hole !== keptOut) found.push({ x, z, hole, plan: inPlan, floor, keptOut });
      }
    }
    return found;
  }

  it('keeps the floor between two straight flights whose holes overlap', () => {
    // b's hole ends at z = 0.75, a's at 1.25: the strip x 0.65…1.85, z 0.75…1.25 is floor.
    const items = [stair({ id: 'a' }), stair({ id: 'b', position: { x: 1.2, z: -0.5 } })];
    const holes = floorHoleOutlines(W, D, computeFloorOpenings(makeFloor({ items, height: 3 })));
    expect(holes).toHaveLength(1);
    // Shape space is [x, -z]: world (1.2, 1) is floor.
    expect(inside(holes[0]!, 1.2, -1)).toBe(false);
    expect(disagreements(items).slice(0, 3)).toEqual([]);
  }, 30_000);

  it('agrees for a winder overlapping a flight, turned a quarter', () => {
    const items = [
      stair({ id: 'a' }),
      stair({ id: 'w', width: 2, depth: 2.6, stairsShape: 'winder', rotation: Math.PI / 2, position: { x: 1.4, z: 0.6 } }),
    ];
    expect(floorHoleOutlines(W, D, computeFloorOpenings(makeFloor({ items, height: 3 })))).toHaveLength(1);
    expect(disagreements(items).slice(0, 3)).toEqual([]);
  }, 30_000);

  it('keeps a merged hole off an L’s cut', () => {
    // North-east cut 3 × 3: the notch is x 1…4, z −4…−1. Both flights climb north from it.
    const cutout = { corner: 'ne' as const, width: 3, depth: 3 };
    const items = [stair({ id: 'a', position: { x: 0.4, z: 0.2 }, rotation: Math.PI }), stair({ id: 'b', position: { x: 1.6, z: 0.5 }, rotation: Math.PI })];
    const holes = floorHoleOutlines(W, D, computeFloorOpenings(makeFloor({ items, height: 3 })), cutout);
    expect(holes).toHaveLength(1);
    expect(distinctCorners(holes[0]!)).toBe(true);
    // Shape space: the notch is y 1…4.
    expect(holes[0]!.every(([x, y]) => !(x > 1 && x < 4 && y > 1 && y < 4))).toBe(true);
    expect(Math.abs(area(holes[0]!))).toBeGreaterThan(2);
  });

  it('keeps both holes of two touching stairs round the L’s inner corner', () => {
    // North-east cut 3 × 3 (notch x 1…4, z −4…−1, inner corner at (1, −1)). One hole runs
    // down the notch's west side, one along its south side; they touch inside the notch.
    const cutout = { corner: 'ne' as const, width: 3, depth: 3 };
    const west = { id: 'w', centerX: 0.45, centerZ: -2.5, width: 1.3, depth: 2.6, rotation: 0 };
    const south = { id: 's', centerX: 2.3, centerZ: -0.6, width: 2.6, depth: 1.3, rotation: 0 };
    const holes = floorHoleOutlines(W, D, [west, south], cutout);
    // Shape space is [x, −z]: the middle of each stair's hole is cut.
    expect(holes.some((hole) => inside(hole, 0.4, 2.5))).toBe(true);
    expect(holes.some((hole) => inside(hole, 2.3, 0.4))).toBe(true);
    // Each keeps all of itself but what lies in the notch (with its 1 mm inset).
    const westArea = (0.999 + 0.2) * (3.8 - 1.2);
    const southArea = (3.6 - 1.0) * (0.999 + 0.05);
    expect(holes.reduce((sum, hole) => sum + Math.abs(area(hole)), 0)).toBeCloseTo(westArea + southArea, 6);
    expect(holes.flat().every(([x, y]) => !(x > 1 && x < 4 && y > 1 && y < 4))).toBe(true);
  });
});
