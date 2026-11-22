/**
 * Walker (NPC) navigation (#452). A storey's free floor is rasterised once
 * into a grid of cells a walker can stand in: the first-person walker's
 * colliders (`lib/walk-collision`: furniture and interior walls with their
 * door gaps), the stairs, and the storey's keep-out (porch and stairwell
 * holes) all block. Walkers then pick a destination in the free space they
 * can reach, route to it with A* and walk the string-pulled path, resolving
 * every step against the same colliders.
 *
 * On the ground storey a second, coarser grid covers the lot (#913): its
 * cells are numbered on from the indoor grid's in one index space, and each
 * usable outside door joins a cell either side of it, so one A* walks a
 * route out of the back door onto the patio. Without a usable door the nav
 * is the indoor grid alone, exactly as before.
 *
 * Build the nav when the floor changes, never per frame. Pathing and
 * waypoint picks reuse the nav's scratch buffers, so a walker re-planning
 * mid-loop allocates nothing. Randomness is injected for deterministic tests.
 */

import { LOW_PROFILE_MAX_HEIGHT, isInsideBuilding } from './footprint';
import { isWallHung } from './mount-band';
import { isWallMounted } from './opening-snap';
import { type WalkCollider, type WalkCollisionOptions, boxCollider, buildWalkColliders } from './walk-collision';
import type { KeepOutRect } from './geometry';
import type { FurnitureItem, InteriorWall } from './types';

/** A walker's body radius: the circle the grid and the step resolver keep clear. */
export const NPC_RADIUS = 0.22;
/** Target cell size (metres); the grid stretches it slightly to fit the footprint. */
const CELL_SIZE = 0.2;
/** Walkers keep this far inside the exterior walls' centrelines. */
export const EXTERIOR_MARGIN = 0.4;
/** Furniture within this gap of a free cell makes the cell a spot worth stopping at. */
const INTEREST_GAP = 0.35;
/** Destination picks that try a spot by furniture before any free cell. */
const INTEREST_CHANCE = 0.6;
const PICK_TRIES = 12;
/** Destinations closer than this (metres) are re-rolled so a walk is a walk. */
const MIN_TRIP = 1;
/** Waypoints a walker can hold; a longer path ends early and the walker re-plans. */
export const MAX_PATH_POINTS = 32;
/** Target cell size on the lot (metres): coarser than indoors, the lot is large (#913). */
export const OUTDOOR_CELL_SIZE = 0.3;
/** How far either side of a doorway's wall line its two cells are looked for (m). */
const DOOR_REACH = EXTERIOR_MARGIN + 0.15;
/** A doorway's two cells are taken within this of where they are looked for (m). */
const DOOR_SNAP = 0.35;
/** A walk through a doorway keeps this much of the body clear of the frame: a hair under the radius. */
const DOOR_CLEARANCE = NPC_RADIUS - 0.02;
/** Points tested along a walk through a doorway, this far apart (m). */
const DOOR_SAMPLE = 0.04;

const SQRT2 = Math.SQRT2;
const NEIGHBOUR_DX = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const NEIGHBOUR_DZ = [0, 0, 1, -1, 1, -1, 1, -1] as const;

export interface NpcNavInput {
  items: readonly FurnitureItem[];
  interiorWalls: readonly InteriorWall[];
  /** The storey's porch and stairwell rects (`floorKeepOut`). */
  keepOut: readonly KeepOutRect[];
  roomWidth: number;
  roomDepth: number;
  /** The lot outside, on the ground storey (#913); absent or null: indoors only. */
  outdoor?: NpcOutdoorInput | null;
}

/** An opening from the house onto the lot: an outside door, or the porch's (#913). */
export interface NpcDoorway {
  /** Its centre on the wall line. */
  x: number;
  z: number;
  /** Unit normal pointing out of the house. */
  nx: number;
  nz: number;
}

/** What the lot's grid is built from: `lib/npc-garden` reads it off the site (#913). */
export interface NpcOutdoorInput {
  /** The rectangle of lot the walkers may roam. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Whether a point is indoors, on the indoor grid: within the walls and not in the porch. */
  indoors: (x: number, z: number) => boolean;
  /** Points of the lot no walker stands on: the house and the margin round it. */
  blocked: (x: number, z: number) => boolean;
  /** Feet height at a point outdoors, relative to the storey's floor. */
  groundAt: (x: number, z: number) => number;
  /**
   * The most neighbouring cells, or a doorway's two sides, may differ in
   * height: the walk world's step, never the side of a flight.
   */
  maxStep: number;
  /** Solid outdoors besides the storey's items: the shell either side of its doors, the porch's cheeks, the neighbours. */
  colliders: readonly WalkCollider[];
  /** The ways out. */
  doorways: readonly NpcDoorway[];
  /** Outdoor things worth stopping at: the bench, the barbecue, a tree. */
  interest: readonly WalkCollider[];
  /** Whether a free cell is somewhere to wander to (a garden surface); the rest of the lawn is only walked across. */
  wander: (x: number, z: number) => boolean;
}

/** The lot's grid; its cells are numbered on from the indoor grid's (`NpcNav.inner`). */
export interface NpcOutdoorGrid {
  cols: number;
  rows: number;
  cellW: number;
  cellD: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  indoors: (x: number, z: number) => boolean;
  groundAt: (x: number, z: number) => number;
  maxStep: number;
}

