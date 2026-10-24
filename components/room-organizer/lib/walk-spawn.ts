/**
 * Where the walker appears (#463a, #446): on entering EXPLORE, at the
 * entrance door's inside face looking in, rather than nose-first into it;
 * on a floor change while walking, at the top or the foot of the flight
 * that joins the two storeys. Every spot is checked against the walk world
 * and the colliders, so the walker never starts inside a sofa or over the
 * stairwell. Pure; runs once per spawn, not per frame.
 */

import { ENTRANCE_DOOR_ID } from './street';
import { exteriorDoorWall, walkClearance, type ShellBuilding, type WalkCollider } from './walk-collision';
import { walkSurfaceAt, type WalkSurface, type WalkSurfaceKind, type WalkWorld } from './walk-world';
import type { WallId } from './types';

export interface WalkPose {
  x: number;
  z: number;
  /** World Y of the feet. */
  y: number;
  kind: WalkSurfaceKind;
  floorIndex: number;
  /** Unit direction to face; (0, 0) keeps the current heading. */
  dirX: number;
  dirZ: number;
}

export interface WalkSpawnContext {
  world: WalkWorld;
  building: ShellBuilding;
  /** The target storey's colliders: furniture, partitions and shell. */
  colliders: readonly WalkCollider[];
  radius: number;
}

/** How far inside the door the walker stands: a stride in, clear of the swing. */
const INSIDE_DOOR = 0.9;
/** A blocked spot is moved at most this far to the nearest free one. */
const NUDGE_RADIUS = 1.5;
const NUDGE_STEP = 0.15;
const GRID_STEP = 0.25;
/** Room to spare around the walker, so the first step isn't into something. */
const SPAWN_MARGIN = 0.05;

/** Inward normals of the exterior walls; the porch's door looks into the house too (+z). */
const INWARD: Record<WallId, readonly [number, number]> = {
  north: [0, 1],
  south: [0, -1],
  west: [1, 0],
  east: [-1, 0],
};
/** The street is north: a front door there is the entrance, then the others. */
const WALL_PRIORITY: readonly WallId[] = ['north', 'south', 'east', 'west'];

const scratch: WalkSurface = { y: 0, kind: 'floor', floorIndex: 0 };

/** Whether a walker can stand at (x, z) on `floorIndex`'s floor plate. */
function standable(ctx: WalkSpawnContext, floorIndex: number, x: number, z: number): boolean {
  const y = ctx.world.elevations[floorIndex];
  if (y === undefined) return false;
  if (!walkSurfaceAt(ctx.world, x, z, y, 'floor', scratch)) return false;
  if (scratch.kind !== 'floor' || scratch.floorIndex !== floorIndex) return false;
  const inside = Math.abs(x) <= ctx.world.halfWidth && Math.abs(z) <= ctx.world.halfDepth;
  return walkClearance(ctx.colliders, x, z, inside) >= ctx.radius + SPAWN_MARGIN;
}

function pose(ctx: WalkSpawnContext, floorIndex: number, x: number, z: number, dirX: number, dirZ: number): WalkPose {
  return { x, z, y: ctx.world.elevations[floorIndex] ?? 0, kind: 'floor', floorIndex, dirX, dirZ };
}

/** The free spot nearest (x, z) within the nudge radius, or null. */
function nearestFree(
  ctx: WalkSpawnContext,
  floorIndex: number,
  x: number,
  z: number,
  radius = NUDGE_RADIUS
): { x: number; z: number } | null {
  if (standable(ctx, floorIndex, x, z)) return { x, z };
  let best: { x: number; z: number } | null = null;
  let bestDistance = Infinity;
  const reach = Math.ceil(radius / NUDGE_STEP);
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const distance = Math.hypot(i, j) * NUDGE_STEP;
      if (distance > radius || distance >= bestDistance) continue;
      const px = x + i * NUDGE_STEP;
      const pz = z + j * NUDGE_STEP;
      if (!standable(ctx, floorIndex, px, pz)) continue;
      best = { x: px, z: pz };
      bestDistance = distance;
    }
  }
  return best;
}

