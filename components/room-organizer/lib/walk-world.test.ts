import { describe, expect, it } from 'vitest';
import { stairSteps, stairToWorld } from './stairs';
import {
  advanceWalker,
  buildShellColliders,
  buildStreetColliders,
  buildWalkColliders,
  exteriorDoorWall,
  streetSiteOf,
  type WalkCollider,
  type WalkerState,
} from './walk-collision';
import { buildWalkWorld, eyeOffsetForStorey, walkSurfaceAt, type WalkBuilding, type WalkSurface } from './walk-world';
import type { FloorLayout, FurnitureItem, InteriorWall } from './types';

const RADIUS = 0.3;

function item(overrides: Partial<FurnitureItem> & { type: string; position: { x: number; z: number } }): FurnitureItem {
  return {
    id: overrides.type,
    name: overrides.type,
    width: 1,
    depth: 1,
    height: 1,
    color: '#000',
    icon: '',
    rotation: 0,
    ...overrides,
  };
}

/** Straight 1.2 × 2.4 flight against the east wall, climbing +z from z = -0.9 to 1.5. */
const STAIRS = item({ id: 'stairs', type: 'stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 3.2, z: 0.3 } });
const SOUTH_DOOR = item({ id: 'door-s', type: 'door', width: 0.9, depth: 0.12, height: 2.05, position: { x: 0, z: 4 }, rotation: Math.PI });

type Floor = Pick<FloorLayout, 'height' | 'items' | 'hiddenWalls' | 'interiorWalls'>;

function building(
  ground: FurnitureItem[],
  upper: FurnitureItem[] = [],
  extra: Partial<Omit<WalkBuilding, 'floors'>> = {}
): WalkBuilding & { floors: Floor[] } {
  return { width: 8, depth: 8, ...extra, floors: [{ items: ground }, { items: upper }] };
}

function colliders(b: WalkBuilding & { floors: Floor[] }, floorIndex: number): WalkCollider[] {
  const floor = b.floors[floorIndex]!;
  return [
    ...buildWalkColliders(floor.items, floor.interiorWalls ?? [], { roomWidth: b.width, roomDepth: b.depth, stairsAsRamps: true }),
    ...buildShellColliders(b, floorIndex),
  ];
}

function walker(x: number, z: number, y = 0, floorIndex = 0, kind: WalkerState['kind'] = 'floor'): WalkerState {
  return { x, z, y, kind, floorIndex };
}

/** Walk in frames of `frame` metres toward (dx, dz), as the RAF loop would. */
function walk(b: WalkBuilding & { floors: Floor[] }, w: WalkerState, dx: number, dz: number, frame = 0.05): WalkerState {
  const world = buildWalkWorld(b);
  const length = Math.hypot(dx, dz);
  const frames = Math.ceil(length / frame);
  for (let i = 0; i < frames; i++) {
    advanceWalker(world, colliders(b, w.floorIndex), w, (dx / length) * frame, (dz / length) * frame, RADIUS);
  }
  return w;
}

describe('walk world — stairs as a ramp (#446)', () => {
  const house = building([STAIRS]);

  it('climbs the flight tread by tread and steps off onto the storey above', () => {
    const world = buildWalkWorld(house);
    const w = walker(3.2, -1.5);
    const heights: number[] = [];
    for (let i = 0; i < 80; i++) {
      advanceWalker(world, colliders(house, w.floorIndex), w, 0, 0.05, RADIUS);
      heights.push(w.y);
    }
    // Never a drop on the way up, and every rise is one riser at most.
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!).toBeGreaterThanOrEqual(heights[i - 1]!);
      expect(heights[i]! - heights[i - 1]!).toBeLessThanOrEqual(3 / 14 + 1e-9);
    }
    expect(w.z).toBeGreaterThan(1.5);
    expect(w.y).toBeCloseTo(3, 6);
    expect(w.kind).toBe('floor');
    expect(w.floorIndex).toBe(1);
  });

  it('belongs to the lower storey while on a tread: the floor switches at the landing', () => {
    const w = walk(house, walker(3.2, -1.5), 0, 1.5);
    expect(w.kind).toBe('tread');
    expect(w.floorIndex).toBe(0);
    expect(w.y).toBeGreaterThan(0.5);
    expect(w.y).toBeLessThan(3);
  });

  it('walks back down from the storey above to the foot', () => {
    const w = walk(house, walker(3.2, 2.5, 3, 1), 0, -4);
    expect(w.y).toBe(0);
    expect(w.kind).toBe('floor');
    expect(w.floorIndex).toBe(0);
    expect(w.z).toBeLessThan(-0.9);
  });

  it("can't step onto the flight from the side half-way up", () => {
    const w = walk(house, walker(1.8, 0.8), 2, 0);
    expect(w.x).toBeLessThan(2.6);
    expect(w.y).toBe(0);
  });

  it("can't walk off the landing into the stairwell", () => {
    const w = walk(house, walker(1.8, 0.5, 3, 1), 2, 0);
    expect(w.x).toBeLessThan(2.6);
    expect(w.y).toBe(3);
    expect(w.floorIndex).toBe(1);
  });

  it('keeps the floor above solid over the foot of the flight (headroom cut only)', () => {
    const world = buildWalkWorld(house);
    const out: WalkSurface = { y: 0, kind: 'floor', floorIndex: 0 };
    // Over tread 0 the storey above is still there.
    expect(walkSurfaceAt(world, 3.2, -0.85, 3, 'floor', out)).toBe(true);
    expect(out).toEqual({ y: 3, kind: 'floor', floorIndex: 1 });
    // Over the top tread it is cut away; the tread is level with the landing.
    expect(walkSurfaceAt(world, 3.2, 1.45, 3, 'floor', out)).toBe(true);
    expect(out).toEqual({ y: 3, kind: 'tread', floorIndex: 0 });
  });

  it('climbs a winder round its fan', () => {
    const winder = { ...STAIRS, width: 2, depth: 2.6, stairsShape: 'winder' as const, position: { x: 2.8, z: 0 } };
    const house2 = building([winder]);
    const world = buildWalkWorld(house2);
    const toWorld = stairToWorld(winder, winder.position);
    const line = stairSteps(winder, 3).map((step) => {
      const n = step.outline.length;
      return toWorld(
        step.outline.reduce((sum, [x]) => sum + x / n, 0),
        step.outline.reduce((sum, [, z]) => sum + z / n, 0)
      );
    });
    const [footX, footZ] = line[0]!;
    const w = walker(footX, footZ - 0.6);
    // Follow the walk line through every tread centre, then off the top.
    const [lastX, lastZ] = line[line.length - 1]!;
    const [prevX, prevZ] = line[line.length - 2]!;
    const route = [...line, [lastX + (lastX - prevX) * 4, lastZ + (lastZ - prevZ) * 4] as [number, number]];
    for (const [tx, tz] of route) {
      for (let i = 0; i < 40 && Math.hypot(tx - w.x, tz - w.z) > 0.02; i++) {
        const d = Math.hypot(tx - w.x, tz - w.z);
        const s = Math.min(0.05, d);
        advanceWalker(world, colliders(house2, w.floorIndex), w, ((tx - w.x) / d) * s, ((tz - w.z) / d) * s, RADIUS);
      }
    }
    expect(w.y).toBeCloseTo(3, 6);
    expect(w.floorIndex).toBe(1);
  });

  it('takes a 6 m storey’s taller risers', () => {
    const tall = building([STAIRS], [], {});
    tall.floors[0] = { items: [STAIRS], height: 6 };
    const world = buildWalkWorld(tall);
    expect(world.maxStep).toBeGreaterThanOrEqual(6 / 14);
    const w = walk(tall, walker(3.2, -1.5), 0, 3.6);
    expect(w.y).toBeCloseTo(6, 6);
    expect(w.floorIndex).toBe(1);
  });
});

