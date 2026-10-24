import { describe, expect, it } from 'vitest';
import {
  MAX_PATH_POINTS,
  NPC_RADIUS,
  type NpcNav,
  type NpcNavInput,
  buildNpcNav,
  cellAt,
  cellX,
  cellZ,
  findNpcPath,
  isFreeAt,
  lineIsFree,
  nearestFreeCell,
  pickDestination,
  randomFreeCell,
} from './npc-path';
import type { KeepOutRect } from './geometry';
import type { FurnitureItem, InteriorWall } from './types';

/** Deterministic PRNG (mulberry32) so picks are reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function item(overrides: Partial<FurnitureItem> & { position: { x: number; z: number } }): FurnitureItem {
  return {
    id: 'sofa',
    type: 'sofa',
    name: 'Sofa',
    width: 2,
    depth: 1,
    height: 0.8,
    color: '#000',
    icon: '🛋️',
    rotation: 0,
    ...overrides,
  };
}

const ROOM = { roomWidth: 8, roomDepth: 6 };

function nav(input: Partial<NpcNavInput> = {}): NpcNav {
  const built = buildNpcNav({ items: [], interiorWalls: [], keepOut: [], ...ROOM, ...input });
  if (!built) throw new Error('no nav');
  return built;
}

/** A partition across the room at x = 0, wall to wall. */
const PARTITION: InteriorWall = { id: 'w', x1: 0, z1: -3, x2: 0, z2: 3 };
const DOOR = item({ id: 'door', type: 'door', name: 'Door', width: 0.9, depth: 0.12, height: 2.05, position: { x: 0, z: 1 }, rotation: Math.PI / 2 });

function regions(n: NpcNav): Set<number> {
  const seen = new Set<number>();
  for (let i = 0; i < n.freeCount; i++) seen.add(n.region[n.free[i]!]!);
  return seen;
}

function pathPoints(n: NpcNav, fromX: number, fromZ: number, goal: number): Array<[number, number]> {
  const out = new Float32Array(MAX_PATH_POINTS * 2);
  const count = findNpcPath(n, fromX, fromZ, goal, out);
  const points: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) points.push([out[i * 2]!, out[i * 2 + 1]!]);
  return points;
}

