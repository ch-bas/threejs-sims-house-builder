import { describe, expect, it } from 'vitest';
import { makeFloor } from '../lib/__testfixtures__/fixtures';
import { floorKeepOut } from '../lib/floor-keep-out';
import { hasCollisions } from '../lib/geometry';
import { computeFloorOpenings, floorOpeningOutline } from '../lib/stairs';
import { buildWalkWorld, walkSurfaceAt, type WalkSurface } from '../lib/walk-world';
import { floorHoleOutlines } from './room-builder';
import type { FurnitureItem } from '../lib/types';

// The floor plate's cut agrees with the plan, the keep-out and the walker
// even where the stairwell reaches the floor's edge (#572): a winder against
// a wall must not cut its whole bounding box out of the plate.

const W = 8;
const D = 8;
type Polygon = ReadonlyArray<readonly [number, number]>;

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
    position: { x: 0, z: 0 },
    ...overrides,
  };
}

function probe(x: number, z: number): FurnitureItem {
  return { id: 'probe', type: 'cabinet', name: 'Probe', width: 0.004, depth: 0.004, height: 0.9, color: '#000', icon: '', rotation: 0, position: { x, z } };
}

function insidePolygon(outline: Polygon, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, zi] = outline[i]!;
    const [xj, zj] = outline[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToOutline(outline: Polygon, x: number, z: number): number {
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

/** Sample points of the floor above where the plate, the plan, the keep-out and the walker disagree. */
function disagreements(item: FurnitureItem, storey: number): number {
  const floors = [makeFloor({ id: 'ground', items: [item], height: storey }), makeFloor({ id: 'first', height: 3 })];
  const openings = computeFloorOpenings(floors[0]);
  const plate = floorHoleOutlines(W, D, openings).map((hole) => hole.map(([x, y]): [number, number] => [x, -y]));
  const plan = openings.map(floorOpeningOutline);
  const keepOut = floorKeepOut({ width: W, height: D, floors }, 1);
  const world = buildWalkWorld({ width: W, depth: D, floors });
  const out: WalkSurface = { y: 0, kind: 'floor', floorIndex: 0 };
  let count = 0;
  for (let x = -W / 2 + 0.03; x < W / 2 - 0.02; x += 0.05) {
    for (let z = -D / 2 + 0.03; z < D / 2 - 0.02; z += 0.05) {
      if ([...plate, ...plan].some((outline) => distanceToOutline(outline, x, z) < 0.01)) continue;
      const cut = plate.some((outline) => insidePolygon(outline, x, z));
      const drawn = plan.some((outline) => insidePolygon(outline, x, z));
      const cabinet = probe(x, z);
      const keptOut = hasCollisions(cabinet, [cabinet], W, D, { keepOut });
      const floor = walkSurfaceAt(world, x, z, storey, 'floor', out) && out.kind === 'floor' && out.floorIndex === 1;
      if (cut !== drawn || cut !== keptOut || cut === floor) count++;
    }
  }
  return count;
}

describe('the floor plate cuts what the stairwell is, against a wall too (#572)', () => {
  const placements: Array<[string, Partial<FurnitureItem>]> = [
    ['middle', { position: { x: 0.5, z: 0.5 } }],
    ['flush east', { position: { x: 3, z: 0.5 } }],
    ['flush west', { position: { x: -3, z: 0.5 } }],
    ['flush north', { position: { x: 0, z: -2.5 } }],
    ['flush south', { position: { x: 0, z: 2.5 } }],
    ['mirrored corner', { position: { x: -3, z: 2.5 }, mirrored: true }],
    ['turned 90° against a wall', { position: { x: 0, z: 3 }, rotation: Math.PI / 2 }],
  ];
  for (const [name, placement] of placements) {
    it(`a winder ${name}`, () => {
      for (const storey of [3, 3.5, 4]) {
        expect({ storey, count: disagreements(stair({ ...placement, height: storey }), storey) }).toEqual({ storey, count: 0 });
      }
    });
  }

  it('a straight flight against a wall', () => {
    expect(disagreements(stair({ stairsShape: 'straight', width: 1.2, depth: 2.4, position: { x: 3.4, z: 0 } }), 3)).toBe(0);
  });
});
