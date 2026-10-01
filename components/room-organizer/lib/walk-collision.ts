/**
 * Walkthrough collision (#156): the first-person walker is a circle in the XZ
 * plane that must not pass through furniture or interior walls. Everything
 * solid is reduced to an oriented box — furniture via the same rotated-rect
 * convention as `lib/geometry`, an interior wall as a box along its segment
 * with the partition's thickness — and the walker is pushed out of whichever
 * boxes it overlaps, sliding along their faces rather than stopping dead.
 *
 * The footprint clamp in `hooks/use-walkthrough.ts` remains the outer guard:
 * exterior walls are never colliders here.
 */

import { isWallHung } from './mount-band';
import { interiorWallOpeningSpan, isWallMounted } from './opening-snap';
import type { FurnitureItem, InteriorWall, Vec2 } from './types';

/** One solid box in the XZ plane, in the `lib/geometry` OBB convention. */
export interface WalkCollider {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  /** Unit axis of the width dimension. */
  ax: number;
  az: number;
  /** Unit axis of the depth dimension. */
  bx: number;
  bz: number;
  /** Rotation-aware AABB half-extents — the cheap broad-phase reject. */
  aabbHalfW: number;
  aabbHalfD: number;
  /** Outdoor items only block a walker who is outside the room. */
  outdoor: boolean;
}

export interface WalkerPosition {
  x: number;
  z: number;
}

export interface WalkCollisionOptions {
  /**
   * Room footprint (metres). Decides whether the walker is inside the room
   * (outdoor items are then ignored) and which wall a door belongs to when it
   * sits at a junction of an interior and an exterior wall.
   */
  roomWidth?: number;
  roomDepth?: number;
}

/**
 * Interior walls are modelled 0.16 m thick (three/interior-walls.ts owns the
 * authoritative constant); the walker must not sink into that slab.
 */
const INTERIOR_WALL_THICKNESS = 0.16;

/**
 * Anything at or under this height goes UNDER furniture by design (rugs are
 * 0.02 m) — the walker steps over it. Mirrors the collision indicator's
 * low-profile layer in `lib/geometry` (#120).
 */
const LOW_PROFILE_MAX_HEIGHT = 0.05;

/**
 * A door is a passable gap in the wall that owns it. Ownership follows the
 * renderer's cut rule (three/wall-openings.ts): the nearest wall within its
 * threshold, so a door at a junction is never cut from two walls.
 */
const INTERIOR_DOOR_THRESHOLD = 0.4;
const EXTERIOR_DOOR_THRESHOLD = 0.6;
/** Solid wall runs shorter than this are dropped. */
const MIN_RUN_LENGTH = 1e-3;

/**
 * Overshoot on every push-out so the walker settles just clear of the surface
 * and is not re-detected on the next frame (jitter).
 */
const SEPARATION_EPSILON = 1e-4;
/**
 * A move longer than this fraction of the radius is split into substeps so
 * the walker can never cross a thin box's centreline in one go and be pushed
 * out the far side (tunnelling).
 */
const SUBSTEP_FRACTION = 0.5;
const MAX_SUBSTEPS = 64;
/** Push-out passes per axis: a push clear of one box may land in a neighbour. */
const RESOLVE_PASSES = 2;

/**
 * Build the walker's colliders for a floor. Call when the items or walls
 * change — not per frame — and feed the result to `resolveWalkerStep`.
 *
 * Skipped: unplaced items, low-profile items (rugs), wall-plane items
 * (doors, windows, cameras — they live in the wall, and a door is a gap),
 * wall-hung decor (a painting or clock hangs on the wall above the walker's
 * path, #376).
 * Outdoor items are kept but flagged so the resolver can ignore them while
 * the walker is inside the room.
 */
export function buildWalkColliders(
  items: readonly FurnitureItem[],
  interiorWalls: readonly InteriorWall[],
  options: WalkCollisionOptions = {}
): WalkCollider[] {
  const colliders: WalkCollider[] = [];
  for (const item of items) {
    if (!item.position) continue;
    if (isWallMounted(item.type) || isWallHung(item.type)) continue;
    if (item.height <= LOW_PROFILE_MAX_HEIGHT) continue;
    colliders.push(
      boxCollider(
        item.position.x,
        item.position.z,
        item.width,
        item.depth,
        item.rotation ?? 0,
        item.category === 'outdoor'
      )
    );
  }

  const doorOwners = classifyDoorOwners(items, interiorWalls, options);
  for (const wall of interiorWalls) {
    const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
    if (length < MIN_RUN_LENGTH) continue;
    const ux = (wall.x2 - wall.x1) / length;
    const uz = (wall.z2 - wall.z1) / length;
    const cx = (wall.x1 + wall.x2) / 2;
    const cz = (wall.z1 + wall.z2) / 2;
    // Three's rotY convention (see lib/geometry toObb): a wall running along
    // (ux, uz) is an item rotated by -atan2(uz, ux).
    const rotation = -Math.atan2(uz, ux);
    for (const [from, to] of solidRuns(wall, length, items, doorOwners)) {
      const mid = (from + to) / 2;
      colliders.push(
        boxCollider(cx + ux * mid, cz + uz * mid, to - from, INTERIOR_WALL_THICKNESS, rotation, false)
      );
    }
  }
  return colliders;
}