describe('walk world — doors and the lot (#446)', () => {
  it('steps out through an exterior door onto the lot', () => {
    const w = walk(building([SOUTH_DOOR]), walker(0, 3), 0, 3);
    expect(w.z).toBeCloseTo(6, 1);
    expect(w.kind).toBe('ground');
    expect(w.y).toBe(0);
    // Outside keeps the storey it came from.
    expect(w.floorIndex).toBe(0);
  });

  it('comes back in through the same door', () => {
    const w = walk(building([SOUTH_DOOR]), walker(0, 6, 0, 0, 'ground'), 0, -3);
    expect(w.z).toBeCloseTo(3, 1);
    expect(w.kind).toBe('floor');
  });

  it('stops at a wall without a door, 0.35 m off it like the old footprint clamp', () => {
    const w = walk(building([]), walker(0, 3), 0, 3);
    expect(w.z).toBeCloseTo(4 - 0.35, 3);
  });

  it('walks through a hidden wall', () => {
    const b = building([]);
    b.floors[0] = { items: [], hiddenWalls: ['south'] };
    const w = walk(b, walker(0, 3), 0, 3);
    expect(w.z).toBeGreaterThan(5.9);
  });

  it("won't step out of an upper-storey door into mid-air", () => {
    const upperDoor = { ...SOUTH_DOOR, id: 'door-up' };
    const w = walk(building([], [upperDoor]), walker(0, 3, 3, 1), 0, 3);
    expect(w.z).toBeLessThan(4.01);
    expect(w.y).toBe(3);
  });

  it('follows the slope of the site outside', () => {
    const b = building([SOUTH_DOOR], [], { terrain: { frontY: 0, backY: -0.6 } });
    const w = walk(b, walker(0, 3), 0, 4);
    expect(w.kind).toBe('ground');
    expect(w.y).toBeCloseTo(-0.6, 6);
  });

  it('stops at the edge of the lot', () => {
    const b = building([SOUTH_DOOR]);
    const world = buildWalkWorld(b);
    const w = walk(b, walker(0, 3), 0, 60, 0.25);
    expect(w.z).toBeLessThanOrEqual(world.lotHalfSize);
    expect(w.z).toBeGreaterThan(world.lotHalfSize - 0.3);
  });

  it('an interior-wall door is not an exterior one', () => {
    const wall: InteriorWall = { id: 'w', x1: -4, z1: 3.8, x2: 4, z2: 3.8 };
    expect(exteriorDoorWall(SOUTH_DOOR, [], 8, 8)).toBe('south');
    expect(exteriorDoorWall({ ...SOUTH_DOOR, position: { x: 0, z: 3.85 } }, [wall], 8, 8)).toBeNull();
    expect(exteriorDoorWall({ ...SOUTH_DOOR, position: { x: 0, z: 0 } }, [], 8, 8)).toBeNull();
  });
});