export interface NpcNav {
  /** What every walker step is resolved against. */
  colliders: readonly WalkCollider[];
  collisionOptions: WalkCollisionOptions;
  cols: number;
  rows: number;
  cellW: number;
  cellD: number;
  x0: number;
  z0: number;
  /** The indoor grid's walker box: the footprint less the exterior margin. */
  halfW: number;
  halfD: number;
  /**
   * Walkers are clamped to this box: the indoor one, or with a lot (#913)
   * the lot's rectangle, where the shell's colliders keep them inside the walls.
   */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Cells of the indoor grid; the lot's (`outdoor`) are numbered from here on (#913). */
  inner: number;
  outdoor: NpcOutdoorGrid | null;
  /** Per cell, the cell through a doorway from it, or -1; and that doorway's centre. */
  link: Int32Array;
  linkX: Float32Array;
  linkZ: Float32Array;
  /** Per cell, the feet height relative to the floor (0 indoors); null without a lot. */
  cellY: Float32Array | null;
  /** 1 where a walker can stand. */
  walkable: Uint8Array;
  /** Connected region of each walkable cell, -1 elsewhere: a walker only targets its own. */
  region: Int32Array;
  /** Per region, 1 when it holds an indoor cell: a region without one is a garden fenced off from the house (#913). */
  regionIndoors: Uint8Array;
  /** Every free cell, the indoor ones first. */
  free: Int32Array;
  freeCount: number;
  /** How many of `free` are indoors: walkers spawn there, and wander there and to `wander`. */
  indoorFreeCount: number;
  /** Free cells on the lot worth wandering to: a garden surface (#913). */
  wander: Int32Array;
  wanderCount: number;
  /**
   * Whether walkers may head out onto the lot now: the walk turns it off
   * for rain, snow and the night (#913), without a rebuild.
   */
  outdoorOpen: boolean;
  /** Free cells beside furniture, and the heading (radians) that faces the piece. */
  interest: Int32Array;
  interestCount: number;
  heading: Float32Array;
  // A* and search scratch, reused by every query.
  g: Float32Array;
  f: Float32Array;
  parent: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  heap: Int32Array;
  heapPos: Int32Array;
  rawPath: Int32Array;
  stamp: number;
}

/**
 * Everything `buildNpcNav` reads from a storey, as a string: equal
 * signatures build the same nav. Items and keep-out get a new identity on
 * cosmetic edits (a recoloured sofa, a lock, the floor colour), and
 * rebuilding on those would re-route every walker mid-stride.
 */
export function npcNavSignature(input: Omit<NpcNavInput, 'roomWidth' | 'roomDepth' | 'outdoor'>): string {
  const parts: string[] = [];
  for (const item of input.items) {
    if (!item.position) continue;
    parts.push(
      `${item.id}:${item.type}:${item.category === 'outdoor' ? 1 : 0}:${item.position.x}:${item.position.z}:` +
        `${item.width}:${item.depth}:${item.height}:${item.rotation ?? 0}` +
        // A sliding door's fixed pane narrows its gap (#922); nothing else changes the walk.
        (item.type === 'door' && item.openingStyle === 'sliding' ? `:sliding${item.mirrored ? '-m' : ''}` : '')
    );
  }
  parts.push('|');
  for (const wall of input.interiorWalls) parts.push(`${wall.id}:${wall.x1}:${wall.z1}:${wall.x2}:${wall.z2}`);
  parts.push('|');
  for (const rect of input.keepOut) parts.push(`${rect.x0}:${rect.x1}:${rect.z0}:${rect.z1}:${rect.rotation ?? 0}`);
  return parts.join(';');
}

interface GridShape {
  cols: number;
  rows: number;
  cellW: number;
  cellD: number;
  x0: number;
  z0: number;
  /** Index of the grid's first cell in the nav. */
  base: number;
}

/**
 * Rasterise one storey for the walkers. Returns null when the footprint is
 * too small to hold one. With `outdoor` (the ground storey, #913) the lot
 * is rasterised too and joined at the doorways; when no doorway can be
 * walked through, the nav is the indoor one alone.
 */