function boxCollider(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  rotation: number,
  outdoor: boolean
): WalkCollider {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // lib/geometry's rotatedHalfExtents, inlined: geometry builds its interior
  // wall boxes from this module, so importing it back would be a cycle.
  const halfW = (width * Math.abs(cos) + depth * Math.abs(sin)) / 2;
  const halfD = (width * Math.abs(sin) + depth * Math.abs(cos)) / 2;
  return {
    cx,
    cz,
    hw: width / 2,
    hd: depth / 2,
    ax: cos,
    az: -sin,
    bx: sin,
    bz: cos,
    aabbHalfW: halfW,
    aabbHalfD: halfD,
    outdoor,
  };
}

/** Door id → id of the interior wall that owns it (exterior-owned doors omitted). */
function classifyDoorOwners(
  items: readonly FurnitureItem[],
  interiorWalls: readonly InteriorWall[],
  options: WalkCollisionOptions
): Map<string, string> {
  const owners = new Map<string, string>();
  const { roomWidth, roomDepth } = options;
  for (const item of items) {
    if (item.type !== 'door' || !item.position) continue;
    const { x, z } = item.position;
    let bestId: string | null = null;
    let bestDistance = Infinity;
    for (const wall of interiorWalls) {
      const distance = distanceToSegment(x, z, wall.x1, wall.z1, wall.x2, wall.z2);
      if (distance > INTERIOR_DOOR_THRESHOLD || distance >= bestDistance) continue;
      bestId = wall.id;
      bestDistance = distance;
    }
    if (bestId === null) continue;
    if (roomWidth !== undefined && roomDepth !== undefined && Number.isFinite(roomWidth + roomDepth)) {
      const hw = roomWidth / 2;
      const hd = roomDepth / 2;
      const exteriorDistance = Math.min(
        distanceToSegment(x, z, -hw, -hd, hw, -hd),
        distanceToSegment(x, z, -hw, hd, hw, hd),
        distanceToSegment(x, z, -hw, -hd, -hw, hd),
        distanceToSegment(x, z, hw, -hd, hw, hd)
      );
      if (exteriorDistance <= EXTERIOR_DOOR_THRESHOLD && exteriorDistance < bestDistance) continue;
    }
    owners.set(item.id, bestId);
  }
  return owners;
}

/**
 * The solid stretches of a wall, as `[from, to]` offsets from the segment
 * midpoint, once every door it owns has been cut out of it.
 */
function solidRuns(
  wall: InteriorWall,
  length: number,
  items: readonly FurnitureItem[],
  doorOwners: ReadonlyMap<string, string>
): Array<[number, number]> {
  const half = length / 2;
  const gaps: Array<[number, number]> = [];
  if (doorOwners.size > 0) {
    for (const item of items) {
      if (doorOwners.get(item.id) !== wall.id || !item.position) continue;
      // The renderer's cut exactly: a door lying past the end cuts nothing (#399).
      const span = interiorWallOpeningSpan(wall, { width: item.width, position: item.position });
      if (!span) continue;
      gaps.push([span.centre - span.width / 2, span.centre + span.width / 2]);
    }
  }
  if (gaps.length === 0) return [[-half, half]];
  gaps.sort((a, b) => a[0] - b[0]);
  const runs: Array<[number, number]> = [];
  let cursor = -half;
  for (const [gapFrom, gapTo] of gaps) {
    if (gapFrom - cursor >= MIN_RUN_LENGTH) runs.push([cursor, gapFrom]);
    cursor = Math.max(cursor, gapTo);
  }
  if (half - cursor >= MIN_RUN_LENGTH) runs.push([cursor, half]);
  return runs;
}

function distanceToSegment(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
  const vx = x2 - x1;
  const vz = z2 - z1;
  const lengthSquared = vx * vx + vz * vz;
  if (lengthSquared < 1e-9) return Math.hypot(px - x1, pz - z1);
  const t = Math.max(0, Math.min(1, ((px - x1) * vx + (pz - z1) * vz) / lengthSquared));
  return Math.hypot(px - (x1 + t * vx), pz - (z1 + t * vz));
}

