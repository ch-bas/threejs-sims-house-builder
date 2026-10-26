/**
 * Walkthrough collision (#156): the first-person walker is a circle in the XZ
 * plane that must not pass through furniture or interior walls. Everything
 * solid is reduced to an oriented box — furniture via the same rotated-rect
 * convention as `lib/geometry`, an interior wall as a box along its segment
 * with the partition's thickness — and the walker is pushed out of whichever
 * boxes it overlaps, sliding along their faces rather than stopping dead.
 *
 * The exterior walls are colliders too (#446), from `buildShellColliders`:
 * solid runs either side of every exterior door and the porch's opening, so
 * the walker leaves the house through a door and walks the lot outside.
 * `advanceWalker` adds the vertical: it moves a walker with a foot height
 * over the surfaces of `lib/walk-world`, climbing stairs as a ramp.
 */

import { LOW_PROFILE_MAX_HEIGHT, rotatedHalfExtents } from './footprint';
import { isWallHung } from './mount-band';
import { INTERIOR_WALL_THICKNESS, interiorWallOpeningSpan, isWallMounted } from './opening-snap';
import { hasNeighbours } from './site';
import { floorElevation, interiorWallHeight, storeyHeight } from './storeys';
import { entranceGeometry, entranceWallCut } from './street';
import { generateStreet, type StreetSite } from './street-row';
import { FLOOR_HEIGHT_METERS, type FloorLayout, type FurnitureItem, type InteriorWall, type Vec2, type WallId } from './types';
import { walkSurfaceAt, type WalkBuilding, type WalkSurface, type WalkSurfaceKind, type WalkWorld } from './walk-world';

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
  /**
   * World Y span the box blocks (#446): the walker on a flight or another
   * storey passes over or under it. Absent: from the ground to the sky.
   * Only `advanceWalker` reads it.
   */
  bottom?: number;
  top?: number;
  /**
   * A wall (a partition run or the shell): it blocks the view as well as the
   * walker (#566, #590). Furniture blocks the walker but not the view.
   */
  wall?: boolean;
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
  /**
   * Leave stairs out of the colliders: the walkthrough climbs them as a ramp
   * (lib/walk-world) instead of stopping at an opaque box (#446).
   */
  stairsAsRamps?: boolean;
  /**
   * World Y of the storey's floor, and its height: the colliders' vertical
   * span (`bottom`/`top`), so a walker on the stairs passes over the storey
   * below and under the one above (#446). Default: a 3 m storey at 0.
   */
  baseY?: number;
  storeyHeight?: number;
}

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
  const baseY = options.baseY ?? 0;
  const wallTop = baseY + interiorWallHeight({ height: options.storeyHeight ?? FLOOR_HEIGHT_METERS });
  for (const item of items) {
    if (!item.position) continue;
    if (isWallMounted(item.type) || isWallHung(item.type)) continue;
    if (item.height <= LOW_PROFILE_MAX_HEIGHT) continue;
    if (options.stairsAsRamps && item.type === 'stairs') continue;
    colliders.push(
      boxCollider(
        item.position.x,
        item.position.z,
        item.width,
        item.depth,
        item.rotation ?? 0,
        item.category === 'outdoor',
        baseY,
        baseY + item.height
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
      colliders.push({
        ...boxCollider(cx + ux * mid, cz + uz * mid, to - from, INTERIOR_WALL_THICKNESS, rotation, false, baseY, wallTop),
        wall: true,
      });
    }
  }
  return colliders;
}

/**
 * An oriented box collider centred at (`cx`, `cz`), its width along the
 * rotated X axis; `bottom`/`top` bound its vertical span when given. Walkers
 * (`lib/npc-path`) build their keep-out boxes with it too, never outdoor.
 */
export function boxCollider(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  rotation: number,
  outdoor: boolean,
  bottom?: number,
  top?: number
): WalkCollider {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const { halfW, halfD } = rotatedHalfExtents({ width, depth, rotation });
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
    ...(bottom !== undefined ? { bottom } : {}),
    ...(top !== undefined ? { top } : {}),
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
  insideRoom: boolean,
  feetY?: number
): void {
  for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
    let moved = false;
    for (const box of colliders) {
      if (box.outdoor && insideRoom) continue;
      if (feetY !== undefined && !blocksAt(box, feetY)) continue;
      if (pushOutOfBox(box, position, radius)) moved = true;
    }
    if (!moved) return;
  }
}

