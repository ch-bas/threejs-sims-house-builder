import { describe, expect, it } from 'vitest';
import { makeFloor } from './__testfixtures__/fixtures';
import { floorKeepOut } from './floor-keep-out';
import { hasCollisions } from './geometry';
import { computeFloorOpenings, floorOpeningOutline } from './stairs';
import { buildWalkWorld, walkSurfaceAt, type WalkSurface } from './walk-world';
import type { FloorLayout, FurnitureItem } from './types';

// One stairwell, three readers (#572): the hole the floor above is cut with
// (3D and plan), the furniture keep-out and the walker's floor must agree
// at every point of the floor above.

const W = 8;
const D = 8;

function stair(overrides: Partial<FurnitureItem>): FurnitureItem {
  return {
    id: 'stairs',
    type: 'stairs',
    name: 'Stairs',
    width: 2,
    depth: 3,
    height: 3,
    color: '#000',
    icon: '',
    rotation: 0,
    stairsShape: 'winder',
    position: { x: 1, z: 0.5 },
    ...overrides,
  };
}

function probe(x: number, z: number): FurnitureItem {
  return { id: 'probe', type: 'cabinet', name: 'Probe', width: 0.004, depth: 0.004, height: 0.9, color: '#000', icon: '', rotation: 0, position: { x, z } };
}

function insidePolygon(outline: ReadonlyArray<readonly [number, number]>, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, zi] = outline[i]!;
    const [xj, zj] = outline[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToOutline(outline: ReadonlyArray<readonly [number, number]>, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, az] = outline[j]!;
    const [bx, bz] = outline[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

interface Disagreement {
  x: number;
  z: number;
  hole: boolean;
  floor: boolean;
  keptOut: boolean;
}

function disagreements(item: FurnitureItem, storey: number): Disagreement[] {
  const floors: FloorLayout[] = [
    makeFloor({ id: 'ground', items: [item], height: storey }),
    makeFloor({ id: 'first', height: 3 }),
  ];
  const outlines = computeFloorOpenings(floors[0]).map(floorOpeningOutline);
  const keepOut = floorKeepOut({ width: W, height: D, floors }, 1);
  const world = buildWalkWorld({ width: W, depth: D, floors });
  const out: WalkSurface = { y: 0, kind: 'floor', floorIndex: 0 };
  const found: Disagreement[] = [];
  const reach = Math.hypot(item.width, item.depth) / 2 + 0.2;
  const { x: px, z: pz } = item.position!;
  for (let x = px - reach; x <= px + reach; x += 0.05) {
    for (let z = pz - reach; z <= pz + reach; z += 0.05) {
      if (Math.abs(x) > W / 2 - 0.1 || Math.abs(z) > D / 2 - 0.1) continue;
      // Points on the boundary itself may go either way.
      if (outlines.some((outline) => distanceToOutline(outline, x, z) < 0.01)) continue;
      const hole = outlines.some((outline) => insidePolygon(outline, x, z));
      const floor = walkSurfaceAt(world, x, z, storey, 'floor', out) && out.kind === 'floor' && out.floorIndex === 1;
      const cabinet = probe(x, z);
      const keptOut = hasCollisions(cabinet, [cabinet], W, D, { keepOut });
      if (hole === floor || hole !== keptOut) found.push({ x, z, hole, floor, keptOut });
    }
  }
  return found;
}

describe('the stairwell agrees with the keep-out and the walker (#572)', () => {
  it('a default winder under a 4 m storey: the hole is neither walkable nor furnishable', () => {
    expect(disagreements(stair({ height: 4 }), 4)).toEqual([]);
  });

  it('a default winder under a classic 3 m storey: the floor over the foot is furnishable', () => {
    expect(disagreements(stair({}), 3)).toEqual([]);
  });

  it('agrees for every storey height, lead-in, rotation and mirroring', () => {
    // Storeys that start the cut on the up flight, in each quarter of the fan and on the return flight.
    for (const storey of [2.4, 3, 3.2, 3.6, 4, 4.4, 5, 6]) {
      for (const stairsLeadIn of [0, 2, 6]) {
        for (const variant of [{}, { rotation: Math.PI / 2 }, { rotation: 0.6 }, { mirrored: true, rotation: -2 }]) {
          const item = stair({ height: storey, stairsLeadIn, ...variant });
          const found = disagreements(item, storey);
          expect({ storey, stairsLeadIn, variant, found: found.slice(0, 3) }).toEqual({ storey, stairsLeadIn, variant, found: [] });
        }
      }
    }
  }, 30_000);

  it('agrees for a straight flight too', () => {
    for (let storey = 2.4; storey <= 6; storey += 0.4) {
      expect(disagreements(stair({ stairsShape: 'straight', width: 1.2, height: storey }), storey)).toEqual([]);
      expect(disagreements(stair({ stairsShape: 'straight', width: 1.2, height: storey, rotation: 0.7 }), storey)).toEqual([]);
    }
  });
});