/**
 * Advance the walker from `from` toward `to` against prebuilt colliders and
 * write the position it actually reaches into `out` (which is also returned).
 * Allocation-free, so the walkthrough RAF loop can call it every frame.
 *
 * The move is split into substeps no longer than half the radius (no
 * tunnelling through a thin wall), and within each substep the X and Z
 * components are applied and resolved separately, so a diagonal push into a
 * face slides along it and a brushed corner never sticks. A walker that
 * already overlaps a box (a floor switch, furniture dropped on it) is pushed
 * out through the nearest face.
 */
export function resolveWalkerStep(
  colliders: readonly WalkCollider[],
  from: Readonly<WalkerPosition>,
  to: Readonly<WalkerPosition>,
  radius: number,
  out: WalkerPosition,
  options: WalkCollisionOptions = {}
): WalkerPosition {
  const insideRoom = walkerInsideRoom(from, options);
  const totalX = to.x - from.x;
  const totalZ = to.z - from.z;
  const distance = Math.hypot(totalX, totalZ);
  const steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(distance / (radius * SUBSTEP_FRACTION))));
  const stepX = totalX / steps;
  const stepZ = totalZ / steps;

  out.x = from.x;
  out.z = from.z;
  for (let i = 0; i < steps; i++) {
    out.x += stepX;
    pushOut(colliders, out, radius, insideRoom);
    out.z += stepZ;
    pushOut(colliders, out, radius, insideRoom);
  }
  return out;
}

/**
 * Convenience wrapper for callers that don't cache colliders: build them from
 * the floor's items and walls and resolve one move. Returns a new position.
 */
export function resolveWalkerPosition(
  from: Vec2,
  to: Vec2,
  radius: number,
  items: readonly FurnitureItem[],
  interiorWalls: readonly InteriorWall[],
  options: WalkCollisionOptions = {}
): WalkerPosition {
  const colliders = buildWalkColliders(items, interiorWalls, options);
  return resolveWalkerStep(colliders, from, to, radius, { x: from.x, z: from.z }, options);
}

function walkerInsideRoom(position: Readonly<WalkerPosition>, options: WalkCollisionOptions): boolean {
  const { roomWidth, roomDepth } = options;
  if (roomWidth === undefined || roomDepth === undefined) return false;
  return Math.abs(position.x) <= roomWidth / 2 && Math.abs(position.z) <= roomDepth / 2;
}

function pushOut(
  colliders: readonly WalkCollider[],
  position: WalkerPosition,
  radius: number,
  insideRoom: boolean
): void {
  for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
    let moved = false;
    for (const box of colliders) {
      if (box.outdoor && insideRoom) continue;
      if (pushOutOfBox(box, position, radius)) moved = true;
    }
    if (!moved) return;
  }
}

/**
 * Circle-vs-OBB minimum-translation push. Works in the box's local frame:
 * outside the box the push is along the vector from the closest surface point
 * to the circle centre; a centre inside the box leaves through its nearest
 * face. Returns true when the position was changed.
 */
function pushOutOfBox(box: WalkCollider, position: WalkerPosition, radius: number): boolean {
  const dx = position.x - box.cx;
  const dz = position.z - box.cz;
  // Broad phase: rotation-aware AABB, grown by the radius.
  if (Math.abs(dx) >= box.aabbHalfW + radius || Math.abs(dz) >= box.aabbHalfD + radius) return false;

  const lx = dx * box.ax + dz * box.az;
  const lz = dx * box.bx + dz * box.bz;
  let pushX: number;
  let pushZ: number;
  if (Math.abs(lx) <= box.hw && Math.abs(lz) <= box.hd) {
    const toFaceX = box.hw - Math.abs(lx);
    const toFaceZ = box.hd - Math.abs(lz);
    if (toFaceX <= toFaceZ) {
      pushX = (lx < 0 ? -1 : 1) * (toFaceX + radius + SEPARATION_EPSILON);
      pushZ = 0;
    } else {
      pushX = 0;
      pushZ = (lz < 0 ? -1 : 1) * (toFaceZ + radius + SEPARATION_EPSILON);
    }
  } else {
    const nx = lx - Math.max(-box.hw, Math.min(box.hw, lx));
    const nz = lz - Math.max(-box.hd, Math.min(box.hd, lz));
    const gap = Math.hypot(nx, nz);
    if (gap >= radius) return false;
    const scale = (radius - gap + SEPARATION_EPSILON) / gap;
    pushX = nx * scale;
    pushZ = nz * scale;
  }
  position.x += pushX * box.ax + pushZ * box.bx;
  position.z += pushX * box.az + pushZ * box.bz;
  return true;
}