export function buildNpcNav(input: NpcNavInput): NpcNav | null {
  const { items, interiorWalls, keepOut, roomWidth, roomDepth } = input;
  const innerHalfW = roomWidth / 2 - EXTERIOR_MARGIN;
  const innerHalfD = roomDepth / 2 - EXTERIOR_MARGIN;
  if (!(innerHalfW > NPC_RADIUS && innerHalfD > NPC_RADIUS)) return null;
  const given = input.outdoor;
  let lot = given && given.doorways.length > 0 && given.x1 > given.x0 && given.z1 > given.z0 ? given : null;

  const collisionOptions: WalkCollisionOptions = { roomWidth, roomDepth, cutout: keepOut.find((rect) => rect.cutout)?.cutout };
  const colliders = buildWalkColliders(items, interiorWalls, collisionOptions);
  const furniture: WalkCollider[] = [];
  for (const item of items) {
    if (!item.position || item.category === 'outdoor') continue;
    if (isWallMounted(item.type) || isWallHung(item.type) || item.height <= LOW_PROFILE_MAX_HEIGHT) continue;
    const box = boxCollider(item.position.x, item.position.z, item.width, item.depth, item.rotation ?? 0, false);
    // Walkers never take the stairs: the flight stays solid for them whatever
    // the first-person walker makes of it.
    if (item.type === 'stairs') colliders.push(box);
    else furniture.push(box);
  }
  // No doorway a walker could pass (#913): don't rasterise a lot nobody reaches.
  if (lot) {
    const walls = [...colliders, ...lot.colliders];
    const open = lot;
    if (!lot.doorways.some((door) => doorwayPassable(walls, open, door))) lot = null;
  }
  // The keep-out blocks the indoor grid. With a lot, the porch and the cut
  // corner are outdoor space the walkers cross: there the shell's own
  // colliders stand in for them, and only stairwell holes stay solid.
  const keepOutBoxes: WalkCollider[] = [];
  for (const rect of keepOut) {
    const box = boxCollider((rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2, rect.x1 - rect.x0, rect.z1 - rect.z0, rect.rotation ?? 0, false);
    keepOutBoxes.push(box);
    if (!lot || rect.hole) colliders.push(box);
  }

  const cols = Math.max(1, Math.ceil(roomWidth / CELL_SIZE));
  const rows = Math.max(1, Math.ceil(roomDepth / CELL_SIZE));
  const inner = cols * rows;
  const cellW = roomWidth / cols;
  const cellD = roomDepth / rows;
  const x0 = -roomWidth / 2;
  const z0 = -roomDepth / 2;
  const indoorGrid: GridShape = { cols, rows, cellW, cellD, x0, z0, base: 0 };

  let outdoor: NpcOutdoorGrid | null = null;
  let outdoorGrid: GridShape | null = null;
  if (lot) {
    const oCols = Math.max(1, Math.ceil((lot.x1 - lot.x0) / OUTDOOR_CELL_SIZE));
    const oRows = Math.max(1, Math.ceil((lot.z1 - lot.z0) / OUTDOOR_CELL_SIZE));
    outdoor = {
      cols: oCols,
      rows: oRows,
      cellW: (lot.x1 - lot.x0) / oCols,
      cellD: (lot.z1 - lot.z0) / oRows,
      x0: lot.x0,
      z0: lot.z0,
      x1: lot.x1,
      z1: lot.z1,
      indoors: lot.indoors,
      groundAt: lot.groundAt,
      maxStep: lot.maxStep,
    };
    outdoorGrid = { cols: oCols, rows: oRows, cellW: outdoor.cellW, cellD: outdoor.cellD, x0: lot.x0, z0: lot.z0, base: inner };
  }
  const cells = inner + (outdoor ? outdoor.cols * outdoor.rows : 0);

  // Every cell inside the walker box starts free; each collider then blocks
  // only the cells under its own reach, so the cost follows the furniture's
  // area, not cells × colliders.
  const walkable = new Uint8Array(cells);
  for (let row = 0; row < rows; row++) {
    if (Math.abs(z0 + (row + 0.5) * cellD) > innerHalfD) continue;
    for (let col = 0; col < cols; col++) {
      if (Math.abs(x0 + (col + 0.5) * cellW) <= innerHalfW) walkable[row * cols + col] = 1;
    }
  }
  const indoorBlockers = lot ? [...colliders.filter((box) => !box.outdoor), ...keepOutBoxes.filter((box) => !colliders.includes(box))] : colliders;
  for (const box of indoorBlockers) {
    if (box.outdoor) continue;
    forCellsNear(indoorGrid, box, NPC_RADIUS, (cell, x, z) => {
      if (walkable[cell] === 1 && boxDistance(box, x, z) < NPC_RADIUS) walkable[cell] = 0;
    });
  }

  let cellY: Float32Array | null = null;
  if (outdoor && outdoorGrid && lot) {
    cellY = new Float32Array(cells);
    for (let row = 0; row < outdoor.rows; row++) {
      const z = outdoor.z0 + (row + 0.5) * outdoor.cellD;
      for (let col = 0; col < outdoor.cols; col++) {
        const x = outdoor.x0 + (col + 0.5) * outdoor.cellW;
        const cell = inner + row * outdoor.cols + col;
        if (lot.indoors(x, z) || lot.blocked(x, z)) continue;
        walkable[cell] = 1;
        cellY[cell] = lot.groundAt(x, z);
      }
    }
    for (const box of [...colliders, ...lot.colliders]) {
      forCellsNear(outdoorGrid, box, NPC_RADIUS, (cell, x, z) => {
        if (walkable[cell] === 1 && boxDistance(box, x, z) < NPC_RADIUS) walkable[cell] = 0;
      });
    }
    // The walk outdoors resolves against the shell, the porch's cheeks and the neighbours too.
    colliders.push(...lot.colliders);
  }

  // The free cells within reach of a piece of furniture face the nearest one.
  const heading = new Float32Array(cells).fill(Number.NaN);
  const interestGap = new Float32Array(cells).fill(Number.POSITIVE_INFINITY);
  const markInterest = (grid: GridShape, box: WalkCollider): void => {
    forCellsNear(grid, box, NPC_RADIUS + INTEREST_GAP, (cell, x, z) => {
      if (walkable[cell] !== 1) return;
      const gap = boxDistance(box, x, z);
      if (gap >= NPC_RADIUS + INTEREST_GAP || gap >= interestGap[cell]!) return;
      interestGap[cell] = gap;
      // Three's rotation.y convention: heading 0 faces +Z.
      heading[cell] = Math.atan2(box.cx - x, box.cz - z);
    });
  };
  for (const box of furniture) markInterest(indoorGrid, box);
  if (outdoorGrid && lot) for (const box of lot.interest) markInterest(outdoorGrid, box);

  const freeList: number[] = [];
  const wanderList: number[] = [];
  const interestList: number[] = [];
  let indoorFreeCount = 0;
  for (let cell = 0; cell < cells; cell++) {
    if (walkable[cell] !== 1) continue;
    freeList.push(cell);
    if (cell < inner) indoorFreeCount++;
    if (!Number.isNaN(heading[cell]!)) interestList.push(cell);
  }

  const nav: NpcNav = {
    colliders,
    collisionOptions,
    cols,
    rows,
    cellW,
    cellD,
    x0,
    z0,
    halfW: innerHalfW,
    halfD: innerHalfD,
    minX: outdoor ? outdoor.x0 : -innerHalfW,
    maxX: outdoor ? outdoor.x1 : innerHalfW,
    minZ: outdoor ? outdoor.z0 : -innerHalfD,
    maxZ: outdoor ? outdoor.z1 : innerHalfD,
    inner,
    outdoor,
    link: new Int32Array(cells).fill(-1),
    linkX: new Float32Array(outdoor ? cells : 0),
    linkZ: new Float32Array(outdoor ? cells : 0),
    cellY,
    walkable,
    region: new Int32Array(cells).fill(-1),
    regionIndoors: new Uint8Array(0),
    free: Int32Array.from(freeList),
    freeCount: freeList.length,
    indoorFreeCount,
    wander: new Int32Array(0),
    wanderCount: 0,
    outdoorOpen: true,
    interest: Int32Array.from(interestList),
    interestCount: interestList.length,
    heading,
    g: new Float32Array(cells),
    f: new Float32Array(cells),
    parent: new Int32Array(cells),
    seen: new Uint32Array(cells),
    closed: new Uint32Array(cells),
    heap: new Int32Array(cells),
    heapPos: new Int32Array(cells),
    rawPath: new Int32Array(cells),
    stamp: 0,
  };

  if (outdoor && lot) {
    let links = 0;
    for (const door of lot.doorways) if (joinDoorway(nav, door)) links++;
    // No way out after all (the doorway's cells snapped onto nothing free): the nav is the indoor one.
    if (links === 0) return buildNpcNav({ ...input, outdoor: null });
    for (let i = indoorFreeCount; i < freeList.length; i++) {
      const cell = freeList[i]!;
      if (lot.wander(cellX(nav, cell), cellZ(nav, cell))) wanderList.push(cell);
    }
    nav.wander = Int32Array.from(wanderList);
    nav.wanderCount = wanderList.length;
  }
  labelRegions(nav);
  return nav;
}

/**
 * Join the free cells either side of a doorway (#913), when a walker can
 * walk straight from the one through the doorway's centre to the other,
 * clear of everything, and the lot there is within a step of the floor.
 */
function joinDoorway(nav: NpcNav, door: NpcDoorway): boolean {
  const inside = snapCell(nav, door.x - door.nx * DOOR_REACH, door.z - door.nz * DOOR_REACH, false);
  const outside = snapCell(nav, door.x + door.nx * DOOR_REACH, door.z + door.nz * DOOR_REACH, true);
  if (inside < 0 || outside < 0 || nav.link[inside]! >= 0 || nav.link[outside]! >= 0) return false;
  if (Math.abs(nav.cellY?.[outside] ?? 0) > (nav.outdoor?.maxStep ?? 0)) return false;
  const ix = cellX(nav, inside);
  const iz = cellZ(nav, inside);
  const ox = cellX(nav, outside);
  const oz = cellZ(nav, outside);
  const indoors = nav.outdoor!.indoors;
  if (!walkClear(nav.colliders, ix, iz, door.x, door.z, indoors) || !walkClear(nav.colliders, door.x, door.z, ox, oz, null)) return false;
  nav.link[inside] = outside;
  nav.link[outside] = inside;
  nav.linkX[inside] = door.x;
  nav.linkZ[inside] = door.z;
  nav.linkX[outside] = door.x;
  nav.linkZ[outside] = door.z;
  return true;
}

/** The free cell of one grid nearest (x, z) within `DOOR_SNAP`, or -1. */
function snapCell(nav: NpcNav, x: number, z: number, outdoors: boolean): number {
  const o = nav.outdoor;
  if (outdoors && !o) return -1;
  const cw = outdoors ? o!.cellW : nav.cellW;
  const cd = outdoors ? o!.cellD : nav.cellD;
  let best = -1;
  let bestGap = DOOR_SNAP;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const px = x + dx * cw;
      const pz = z + dz * cd;
      const cell = outdoors ? outdoorCellAt(nav, px, pz) : indoorCellAt(nav, px, pz);
      if (cell < 0 || nav.walkable[cell] !== 1) continue;
      const gap = Math.hypot(cellX(nav, cell) - x, cellZ(nav, cell) - z);
      if (gap < bestGap) {
        best = cell;
        bestGap = gap;
      }
    }
  }
  return best;
}