/**
 * The walker's body, feet up: what it steps over (a rug, the top of the
 * storey below seen from a stair) and what it walks under.
 */
const STEP_OVER = LOW_PROFILE_MAX_HEIGHT;
const WALKER_HEIGHT = 1.8;

/** Whether a box's vertical span meets a walker whose feet are at `feetY`. */
function blocksAt(box: WalkCollider, feetY: number): boolean {
  if (box.top !== undefined && box.top <= feetY + STEP_OVER) return false;
  return box.bottom === undefined || box.bottom < feetY + WALKER_HEIGHT;
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

/**
 * Exterior walls are zero-thickness planes (three/room-builder). A 0.1 m
 * slab keeps a 0.3 m walker 0.35 m off them — the old footprint clamp's
 * margin, so the camera's near plane never clips the wall (#67, #446).
 */
const EXTERIOR_WALL_THICKNESS = 0.1;
/** three/entrance.ts REVEAL_THICKNESS: the porch's side walls. */
const PORCH_REVEAL_THICKNESS = 0.12;
/** An exterior opening's cut never runs the wall's full length (three/wall-openings.ts). */
const EXTERIOR_CUT_END_MARGIN = 0.05;

/** The building as the shell colliders read it: per-floor items, hidden walls and partitions. */
export interface ShellBuilding extends WalkBuilding {
  floors: readonly Pick<FloorLayout, 'height' | 'items' | 'hiddenWalls' | 'interiorWalls'>[];
}

interface ExteriorWallLine {
  id: WallId;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

function exteriorWallLines(halfWidth: number, halfDepth: number): ExteriorWallLine[] {
  return [
    { id: 'north', x1: -halfWidth, z1: -halfDepth, x2: halfWidth, z2: -halfDepth },
    { id: 'south', x1: -halfWidth, z1: halfDepth, x2: halfWidth, z2: halfDepth },
    { id: 'west', x1: -halfWidth, z1: -halfDepth, x2: -halfWidth, z2: halfDepth },
    { id: 'east', x1: halfWidth, z1: -halfDepth, x2: halfWidth, z2: halfDepth },
  ];
}

/**
 * The exterior wall a door is cut from, or null when it isn't on one. The
 * renderer's rule (three/wall-openings.ts classifyOpeningOwners): the nearest
 * wall within its threshold, interior partitions included, so a door at a
 * junction belongs to exactly one wall.
 */
export function exteriorDoorWall(
  door: Pick<FurnitureItem, 'type' | 'position'>,
  interiorWalls: readonly InteriorWall[],
  roomWidth: number,
  roomDepth: number
): WallId | null {
  if (door.type !== 'door' || !door.position) return null;
  const { x, z } = door.position;
  let best: WallId | null = null;
  let bestDistance = Infinity;
  for (const wall of exteriorWallLines(roomWidth / 2, roomDepth / 2)) {
    const distance = distanceToSegment(x, z, wall.x1, wall.z1, wall.x2, wall.z2);
    if (distance > EXTERIOR_DOOR_THRESHOLD || distance >= bestDistance) continue;
    best = wall.id;
    bestDistance = distance;
  }
  if (best === null) return null;
  for (const wall of interiorWalls) {
    const distance = distanceToSegment(x, z, wall.x1, wall.z1, wall.x2, wall.z2);
    if (distance <= INTERIOR_DOOR_THRESHOLD && distance < bestDistance) return null;
  }
  return best;
}

/** `[from, to]` with every gap taken out, as the solid runs left. */
function subtractGaps(from: number, to: number, gaps: Array<[number, number]>): Array<[number, number]> {
  gaps.sort((a, b) => a[0] - b[0]);
  const runs: Array<[number, number]> = [];
  let cursor = from;
  for (const [gapFrom, gapTo] of gaps) {
    if (gapFrom - cursor >= MIN_RUN_LENGTH) runs.push([cursor, gapFrom]);
    cursor = Math.max(cursor, gapTo);
  }
  if (to - cursor >= MIN_RUN_LENGTH) runs.push([cursor, to]);
  return runs;
}

/**
 * The house's shell on one storey as walker colliders (#446): each exterior
 * wall the floor shows, solid either side of its doors and of the porch's
 * opening, and the porch's two reveals. A hidden wall isn't there to stop
 * anyone. Build when the storey or its doors change, not per frame.
 */
export function buildShellColliders(building: ShellBuilding, floorIndex: number): WalkCollider[] {
  const floor = building.floors[floorIndex];
  if (!floor) return [];
  const halfWidth = building.width / 2;
  const halfDepth = building.depth / 2;
  const interiorWalls = floor.interiorWalls ?? [];

  let porch: { x0: number; x1: number; frontZ: number; backZ: number } | null = null;
  if (building.entrance) {
    const geometry = entranceGeometry(building.entrance, {
      width: building.width,
      depth: building.depth,
      floors: building.floors,
      ...(building.terrain ? { terrain: building.terrain } : {}),
    });
    const cut = geometry ? entranceWallCut(geometry, building.floors, floorIndex) : null;
    // A cut that starts above the floor (a tall porch's upper storey) is a
    // window onto the soffit, not a way out.
    if (geometry && cut && cut.bottomFromFloor < 0.05) porch = geometry;
  }

  const colliders: WalkCollider[] = [];
  const bottom = floorElevation(building.floors, floorIndex);
  const top = floorElevation(building.floors, floorIndex + 1);
  for (const wall of exteriorWallLines(halfWidth, halfDepth)) {
    if (floor.hiddenWalls?.includes(wall.id)) continue;
    const alongX = wall.z1 === wall.z2;
    const half = alongX ? halfWidth : halfDepth;
    const gaps: Array<[number, number]> = [];
    for (const item of floor.items) {
      if (!item.position || exteriorDoorWall(item, interiorWalls, building.width, building.depth) !== wall.id) continue;
      const width = Math.min(item.width, Math.max(0, half * 2 - EXTERIOR_CUT_END_MARGIN));
      const centre = Math.max(-half + width / 2, Math.min(half - width / 2, alongX ? item.position.x : item.position.z));
      gaps.push([centre - width / 2, centre + width / 2]);
    }
    if (wall.id === 'north' && porch) gaps.push([porch.x0, porch.x1]);
    for (const [from, to] of subtractGaps(-half, half, gaps)) {
      const mid = (from + to) / 2;
      colliders.push({
        ...(alongX
          ? boxCollider(mid, wall.z1, to - from, EXTERIOR_WALL_THICKNESS, 0, false, bottom, top)
          : boxCollider(wall.x1, mid, EXTERIOR_WALL_THICKNESS, to - from, 0, false, bottom, top)),
        wall: true,
      });
    }
  }
  if (porch) {
    const depth = porch.backZ - porch.frontZ;
    const midZ = (porch.frontZ + porch.backZ) / 2;
    colliders.push({ ...boxCollider(porch.x0 - PORCH_REVEAL_THICKNESS / 2, midZ, PORCH_REVEAL_THICKNESS, depth, 0, false, bottom, top), wall: true });
    colliders.push({ ...boxCollider(porch.x1 + PORCH_REVEAL_THICKNESS / 2, midZ, PORCH_REVEAL_THICKNESS, depth, 0, false, bottom, top), wall: true });
  }
  return colliders;
}

/** The street site of a building, as `generateStreet` reads it. */
export function streetSiteOf(building: WalkBuilding & Pick<StreetSite, 'neighbours' | 'roof'>): StreetSite {
  return {
    width: building.width,
    depth: building.depth,
    floorYs: building.floors.map((_floor, index) => floorElevation(building.floors, index)),
    eavesY: floorElevation(building.floors, building.floors.length),
    ...(building.roof ? { roof: building.roof } : {}),
    ...(building.terrain ? { terrain: building.terrain } : {}),
    ...(building.frontage ? { frontage: building.frontage } : {}),
    ...(building.neighbours ? { neighbours: building.neighbours } : {}),
  };
}

/**
 * The neighbours' houses as walker colliders (#446): a walker out on the lot
 * walks round the street, not through it. Each block is its footprint from
 * the same generator the scenery is built from; flagged outdoor, so a walker
 * indoors never tests them.
 */
export function buildStreetColliders(site: StreetSite): WalkCollider[] {
  if (!hasNeighbours(site.neighbours)) return [];
  return generateStreet(site).map((house) => {
    // The house runs back from its street wall, away from the way it faces.
    const backZ = house.frontZ - house.facing * house.depth;
    return boxCollider(house.x, (house.frontZ + backZ) / 2, house.width, house.depth, 0, true);
  });
}

/** A walker with feet: where it stands, on what, and on which storey. */
export interface WalkerState extends WalkerPosition {
  /** World Y of the walker's feet. */
  y: number;
  kind: WalkSurfaceKind;
  /** The storey of the last floor plate or tread stood on (ground outside keeps it). */
  floorIndex: number;
}

const surfaceScratch: WalkSurface = { y: 0, kind: 'floor', floorIndex: 0 };

/**
 * Move a walker by (dx, dz) against the colliders and over the walk world's
 * surfaces (#446), in place. Like `resolveWalkerStep` the move is split into
 * substeps and each axis is resolved alone, so the walker slides; an axis
 * step onto nothing reachable (a flight's side, the stairwell, the lot's
 * edge, a door in mid-air) is taken back, which slides the walker along
 * that edge too. Climbing updates the foot height tread by tread.
 * Allocation-free.
 */
export function advanceWalker(
  world: WalkWorld,
  colliders: readonly WalkCollider[],
  walker: WalkerState,
  dx: number,
  dz: number,
  radius: number
): WalkerState {
  const distance = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(distance / (radius * SUBSTEP_FRACTION))));
  const stepX = dx / steps;
  const stepZ = dz / steps;
  for (let i = 0; i < steps; i++) {
    if (stepX !== 0) advanceAxis(world, colliders, walker, stepX, 0, radius);
    if (stepZ !== 0) advanceAxis(world, colliders, walker, 0, stepZ, radius);
  }
  return walker;
}

