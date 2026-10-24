import { describe, expect, it } from 'vitest';
import { ENTRANCE_DOOR_ID } from './street';
import { buildShellColliders, buildWalkColliders, walkClearance, type ShellBuilding } from './walk-collision';
import { walkArrival, walkSpawn, type WalkSpawnContext } from './walk-spawn';
import { buildWalkWorld } from './walk-world';
import type { FurnitureItem } from './types';

const RADIUS = 0.3;

function item(overrides: Partial<FurnitureItem> & { type: string; position: { x: number; z: number } }): FurnitureItem {
  return { id: overrides.type, name: overrides.type, width: 1, depth: 1, height: 1, color: '#000', icon: '', rotation: 0, ...overrides };
}

const STAIRS = item({ id: 'stairs', type: 'stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 3.2, z: 0.3 } });
const door = (id: string, x: number, z: number) =>
  item({ id, type: 'door', width: 0.9, depth: 0.12, height: 2.05, position: { x, z } });

function context(building: ShellBuilding, floorIndex: number): WalkSpawnContext {
  const floor = building.floors[floorIndex]!;
  return {
    world: buildWalkWorld(building),
    building,
    colliders: [
      ...buildWalkColliders(floor.items, floor.interiorWalls ?? [], { roomWidth: building.width, roomDepth: building.depth, stairsAsRamps: true }),
      ...buildShellColliders(building, floorIndex),
    ],
    radius: RADIUS,
  };
}

const house = (ground: FurnitureItem[], upper: FurnitureItem[] = []): ShellBuilding => ({
  width: 8,
  depth: 8,
  floors: [{ items: ground }, { items: upper }],
});

describe('walkSpawn — room-aware spawn (#463a)', () => {
  it('starts just inside the front door, looking into the house', () => {
    const spawn = walkSpawn(context(house([door('front', 0, -4)]), 0), 0);
    expect(spawn.x).toBeCloseTo(0, 6);
    expect(spawn.z).toBeCloseTo(-4 + 0.9, 6);
    expect([spawn.dirX, spawn.dirZ]).toEqual([0, 1]);
    expect(spawn.floorIndex).toBe(0);
  });

  it('prefers the street door to a garden door', () => {
    const spawn = walkSpawn(context(house([door('back', 1, 4), door('front', -1, -4)]), 0), 0);
    expect(spawn.x).toBeCloseTo(-1, 6);
    expect(spawn.dirZ).toBe(1);
  });

  it('a garden door alone faces north into the house', () => {
    const spawn = walkSpawn(context(house([door('back', 1, 4)]), 0), 0);
    expect(spawn.z).toBeCloseTo(3.1, 6);
    expect(spawn.dirZ).toBe(-1);
  });

  it('steps round furniture blocking the door', () => {
    const sofa = item({ id: 'sofa', type: 'sofa', width: 2, depth: 0.9, height: 0.8, position: { x: 0, z: -3.1 } });
    const ctx = context(house([door('front', 0, -4), sofa]), 0);
    const spawn = walkSpawn(ctx, 0);
    expect(walkClearance(ctx.colliders, spawn.x, spawn.z, true)).toBeGreaterThanOrEqual(RADIUS);
    expect(Math.hypot(spawn.x, spawn.z - -3.1)).toBeLessThanOrEqual(1.5 + 1e-9);
  });

  it("uses the porch's door, inside the hall", () => {
    const building: ShellBuilding = {
      width: 8,
      depth: 8,
      entrance: { width: 1.4, depth: 1.2 },
      floors: [{ items: [door(ENTRANCE_DOOR_ID, 0, -2.8)], interiorWalls: [{ id: 'entrance-back', x1: -0.7, z1: -2.8, x2: 0.7, z2: -2.8 }] }],
    };
    const spawn = walkSpawn(context(building, 0), 0);
    expect(spawn.z).toBeCloseTo(-1.9, 6);
    expect(spawn.dirZ).toBe(1);
  });

  it('with no door, takes the roomiest spot and faces the middle', () => {
    const table = item({ id: 'table', type: 'table', width: 2, depth: 2, height: 0.8, position: { x: 0, z: 0 } });
    const ctx = context(house([table]), 0);
    const spawn = walkSpawn(ctx, 0);
    expect(walkClearance(ctx.colliders, spawn.x, spawn.z, true)).toBeGreaterThan(1);
    // Facing roughly back toward the centre.
    expect(spawn.dirX * -spawn.x + spawn.dirZ * -spawn.z).toBeGreaterThan(0);
  });

  it('upstairs, arrives at the top of the stairs looking on', () => {
    const spawn = walkSpawn(context(house([STAIRS]), 1), 1);
    expect(spawn.floorIndex).toBe(1);
    expect(spawn.y).toBe(3);
    expect(spawn.x).toBeCloseTo(3.2, 1);
    expect(spawn.z).toBeGreaterThan(1.5);
    expect(spawn.dirZ).toBeCloseTo(1, 6);
  });
});

describe('walkArrival — floor changes while walking (#446)', () => {
  const building = house([STAIRS]);

  it('PgUp lands at the top of the flight', () => {
    const arrival = walkArrival(context(building, 1), 1, 0, { x: -2, z: -2 });
    expect(arrival.z).toBeGreaterThan(1.5);
    expect(arrival.y).toBe(3);
  });

  it('PgDn lands at the foot of the flight, facing away from it', () => {
    const arrival = walkArrival(context(building, 0), 0, 1, { x: -2, z: -2 });
    expect(arrival.z).toBeLessThan(-0.9);
    expect(arrival.dirZ).toBeCloseTo(-1, 6);
    expect(arrival.y).toBe(0);
  });

  it('without stairs, keeps its spot and heading when that is free', () => {
    const arrival = walkArrival(context(house([], []), 1), 1, 0, { x: -2, z: -2 });
    expect([arrival.x, arrival.z, arrival.dirX, arrival.dirZ]).toEqual([-2, -2, 0, 0]);
  });
});