describe('walk world — the porch (#446)', () => {
  // Street 0.5 m below the ground floor: three steps down from the porch.
  const porchHouse = building([], [], { entrance: { width: 1.4, depth: 1.2 }, terrain: { frontY: -0.5, backY: 0 } });

  it('the recess is outside, level with the floor, and its steps go down to the street', () => {
    const world = buildWalkWorld(porchHouse);
    const out: WalkSurface = { y: 0, kind: 'floor', floorIndex: 0 };
    expect(walkSurfaceAt(world, 0, -3.5, 0, 'floor', out)).toBe(true);
    expect(out.kind).toBe('ground');
    expect(out.y).toBe(0);
    // The plinth ledge, then each step lower toward the street.
    expect(walkSurfaceAt(world, 0, -4.2, 0, 'ground', out)).toBe(true);
    expect(out.y).toBe(0);
    const ys: number[] = [];
    for (let z = -4.4; z > -5.5; z -= 0.28) {
      expect(walkSurfaceAt(world, 0, z, ys.length ? ys[ys.length - 1]! : 0, 'ground', out)).toBe(true);
      ys.push(out.y);
    }
    expect(ys[ys.length - 1]).toBeCloseTo(-0.5, 6);
  });

  it('the front wall is open across the recess and the reveals close its sides', () => {
    const shell = buildShellColliders(porchHouse, 0);
    // Walk north out of the recess to the street.
    const w = walk(porchHouse, walker(0, -3.4, 0, 0, 'ground'), 0, -3);
    expect(w.z).toBeLessThan(-6);
    expect(w.y).toBeCloseTo(-0.5, 6);
    // From inside the recess, sideways into a reveal: stopped.
    const side = walk(porchHouse, walker(0, -3.4, 0, 0, 'ground'), 2, 0);
    expect(side.x).toBeLessThan(0.7);
    expect(shell.length).toBeGreaterThan(4);
  });
});

describe('walk world — the street (#446)', () => {
  it('builds a solid block for every neighbour', () => {
    const b = { ...building([]), neighbours: { west: true, east: true } };
    const boxes = buildStreetColliders(streetSiteOf(b));
    expect(boxes.length).toBe(2);
    expect(boxes.every((box) => box.outdoor)).toBe(true);
    expect(Math.min(...boxes.map((box) => box.cx))).toBeLessThan(-4);
    expect(Math.max(...boxes.map((box) => box.cx))).toBeGreaterThan(4);
  });

  it('builds none without neighbours', () => {
    expect(buildStreetColliders(streetSiteOf(building([])))).toEqual([]);
  });
});

describe('eyeOffsetForStorey', () => {
  it('is 1.6 m, ducking under a low ceiling', () => {
    expect(eyeOffsetForStorey(3)).toBe(1.6);
    expect(eyeOffsetForStorey(1.1)).toBeCloseTo(0.9, 9);
  });
});