/**
 * Whether a walker could pass a doorway at all, before any grid is built
 * (#913): straight through its centre, from `DOOR_REACH` inside to as far
 * out, clear of everything, onto the lot within a step of the floor.
 */
function doorwayPassable(colliders: readonly WalkCollider[], lot: NpcOutdoorInput, door: NpcDoorway): boolean {
  const ox = door.x + door.nx * DOOR_REACH;
  const oz = door.z + door.nz * DOOR_REACH;
  if (lot.indoors(ox, oz) || lot.blocked(ox, oz) || Math.abs(lot.groundAt(ox, oz)) > lot.maxStep) return false;
  return walkClear(colliders, door.x - door.nx * DOOR_REACH, door.z - door.nz * DOOR_REACH, door.x, door.z, lot.indoors) && walkClear(colliders, door.x, door.z, ox, oz, null);
}

/**
 * Whether a straight walk keeps `DOOR_CLEARANCE` from every collider;
 * with `indoors`, outdoor ones are ignored where it says so, as the resolver does.
 */
function walkClear(
  colliders: readonly WalkCollider[],
  ax: number,
  az: number,
  bx: number,
  bz: number,
  indoors: ((x: number, z: number) => boolean) | null
): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / DOOR_SAMPLE));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const inside = indoors !== null && indoors(x, z);
    for (const box of colliders) {
      if (box.outdoor && inside) continue;
      if (Math.abs(x - box.cx) >= box.aabbHalfW + DOOR_CLEARANCE || Math.abs(z - box.cz) >= box.aabbHalfD + DOOR_CLEARANCE) continue;
      if (boxDistance(box, x, z) < DOOR_CLEARANCE) return false;
    }
  }
  return true;
}