function advanceAxis(
  world: WalkWorld,
  colliders: readonly WalkCollider[],
  walker: WalkerState,
  dx: number,
  dz: number,
  radius: number
): void {
  const fromX = walker.x;
  const fromZ = walker.z;
  const insideRoom = Math.abs(fromX) <= world.halfWidth && Math.abs(fromZ) <= world.halfDepth;
  walker.x += dx;
  walker.z += dz;
  pushOut(colliders, walker, radius, insideRoom, walker.y);
  if (!walkSurfaceAt(world, walker.x, walker.z, walker.y, walker.kind, surfaceScratch)) {
    walker.x = fromX;
    walker.z = fromZ;
    return;
  }
  walker.y = surfaceScratch.y;
  walker.kind = surfaceScratch.kind;
  if (surfaceScratch.kind !== 'ground') walker.floorIndex = surfaceScratch.floorIndex;
}

/**
 * The walls of each storey, for line-of-sight tests (#590): its partitions,
 * cut at their doors, and its shell. No furniture, no street, and no
 * neighbouring storeys. Build when the building changes, not per frame.
 */
export function buildSightWalls(building: ShellBuilding): WalkCollider[][] {
  return building.floors.map((floor, index) => [
    ...buildWalkColliders(floor.items, floor.interiorWalls ?? [], {
      roomWidth: building.width,
      roomDepth: building.depth,
    }).filter((collider) => collider.wall),
    ...buildShellColliders(building, index),
  ]);
}