/** The spot on the storey furthest from anything: the largest free floor cell. */
function roomiest(ctx: WalkSpawnContext, floorIndex: number): { x: number; z: number } | null {
  const { halfWidth, halfDepth } = ctx.world;
  let best: { x: number; z: number } | null = null;
  let bestClearance = -Infinity;
  for (let x = -halfWidth + GRID_STEP; x < halfWidth; x += GRID_STEP) {
    for (let z = -halfDepth + GRID_STEP; z < halfDepth; z += GRID_STEP) {
      if (!standable(ctx, floorIndex, x, z)) continue;
      // Ties go to the spot nearer the middle of the house.
      const clearance = walkClearance(ctx.colliders, x, z, true) - Math.hypot(x, z) * 1e-3;
      if (clearance <= bestClearance) continue;
      best = { x, z };
      bestClearance = clearance;
    }
  }
  return best;
}

function towardCentre(x: number, z: number): [number, number] {
  const length = Math.hypot(x, z);
  return length < 0.5 ? [0, -1] : [-x / length, -z / length];
}

/** The pose at the top of a flight from the storey below, or null. */
function topOfStairs(ctx: WalkSpawnContext, floorIndex: number): WalkPose | null {
  for (const stair of ctx.world.stairsByFloor[floorIndex - 1] ?? []) {
    const spot = nearestFree(ctx, floorIndex, stair.top.x, stair.top.z, 0.6);
    if (spot) return pose(ctx, floorIndex, spot.x, spot.z, stair.top.dirX, stair.top.dirZ);
  }
  return null;
}

/** The pose at the foot of a flight on this storey, facing away from it, or null. */
function footOfStairs(ctx: WalkSpawnContext, floorIndex: number): WalkPose | null {
  for (const stair of ctx.world.stairsByFloor[floorIndex] ?? []) {
    const spot = nearestFree(ctx, floorIndex, stair.foot.x, stair.foot.z, 0.6);
    if (spot) return pose(ctx, floorIndex, spot.x, spot.z, stair.foot.dirX, stair.foot.dirZ);
  }
  return null;
}

/**
 * Where the walker starts on `floorIndex` (#463a): just inside the entrance
 * door, looking in (the porch's door, else a front door, else any exterior
 * door); else at the top of the stairs up from the storey below; else in
 * the roomiest spot, facing the middle of the house.
 */
export function walkSpawn(ctx: WalkSpawnContext, floorIndex: number): WalkPose {
  const floor = ctx.building.floors[floorIndex];
  const doors: Array<{ x: number; z: number; normal: readonly [number, number]; rank: number }> = [];
  for (const item of floor?.items ?? []) {
    if (item.type !== 'door' || !item.position) continue;
    if (item.id === ENTRANCE_DOOR_ID) {
      doors.push({ ...item.position, normal: INWARD.north, rank: -1 });
      continue;
    }
    const wall = exteriorDoorWall(item, floor?.interiorWalls ?? [], ctx.building.width, ctx.building.depth);
    if (wall) doors.push({ ...item.position, normal: INWARD[wall], rank: WALL_PRIORITY.indexOf(wall) });
  }
  doors.sort((a, b) => a.rank - b.rank);
  for (const door of doors) {
    const [nx, nz] = door.normal;
    const spot = nearestFree(ctx, floorIndex, door.x + nx * INSIDE_DOOR, door.z + nz * INSIDE_DOOR);
    if (spot) return pose(ctx, floorIndex, spot.x, spot.z, nx, nz);
  }
  const landing = topOfStairs(ctx, floorIndex);
  if (landing) return landing;
  const spot = roomiest(ctx, floorIndex) ?? { x: 0, z: 0 };
  const [dirX, dirZ] = towardCentre(spot.x, spot.z);
  return pose(ctx, floorIndex, spot.x, spot.z, dirX, dirZ);
}

/**
 * Where the walker lands after a floor change it didn't walk (PgUp/PgDn, the
 * floor pills): going up, at the top of the stairs; going down, at the foot
 * of the flight it would have come down, facing away from it. Otherwise it
 * keeps its place and heading when that spot is free on the new storey,
 * and falls back to `walkSpawn`.
 */
export function walkArrival(
  ctx: WalkSpawnContext,
  floorIndex: number,
  fromFloorIndex: number,
  near: { x: number; z: number }
): WalkPose {
  const viaStairs = floorIndex > fromFloorIndex ? topOfStairs(ctx, floorIndex) : footOfStairs(ctx, floorIndex);
  if (viaStairs) return viaStairs;
  const spot = nearestFree(ctx, floorIndex, near.x, near.z);
  if (spot) return pose(ctx, floorIndex, spot.x, spot.z, 0, 0);
  return walkSpawn(ctx, floorIndex);
}