function indoorCellAt(nav: NpcNav, x: number, z: number): number {
  const col = Math.min(nav.cols - 1, Math.max(0, Math.floor((x - nav.x0) / nav.cellW)));
  const row = Math.min(nav.rows - 1, Math.max(0, Math.floor((z - nav.z0) / nav.cellD)));
  return row * nav.cols + col;
}

function outdoorCellAt(nav: NpcNav, x: number, z: number): number {
  const o = nav.outdoor;
  if (!o) return -1;
  const col = Math.min(o.cols - 1, Math.max(0, Math.floor((x - o.x0) / o.cellW)));
  const row = Math.min(o.rows - 1, Math.max(0, Math.floor((z - o.z0) / o.cellD)));
  return nav.inner + row * o.cols + col;
}

/** Whether (x, z) lies on the lot's grid rather than the indoor one (#913). */
function onLot(nav: NpcNav, x: number, z: number): boolean {
  return nav.outdoor !== null && !nav.outdoor.indoors(x, z);
}

/** The grid cell under a point, clamped to its grid: the lot's outdoors (#913), the indoor one otherwise. */
export function cellAt(nav: NpcNav, x: number, z: number): number {
  return onLot(nav, x, z) ? outdoorCellAt(nav, x, z) : indoorCellAt(nav, x, z);
}

export function cellX(nav: NpcNav, cell: number): number {
  const o = nav.outdoor;
  if (o && cell >= nav.inner) return o.x0 + (((cell - nav.inner) % o.cols) + 0.5) * o.cellW;
  return nav.x0 + ((cell % nav.cols) + 0.5) * nav.cellW;
}

export function cellZ(nav: NpcNav, cell: number): number {
  const o = nav.outdoor;
  if (o && cell >= nav.inner) return o.z0 + (Math.floor((cell - nav.inner) / o.cols) + 0.5) * o.cellD;
  return nav.z0 + (Math.floor(cell / nav.cols) + 0.5) * nav.cellD;
}

/** Whether a cell is on the lot, outside the house (#913). */
export function isOutdoorCell(nav: NpcNav, cell: number): boolean {
  return nav.outdoor !== null && cell >= nav.inner;
}

/** Feet height at a point relative to the storey's floor: the lot's ground outdoors (#913), 0 indoors. */
export function npcGroundY(nav: NpcNav, x: number, z: number): number {
  const o = nav.outdoor;
  return o && !o.indoors(x, z) ? o.groundAt(x, z) : 0;
}

/** Whether a walker centred on this point stands in free space. */
export function isFreeAt(nav: NpcNav, x: number, z: number): boolean {
  const o = nav.outdoor;
  if (o && !o.indoors(x, z)) {
    if (x < o.x0 || x > o.x1 || z < o.z0 || z > o.z1) return false;
    return nav.walkable[outdoorCellAt(nav, x, z)] === 1;
  }
  if (Math.abs(x) > nav.halfW || Math.abs(z) > nav.halfD) return false;
  return nav.walkable[indoorCellAt(nav, x, z)] === 1;
}

/**
 * A random free cell indoors, weighted by area (bigger rooms get more
 * walkers); a lot with nowhere indoors falls back to it. -1 when the floor
 * is full.
 */
export function randomFreeCell(nav: NpcNav, random: () => number): number {
  const count = nav.indoorFreeCount > 0 ? nav.indoorFreeCount : nav.freeCount;
  if (count === 0) return -1;
  return nav.free[Math.min(count - 1, Math.floor(random() * count))] ?? -1;
}

/**
 * The free cell nearest a point (breadth-first over its grid), for a
 * walker the floor changed under — furniture dropped on it, a wall drawn
 * through it. -1 when the floor has no free cell.
 */