/**
 * Whether a wall stands between (x1, z1) and (x2, z2) (#566, #590): the
 * segment crosses a `wall` collider, a partition run or the shell. Door gaps
 * are open, furniture never blocks. A wall the start point is inside (the
 * one a camera hangs on) doesn't count. With `feetY`, only walls that meet
 * a walker standing there count, as for the walker itself.
 */
export function sightBlocked(
  colliders: readonly WalkCollider[],
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  feetY?: number
): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  for (const box of colliders) {
    if (!box.wall) continue;
    if (feetY !== undefined && !blocksAt(box, feetY)) continue;
    // The segment in the box's local frame.
    const ox = x1 - box.cx;
    const oz = z1 - box.cz;
    const p0 = ox * box.ax + oz * box.az;
    const q0 = ox * box.bx + oz * box.bz;
    if (Math.abs(p0) <= box.hw && Math.abs(q0) <= box.hd) continue;
    const dp = dx * box.ax + dz * box.az;
    const dq = dx * box.bx + dz * box.bz;
    if (crossesBox(p0, dp, box.hw, q0, dq, box.hd)) return true;
  }
  return false;
}

/**
 * Whether `(p0, q0) + t · (dp, dq)`, t in [0, 1], enters the box ±`hw` ×
 * ±`hd` (in its local frame): the Liang–Barsky clip, one slab per axis.
 */