describe('buildNpcNav', () => {
  it('an empty room is one free region inside the exterior margin', () => {
    const n = nav();
    expect(regions(n).size).toBe(1);
    expect(isFreeAt(n, 0, 0)).toBe(true);
    expect(isFreeAt(n, 3.9, 0)).toBe(false);
    expect(isFreeAt(n, 0, -2.9)).toBe(false);
    expect(n.interestCount).toBe(0);
  });

  it('returns null for a footprint too small to hold a walker', () => {
    expect(buildNpcNav({ items: [], interiorWalls: [], keepOut: [], roomWidth: 1, roomDepth: 6 })).toBeNull();
  });

  it('furniture blocks its footprint plus the walker radius; a rug does not', () => {
    const n = nav({ items: [item({ position: { x: 0, z: 0 } }), item({ id: 'rug', type: 'rug', height: 0.02, position: { x: -2.5, z: 1.5 } })] });
    expect(isFreeAt(n, 0, 0)).toBe(false);
    expect(isFreeAt(n, 1.1, 0)).toBe(false); // within the radius of the sofa's end
    expect(isFreeAt(n, 1.0 + NPC_RADIUS + 0.15, 0)).toBe(true);
    expect(isFreeAt(n, -2.5, 1.5)).toBe(true);
  });

  it('stairs are solid for walkers, and so are the keep-out rects', () => {
    const stairs = item({ id: 'st', type: 'stairs', name: 'Stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 2.5, z: 0 } });
    const hole: KeepOutRect = { x0: -3, x1: -2, z0: -1, z1: 1, hole: true };
    const porch: KeepOutRect = { x0: -0.5, x1: 0.5, z0: 2, z1: 3 };
    const n = nav({ items: [stairs], keepOut: [hole, porch] });
    expect(isFreeAt(n, 2.5, 0)).toBe(false);
    expect(isFreeAt(n, -2.5, 0)).toBe(false);
    expect(isFreeAt(n, 0, 2.5)).toBe(false);
    expect(isFreeAt(n, 0, 0)).toBe(true);
  });

  it('a partition without a door splits the floor; a door joins it', () => {
    expect(regions(nav({ interiorWalls: [PARTITION] })).size).toBe(2);
    const joined = nav({ interiorWalls: [PARTITION], items: [DOOR] });
    expect(regions(joined).size).toBe(1);
    expect(isFreeAt(joined, 0, 1)).toBe(true);
    expect(isFreeAt(joined, 0, -1)).toBe(false);
  });

  it('marks the free cells beside furniture as spots facing it', () => {
    const n = nav({ items: [item({ position: { x: 0, z: 0 } })] });
    expect(n.interestCount).toBeGreaterThan(0);
    const inFront = cellAt(n, 0, 0.5 + NPC_RADIUS + 0.15);
    expect(n.walkable[inFront]).toBe(1);
    // Standing on +Z of the sofa, facing it means heading -Z (rotation π).
    expect(Math.abs(Math.abs(n.heading[inFront]!) - Math.PI)).toBeLessThan(0.3);
  });
});

describe('findNpcPath', () => {
  it('routes around a sofa with every leg on free cells', () => {
    const n = nav({ items: [item({ width: 4, position: { x: 0, z: 0 } })] });
    const goal = cellAt(n, 0, 1.6);
    const points = pathPoints(n, 0, -1.6, goal);
    expect(points.length).toBeGreaterThan(1);
    let [ax, az] = [0, -1.6];
    for (const [x, z] of points) {
      expect(lineIsFree(n, ax, az, x, z)).toBe(true);
      [ax, az] = [x, z];
    }
    expect(ax).toBeCloseTo(cellX(n, goal), 5);
    expect(az).toBeCloseTo(cellZ(n, goal), 5);
  });

  it('string-pulls an open-floor route to one straight leg', () => {
    const n = nav();
    expect(pathPoints(n, -2, -1, cellAt(n, 2, 1))).toHaveLength(1);
  });

  it('goes through the door, and finds nothing across a solid partition', () => {
    const joined = nav({ interiorWalls: [PARTITION], items: [DOOR] });
    const points = pathPoints(joined, -2, -1.5, cellAt(joined, 2, -1.5));
    const crossing = points.findIndex(([x]) => x > 0);
    expect(crossing).toBeGreaterThan(0);
    // The leg that crosses x = 0 does so within the door's 0.9 m gap.
    const [px, pz] = points[crossing - 1]!;
    const [qx, qz] = points[crossing]!;
    const zAtWall = pz + ((qz - pz) * (0 - px)) / (qx - px);
    expect(Math.abs(zAtWall - 1)).toBeLessThan(0.45);

    const split = nav({ interiorWalls: [PARTITION] });
    expect(pathPoints(split, -2, -1.5, cellAt(split, 2, -1.5))).toHaveLength(0);
  });
});

describe('destinations', () => {
  it('picks a reachable cell at least a metre away, deterministically', () => {
    const n = nav({ interiorWalls: [PARTITION], items: [item({ position: { x: -2, z: 0 } })] });
    const from = cellAt(n, -2, 2);
    const a = seeded(7);
    const b = seeded(7);
    for (let i = 0; i < 50; i++) {
      const cell = pickDestination(n, from, a);
      expect(cell).toBe(pickDestination(n, from, b));
      expect(n.region[cell]).toBe(n.region[from]);
      expect(Math.hypot(cellX(n, cell) - cellX(n, from), cellZ(n, cell) - cellZ(n, from))).toBeGreaterThanOrEqual(1);
    }
  });

  it('a walker the floor changed under steps to the nearest free cell', () => {
    const n = nav({ items: [item({ position: { x: 0, z: 0 } })] });
    const cell = nearestFreeCell(n, 0.2, 0.3);
    expect(n.walkable[cell]).toBe(1);
    expect(Math.hypot(cellX(n, cell) - 0.2, cellZ(n, cell) - 0.3)).toBeLessThan(0.7);
  });

  it('a full floor has nowhere to spawn', () => {
    const n = nav({ items: [item({ width: 8, depth: 6, position: { x: 0, z: 0 } })] });
    expect(n.freeCount).toBe(0);
    expect(randomFreeCell(n, seeded(1))).toBe(-1);
    expect(nearestFreeCell(n, 0, 0)).toBe(-1);
  });
});