export function nearestFreeCell(nav: NpcNav, x: number, z: number): number {
  const start = cellAt(nav, x, z);
  if (nav.walkable[start] === 1) return start;
  if (nav.freeCount === 0) return -1;
  const stamp = nextStamp(nav);
  const queue = nav.rawPath;
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  nav.seen[start] = stamp;
  while (head < tail) {
    const cell = queue[head++]!;
    for (let n = 0; n < 4; n++) {
      const next = neighbourCell(nav, cell, n);
      if (next < 0 || nav.seen[next] === stamp) continue;
      if (nav.walkable[next] === 1) return next;
      nav.seen[next] = stamp;
      queue[tail++] = next;
    }
  }
  // Its grid has no free cell left (#913): the nearest on the other.
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < nav.freeCount; i++) {
    const cell = nav.free[i]!;
    const gap = Math.hypot(cellX(nav, cell) - x, cellZ(nav, cell) - z);
    if (gap < bestGap) {
      best = cell;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Whether a walker at (x, z) is cut off from the house (#913): out on a
 * patch of lot no doorway reaches (a fence run put between it and the
 * door), or outside the walls on a nav with no lot at all (the last door
 * or garden thing gone). Such a walker is brought in, not walked.
 */
export function cutOffOutside(nav: NpcNav, x: number, z: number): boolean {
  if (!nav.outdoor) {
    const { roomWidth, roomDepth, cutout } = nav.collisionOptions;
    if (roomWidth === undefined || roomDepth === undefined) return false;
    return !isInsideBuilding({ width: roomWidth, height: roomDepth, cutout }, x, z);
  }
  if (nav.outdoor.indoors(x, z)) return false;
  const cell = nearestFreeCell(nav, x, z);
  if (cell < 0) return true;
  return cell >= nav.inner && nav.regionIndoors[nav.region[cell]!] !== 1;
}

/** The free indoor cell nearest (x, z), -1 when there is none: where a cut-off walker is brought in to. */
export function nearestIndoorCell(nav: NpcNav, x: number, z: number): number {
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < nav.indoorFreeCount; i++) {
    const cell = nav.free[i]!;
    const gap = Math.hypot(cellX(nav, cell) - x, cellZ(nav, cell) - z);
    if (gap < bestGap) {
      best = cell;
      bestGap = gap;
    }
  }
  return best;
}

/** How many cells a destination is picked among: the indoor ones, and the lot's surfaces while open (#913). */
function wanderPool(nav: NpcNav): number {
  return nav.indoorFreeCount + (nav.outdoorOpen ? nav.wanderCount : 0);
}

function wanderCell(nav: NpcNav, index: number): number {
  return index < nav.indoorFreeCount ? nav.free[index]! : nav.wander[index - nav.indoorFreeCount] ?? -1;
}

/**
 * Somewhere for a walker standing in `from` to head for: usually a spot
 * beside a piece of furniture (it stops and looks at the sofa, the
 * bookcase), otherwise any free cell, always one it can reach and at least
 * a metre away when the region allows. `taken` turns down spots another
 * walker already claimed, so they don't pile up at the one sofa (ignored
 * only when nothing else is left). Out on the lot (#913) only spots by
 * garden things and on garden surfaces count, and none while the lot is
 * closed. -1 when its region has no other cell.
 */
export function pickDestination(
  nav: NpcNav,
  from: number,
  random: () => number,
  taken?: (x: number, z: number) => boolean
): number {
  const region = nav.region[from] ?? -1;
  if (region < 0) return -1;
  const fromX = cellX(nav, from);
  const fromZ = cellZ(nav, from);
  const open = (cell: number): boolean => cell !== from && nav.region[cell] === region && (nav.outdoorOpen || cell < nav.inner);
  const acceptable = (cell: number): boolean => {
    if (!open(cell)) return false;
    const x = cellX(nav, cell);
    const z = cellZ(nav, cell);
    return Math.hypot(x - fromX, z - fromZ) >= MIN_TRIP && !taken?.(x, z);
  };
  if (nav.interestCount > 0 && random() < INTEREST_CHANCE) {
    for (let i = 0; i < PICK_TRIES; i++) {
      const cell = nav.interest[Math.floor(random() * nav.interestCount)] ?? -1;
      if (cell >= 0 && acceptable(cell)) return cell;
    }
  }
  const pool = wanderPool(nav);
  for (let i = 0; i < PICK_TRIES; i++) {
    const cell = wanderCell(nav, Math.floor(random() * pool));
    if (cell >= 0 && acceptable(cell)) return cell;
  }
  // A small or crowded region: scan from a random start for any other cell in it.
  const offset = Math.floor(random() * pool);
  let fallback = -1;
  for (let i = 0; i < pool; i++) {
    const cell = wanderCell(nav, (offset + i) % pool);
    if (!open(cell)) continue;
    if (acceptable(cell)) return cell;
    if (fallback < 0) fallback = cell;
  }
  return fallback;
}

/**
 * Route from a point to a cell's centre and write the string-pulled
 * waypoints (x, z pairs, start excluded, goal included) into `out`. Returns
 * the number of waypoints, 0 when there is no route. At most
 * `out.length / 2` are written; a longer route ends early. A route through
 * a doorway (#913) passes its centre.
 */
export function findNpcPath(nav: NpcNav, fromX: number, fromZ: number, goal: number, out: Float32Array): number {
  const start = cellAt(nav, fromX, fromZ);
  if (nav.walkable[start] !== 1 || nav.walkable[goal] !== 1) return 0;
  if (nav.region[start] !== nav.region[goal]) return 0;
  const rawLength = aStar(nav, start, goal);
  if (rawLength === 0) return 0;

  // String-pull: from each anchor, jump to the farthest raw cell in sight.
  const capacity = Math.floor(out.length / 2);
  let count = 0;
  let anchorX = fromX;
  let anchorZ = fromZ;
  let index = 0;
  while (index < rawLength - 1 && count < capacity) {
    let reach = index + 1;
    for (let probe = rawLength - 1; probe > index + 1; probe--) {
      const cell = nav.rawPath[probe]!;
      if (lineIsFree(nav, anchorX, anchorZ, cellX(nav, cell), cellZ(nav, cell))) {
        reach = probe;
        break;
      }
    }
    const cell = nav.rawPath[reach]!;
    const through = nav.rawPath[index]!;
    if (reach === index + 1 && nav.link[through] === cell) {
      // Through the doorway's centre, never across its frame.
      if (count + 2 > capacity) break;
      out[count * 2] = nav.linkX[through]!;
      out[count * 2 + 1] = nav.linkZ[through]!;
      count++;
    }
    anchorX = cellX(nav, cell);
    anchorZ = cellZ(nav, cell);
    out[count * 2] = anchorX;
    out[count * 2 + 1] = anchorZ;
    count++;
    index = reach;
  }
  if (count === 0 && capacity > 0) {
    // Already in the goal cell: step to its centre.
    out[0] = cellX(nav, goal);
    out[1] = cellZ(nav, goal);
    count = 1;
  }
  return count;
}

/** Whether a straight walk between two points stays on free cells, and on the lot climbs no more than a step at a time. */
export function lineIsFree(nav: NpcNav, ax: number, az: number, bx: number, bz: number): boolean {
  const length = Math.hypot(bx - ax, bz - az);
  const o = nav.outdoor;
  const step = Math.min(nav.cellW, nav.cellD, o ? Math.min(o.cellW, o.cellD) : Number.POSITIVE_INFINITY) * 0.5;
  const samples = Math.max(1, Math.ceil(length / step));
  const heights = nav.cellY;
  let previous = -1;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const cell = cellAt(nav, ax + (bx - ax) * t, az + (bz - az) * t);
    if (nav.walkable[cell] !== 1) return false;
    if (heights && o && previous >= 0 && Math.abs(heights[cell]! - heights[previous]!) > o.maxStep) return false;
    previous = cell;
  }
  return true;
}

/** The neighbour of a cell in direction `n` (`NEIGHBOUR_DX/DZ`) on its own grid, or -1 past its edge. */
function neighbourCell(nav: NpcNav, cell: number, n: number): number {
  const o = nav.outdoor;
  let base = 0;
  let cols = nav.cols;
  let rows = nav.rows;
  if (o && cell >= nav.inner) {
    base = nav.inner;
    cols = o.cols;
    rows = o.rows;
  }
  const local = cell - base;
  const col = local % cols;
  const nc = col + NEIGHBOUR_DX[n]!;
  const nr = (local - col) / cols + NEIGHBOUR_DZ[n]!;
  if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) return -1;
  return base + nr * cols + nc;
}