function crossesBox(p0: number, dp: number, hw: number, q0: number, dq: number, hd: number): boolean {
  let from = 0;
  let to = 1;
  if (Math.abs(dp) < 1e-12) {
    if (Math.abs(p0) >= hw) return false;
  } else {
    const a = (-hw - p0) / dp;
    const b = (hw - p0) / dp;
    from = Math.max(from, Math.min(a, b));
    to = Math.min(to, Math.max(a, b));
  }
  if (Math.abs(dq) < 1e-12) {
    if (Math.abs(q0) >= hd) return false;
  } else {
    const a = (-hd - q0) / dq;
    const b = (hd - q0) / dq;
    from = Math.max(from, Math.min(a, b));
    to = Math.min(to, Math.max(a, b));
  }
  return from < to;
}

/**
 * How far (x, z) is from the nearest collider's surface: 0 inside one.
 * With `feetY`, only boxes that meet a walker standing there count.
 * Outdoor colliders count only for a point outside the room, as in the
 * resolver. For picking a spawn spot, not for the per-frame loop.
 */
export function walkClearance(
  colliders: readonly WalkCollider[],
  x: number,
  z: number,
  insideRoom: boolean,
  feetY?: number
): number {
  let clearance = Infinity;
  for (const box of colliders) {
    if (box.outdoor && insideRoom) continue;
    // A box on another storey (under a landing, upstairs) isn't in the way.
    if (feetY !== undefined && !blocksAt(box, feetY)) continue;
    const dx = x - box.cx;
    const dz = z - box.cz;
    const lx = Math.max(0, Math.abs(dx * box.ax + dz * box.az) - box.hw);
    const lz = Math.max(0, Math.abs(dx * box.bx + dz * box.bz) - box.hd);
    clearance = Math.min(clearance, Math.hypot(lx, lz));
  }
  return clearance;
}

/**
 * The walker's colliders for each storey it can stand on (#446): that
 * storey's furniture, partitions and shell with the storeys directly below
 * and above it, plus the street. Each box carries its vertical span, so on a
 * flight the walker passes over what stands below the landing and under
 * what is upstairs, whichever storey it is counted on. Build when the
 * building changes; index by the walker's storey per frame.
 */
export function buildWalkerColliders(
  building: ShellBuilding & Pick<StreetSite, 'neighbours' | 'roof'>
): WalkCollider[][] {
  const street = buildStreetColliders(streetSiteOf(building));
  const perStorey = building.floors.map((floor, index) => [
    ...buildWalkColliders(floor.items, floor.interiorWalls ?? [], {
      roomWidth: building.width,
      roomDepth: building.depth,
      stairsAsRamps: true,
      baseY: floorElevation(building.floors, index),
      storeyHeight: storeyHeight(floor),
    }),
    ...buildShellColliders(building, index),
  ]);
  return perStorey.map((_own, index) => [
    ...(perStorey[index - 1] ?? []),
    ...perStorey[index]!,
    ...(perStorey[index + 1] ?? []),
    ...street,
  ]);
}
