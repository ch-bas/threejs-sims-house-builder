import { describe, expect, it } from 'vitest';
import { ROOM_TEMPLATES } from './constants';
import { rotatedHalfExtents } from './footprint';
import { snapOpeningToWall } from './opening-snap';
import { buildShellColliders, buildWalkColliders, exteriorDoorWall, walkClearance, type ShellBuilding } from './walk-collision';
import { walkSpawn, type WalkSpawnContext } from './walk-spawn';
import { buildWalkWorld } from './walk-world';
import type { FurnitureItem } from './types';

const RADIUS = 0.3;
const templates = Object.entries(ROOM_TEMPLATES);

function shell(template: (typeof ROOM_TEMPLATES)[keyof typeof ROOM_TEMPLATES]): ShellBuilding {
  return { width: template.width, depth: template.height, floors: template.floors };
}

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

describe('templates have doors and windows (#570)', () => {
  it.each(templates)('%s has an exterior door on the ground floor', (_key, template) => {
    const doors = template.floors[0].items.filter((item) => item.type === 'door');
    expect(doors.some((door) => exteriorDoorWall(door, [], template.width, template.height) !== null)).toBe(true);
  });

  it.each(templates)('%s has windows on every storey, on the walls as the snap puts them', (_key, template) => {
    for (const floor of template.floors) {
      const openings = floor.items.filter((item) => item.type === 'window' || item.type === 'door');
      expect(openings.filter((item) => item.type === 'window').length, floor.id).toBeGreaterThan(0);
      for (const opening of openings) {
        const snap = snapOpeningToWall({ position: opening.position!, itemWidth: opening.width, roomWidth: template.width, roomDepth: template.height });
        expect(snap.position, opening.id).toEqual(opening.position);
        expect(Math.abs(Math.sin((snap.rotation - (opening.rotation ?? 0)) / 2)), opening.id).toBeLessThan(1e-9);
      }
    }
  });

  it.each(templates)('%s lets the walker in EXPLORE walk out through the door', (_key, template) => {
    const building = shell(template);
    const ctx = context(building, 0);
    const spawn = walkSpawn(ctx, 0);
    const door = template.floors[0].items.find((item) => item.type === 'door')!.position!;
    // Spawned just inside the door (not at the roomiest-spot fallback)...
    expect(Math.hypot(spawn.x - door.x, spawn.z - door.z)).toBeLessThan(1.2);
    // ...and the straight line from there out through the door is clear.
    const outX = door.x + (door.x - spawn.x) * 0.6;
    const outZ = door.z + (door.z - spawn.z) * 0.6;
    for (let t = 0; t <= 1; t += 0.05) {
      const x = spawn.x + (outX - spawn.x) * t;
      const z = spawn.z + (outZ - spawn.z) * t;
      const inside = Math.abs(x) < template.width / 2 && Math.abs(z) < template.height / 2;
      expect(walkClearance(ctx.colliders, x, z, inside, 0), `t ${t.toFixed(2)}`).toBeGreaterThanOrEqual(RADIUS);
    }
  });
});

/** Pieces whose doors, handles or controls are on local +z. */
const FRONTED: ReadonlySet<string> = new Set(['wardrobe', 'fridge', 'stove', 'kitchen-sink', 'counter', 'bookshelf', 'tv', 'dresser']);
const FRONT_CLEARANCE = 0.5;

/** Distance from the front face of `item` to the exterior wall it faces. */
function roomInFront(item: FurnitureItem, width: number, depth: number): number {
  const dirX = Math.sin(item.rotation ?? 0);
  const dirZ = Math.cos(item.rotation ?? 0);
  const { halfW, halfD } = rotatedHalfExtents(item);
  const { x, z } = item.position!;
  if (Math.abs(dirX) > Math.abs(dirZ)) return dirX > 0 ? width / 2 - (x + halfW) : x - halfW + width / 2;
  return dirZ > 0 ? depth / 2 - (z + halfD) : z - halfD + depth / 2;
}

/** Whether another standing piece blocks the strip in front of `item`. */
function blockedInFront(item: FurnitureItem, others: readonly FurnitureItem[]): FurnitureItem | undefined {
  const dirX = Math.round(Math.sin(item.rotation ?? 0));
  const dirZ = Math.round(Math.cos(item.rotation ?? 0));
  const { halfW, halfD } = rotatedHalfExtents(item);
  const { x, z } = item.position!;
  const strip =
    dirX !== 0
      ? { x0: dirX > 0 ? x + halfW : x - halfW - FRONT_CLEARANCE, x1: dirX > 0 ? x + halfW + FRONT_CLEARANCE : x - halfW, z0: z - halfD, z1: z + halfD }
      : { x0: x - halfW, x1: x + halfW, z0: dirZ > 0 ? z + halfD : z - halfD - FRONT_CLEARANCE, z1: dirZ > 0 ? z + halfD + FRONT_CLEARANCE : z - halfD };
  return others.find((other) => {
    if (other.id === item.id || !other.position || other.type === 'door' || other.type === 'window' || other.height < 0.1) return false;
    const e = rotatedHalfExtents(other);
    const eps = 1e-6;
    return (
      other.position.x + e.halfW > strip.x0 + eps &&
      other.position.x - e.halfW < strip.x1 - eps &&
      other.position.z + e.halfD > strip.z0 + eps &&
      other.position.z - e.halfD < strip.z1 - eps
    );
  });
}

describe('template fronts face the room (#575)', () => {
  it.each(templates)('%s: wardrobes, appliances and shelves open onto free floor', (_key, template) => {
    for (const floor of template.floors) {
      for (const item of floor.items) {
        if (!FRONTED.has(item.type)) continue;
        expect(roomInFront(item, template.width, template.height), `${floor.id}/${item.id}`).toBeGreaterThanOrEqual(FRONT_CLEARANCE);
        expect(blockedInFront(item, floor.items)?.id, `${floor.id}/${item.id}`).toBeUndefined();
      }
    }
  });
});