/** Whether a walker steps from one free cell onto a neighbouring one: free, and on the lot within a step (#913). */
function canStep(nav: NpcNav, from: number, to: number): boolean {
  if (to < 0 || nav.walkable[to] !== 1) return false;
  const heights = nav.cellY;
  return heights === null || Math.abs(heights[to]! - heights[from]!) <= nav.outdoor!.maxStep;
}

/**
 * The cell a move `n` (0..7, A*'s moves) leads to from `cell`, or -1: a
 * diagonal needs both side cells free too, or it clips a corner.
 */
function moveTo(nav: NpcNav, cell: number, n: number): number {
  const next = neighbourCell(nav, cell, n);
  if (!canStep(nav, cell, next)) return -1;
  if (n >= 4) {
    const sideX = neighbourCell(nav, cell, NEIGHBOUR_DX[n]! > 0 ? 0 : 1);
    const sideZ = neighbourCell(nav, cell, NEIGHBOUR_DZ[n]! > 0 ? 2 : 3);
    if (!canStep(nav, cell, sideX) || !canStep(nav, cell, sideZ)) return -1;
  }
  return next;
}

/** Metres a move `n` from `cell` covers. */
function moveCost(nav: NpcNav, cell: number, n: number): number {
  const o = nav.outdoor;
  const w = o && cell >= nav.inner ? o.cellW : nav.cellW;
  const d = o && cell >= nav.inner ? o.cellD : nav.cellD;
  return n < 2 ? w : n < 4 ? d : Math.hypot(w, d);
}

/**
 * Grid A* (8-connected, no corner cutting, octile heuristic in metres)
 * from `start` to `goal`, through doorways between the grids. Writes the
 * cell path, start first, into `nav.rawPath` and returns its length, 0
 * when unreachable.
 */
function aStar(nav: NpcNav, start: number, goal: number): number {
  const { g, f, parent, seen, closed, link } = nav;
  const stamp = nextStamp(nav);
  const goalX = cellX(nav, goal);
  const goalZ = cellZ(nav, goal);
  const heuristic = (cell: number): number => {
    const dx = Math.abs(cellX(nav, cell) - goalX);
    const dz = Math.abs(cellZ(nav, cell) - goalZ);
    return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
  };
  const relax = (current: number, next: number, cost: number, heapSize: number): number => {
    if (seen[next] === stamp && cost >= g[next]!) return heapSize;
    g[next] = cost;
    f[next] = cost + heuristic(next);
    parent[next] = current;
    if (seen[next] === stamp && nav.heapPos[next]! >= 0) {
      siftUp(nav, nav.heapPos[next]!);
      return heapSize;
    }
    seen[next] = stamp;
    return heapPush(nav, heapSize, next);
  };

  let heapSize = 0;
  g[start] = 0;
  f[start] = heuristic(start);
  parent[start] = -1;
  seen[start] = stamp;
  heapSize = heapPush(nav, heapSize, start);

  while (heapSize > 0) {
    const current = nav.heap[0]!;
    heapSize = heapPop(nav, heapSize);
    if (current === goal) break;
    closed[current] = stamp;
    for (let n = 0; n < 8; n++) {
      const next = moveTo(nav, current, n);
      if (next < 0 || closed[next] === stamp) continue;
      heapSize = relax(current, next, g[current]! + moveCost(nav, current, n), heapSize);
    }
    const through = link[current]!;
    if (through >= 0 && closed[through] !== stamp) {
      const doorX = nav.linkX[current]!;
      const doorZ = nav.linkZ[current]!;
      const cost =
        Math.hypot(cellX(nav, current) - doorX, cellZ(nav, current) - doorZ) + Math.hypot(cellX(nav, through) - doorX, cellZ(nav, through) - doorZ);
      heapSize = relax(current, through, g[current]! + cost, heapSize);
    }
  }
  if (seen[goal] !== stamp) return 0;

  // Walk the parents back, then reverse in place.
  let length = 0;
  for (let cell = goal; cell >= 0; cell = parent[cell]!) nav.rawPath[length++] = cell;
  for (let i = 0, j = length - 1; i < j; i++, j--) {
    const swap = nav.rawPath[i]!;
    nav.rawPath[i] = nav.rawPath[j]!;
    nav.rawPath[j] = swap;
  }
  return length;
}

function heapPush(nav: NpcNav, size: number, cell: number): number {
  nav.heap[size] = cell;
  nav.heapPos[cell] = size;
  siftUp(nav, size);
  return size + 1;
}

function heapPop(nav: NpcNav, size: number): number {
  const top = nav.heap[0]!;
  nav.heapPos[top] = -1;
  const last = size - 1;
  if (last > 0) {
    const moved = nav.heap[last]!;
    nav.heap[0] = moved;
    nav.heapPos[moved] = 0;
    siftDown(nav, 0, last);
  }
  return last;
}

function siftUp(nav: NpcNav, index: number): void {
  const { heap, heapPos, f } = nav;
  const cell = heap[index]!;
  const score = f[cell]!;
  while (index > 0) {
    const parentIndex = (index - 1) >> 1;
    const above = heap[parentIndex]!;
    if (f[above]! <= score) break;
    heap[index] = above;
    heapPos[above] = index;
    index = parentIndex;
  }
  heap[index] = cell;
  heapPos[cell] = index;
}

function siftDown(nav: NpcNav, index: number, size: number): void {
  const { heap, heapPos, f } = nav;
  const cell = heap[index]!;
  const score = f[cell]!;
  for (;;) {
    const left = index * 2 + 1;
    if (left >= size) break;
    const right = left + 1;
    const child = right < size && f[heap[right]!]! < f[heap[left]!]! ? right : left;
    const below = heap[child]!;
    if (f[below]! >= score) break;
    heap[index] = below;
    heapPos[below] = index;
    index = child;
  }
  heap[index] = cell;
  heapPos[cell] = index;
}

/** Flood-fill the walkable cells into regions, using A*'s moves and the doorways. */
function labelRegions(nav: NpcNav): void {
  const { region, link } = nav;
  const queue = nav.rawPath;
  let label = 0;
  for (let i = 0; i < nav.freeCount; i++) {
    const seed = nav.free[i]!;
    if (region[seed]! >= 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    region[seed] = label;
    while (head < tail) {
      const cell = queue[head++]!;
      for (let n = 0; n < 8; n++) {
        const next = moveTo(nav, cell, n);
        if (next < 0 || region[next]! >= 0) continue;
        region[next] = label;
        queue[tail++] = next;
      }
      const through = link[cell]!;
      if (through >= 0 && region[through]! < 0) {
        region[through] = label;
        queue[tail++] = through;
      }
    }
    label++;
  }
  nav.regionIndoors = new Uint8Array(label);
  for (let i = 0; i < nav.indoorFreeCount; i++) nav.regionIndoors[region[nav.free[i]!]!] = 1;
}

function nextStamp(nav: NpcNav): number {
  nav.stamp = nav.stamp >= 0xfffffffe ? 1 : nav.stamp + 1;
  if (nav.stamp === 1) {
    nav.seen.fill(0);
    nav.closed.fill(0);
  }
  return nav.stamp;
}

/** Visit the cells of one grid whose centres fall in a box's AABB grown by `reach`. */
function forCellsNear(
  grid: GridShape,
  box: WalkCollider,
  reach: number,
  visit: (cell: number, x: number, z: number) => void
): void {
  const colFrom = Math.max(0, Math.floor((box.cx - box.aabbHalfW - reach - grid.x0) / grid.cellW));
  const colTo = Math.min(grid.cols - 1, Math.floor((box.cx + box.aabbHalfW + reach - grid.x0) / grid.cellW));
  const rowFrom = Math.max(0, Math.floor((box.cz - box.aabbHalfD - reach - grid.z0) / grid.cellD));
  const rowTo = Math.min(grid.rows - 1, Math.floor((box.cz + box.aabbHalfD + reach - grid.z0) / grid.cellD));
  for (let row = rowFrom; row <= rowTo; row++) {
    const z = grid.z0 + (row + 0.5) * grid.cellD;
    for (let col = colFrom; col <= colTo; col++) {
      visit(grid.base + row * grid.cols + col, grid.x0 + (col + 0.5) * grid.cellW, z);
    }
  }
}

/** Distance from a point to a box's surface; 0 inside it. */
function boxDistance(box: WalkCollider, x: number, z: number): number {
  const dx = x - box.cx;
  const dz = z - box.cz;
  const lx = Math.abs(dx * box.ax + dz * box.az) - box.hw;
  const lz = Math.abs(dx * box.bx + dz * box.bz) - box.hd;
  return Math.hypot(Math.max(0, lx), Math.max(0, lz));
}
