/**
 * Walker (NPC) navigation (#452). A storey's free floor is rasterised once
 * into a grid of cells a walker can stand in: the first-person walker's
 * colliders (`lib/walk-collision`: furniture and interior walls with their
 * door gaps), the stairs, and the storey's keep-out (porch and stairwell
 * holes) all block. Walkers then pick a destination in the free space they
 * can reach, route to it with A* and walk the string-pulled path, resolving
 * every step against the same colliders.
 *
 * Build the nav when the floor changes, never per frame. Pathing and
 * waypoint picks reuse the nav's scratch buffers, so a walker re-planning
 * mid-loop allocates nothing. Randomness is injected for deterministic tests.
 */

import { LOW_PROFILE_MAX_HEIGHT } from './footprint';
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
const EXTERIOR_MARGIN = 0.4;
/** Furniture within this gap of a free cell makes the cell a spot worth stopping at. */
const INTEREST_GAP = 0.35;
/** Destination picks that try a spot by furniture before any free cell. */
const INTEREST_CHANCE = 0.6;
const PICK_TRIES = 12;
/** Destinations closer than this (metres) are re-rolled so a walk is a walk. */
const MIN_TRIP = 1;
/** Waypoints a walker can hold; a longer path ends early and the walker re-plans. */
export const MAX_PATH_POINTS = 32;

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
  /** Walkers are clamped to this box (the footprint less the exterior margin). */
  halfW: number;
  halfD: number;
  /** 1 where a walker can stand. */
  walkable: Uint8Array;
  /** Connected region of each walkable cell, -1 elsewhere: a walker only targets its own. */
  region: Int32Array;
  free: Int32Array;
  freeCount: number;
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
export function npcNavSignature(input: Omit<NpcNavInput, 'roomWidth' | 'roomDepth'>): string {
  const parts: string[] = [];
  for (const item of input.items) {
    if (!item.position) continue;
    parts.push(
      `${item.id}:${item.type}:${item.category === 'outdoor' ? 1 : 0}:${item.position.x}:${item.position.z}:` +
        `${item.width}:${item.depth}:${item.height}:${item.rotation ?? 0}`
    );
  }
  parts.push('|');
  for (const wall of input.interiorWalls) parts.push(`${wall.id}:${wall.x1}:${wall.z1}:${wall.x2}:${wall.z2}`);
  parts.push('|');
  for (const rect of input.keepOut) parts.push(`${rect.x0}:${rect.x1}:${rect.z0}:${rect.z1}:${rect.rotation ?? 0}`);
  return parts.join(';');
}

/**
 * Rasterise one storey for the walkers. Returns null when the footprint is
 * too small to hold one.
 */
export function buildNpcNav(input: NpcNavInput): NpcNav | null {
  const { items, interiorWalls, keepOut, roomWidth, roomDepth } = input;
  const halfW = roomWidth / 2 - EXTERIOR_MARGIN;
  const halfD = roomDepth / 2 - EXTERIOR_MARGIN;
  if (!(halfW > NPC_RADIUS && halfD > NPC_RADIUS)) return null;

  const collisionOptions: WalkCollisionOptions = { roomWidth, roomDepth };
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
  for (const rect of keepOut) {
    colliders.push(
      boxCollider((rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2, rect.x1 - rect.x0, rect.z1 - rect.z0, rect.rotation ?? 0, false)
    );
  }

  const cols = Math.max(1, Math.ceil(roomWidth / CELL_SIZE));
  const rows = Math.max(1, Math.ceil(roomDepth / CELL_SIZE));
  const cells = cols * rows;
  const cellW = roomWidth / cols;
  const cellD = roomDepth / rows;
  const x0 = -roomWidth / 2;
  const z0 = -roomDepth / 2;

  // Every cell inside the walker box starts free; each collider then blocks
  // only the cells under its own reach, so the cost follows the furniture's
  // area, not cells × colliders.
  const walkable = new Uint8Array(cells);
  for (let row = 0; row < rows; row++) {
    if (Math.abs(z0 + (row + 0.5) * cellD) > halfD) continue;
    for (let col = 0; col < cols; col++) {
      if (Math.abs(x0 + (col + 0.5) * cellW) <= halfW) walkable[row * cols + col] = 1;
    }
  }
  const grid = { cols, rows, cellW, cellD, x0, z0 };
  for (const box of colliders) {
    if (box.outdoor) continue;
    forCellsNear(grid, box, NPC_RADIUS, (cell, x, z) => {
      if (walkable[cell] === 1 && boxDistance(box, x, z) < NPC_RADIUS) walkable[cell] = 0;
    });
  }
  // The free cells within reach of a piece of furniture face the nearest one.
  const heading = new Float32Array(cells).fill(Number.NaN);
  const interestGap = new Float32Array(cells).fill(Number.POSITIVE_INFINITY);
  for (const box of furniture) {
    forCellsNear(grid, box, NPC_RADIUS + INTEREST_GAP, (cell, x, z) => {
      if (walkable[cell] !== 1) return;
      const gap = boxDistance(box, x, z);
      if (gap >= NPC_RADIUS + INTEREST_GAP || gap >= interestGap[cell]!) return;
      interestGap[cell] = gap;
      // Three's rotation.y convention: heading 0 faces +Z.
      heading[cell] = Math.atan2(box.cx - x, box.cz - z);
    });
  }
  const freeList: number[] = [];
  const interestList: number[] = [];
  for (let cell = 0; cell < cells; cell++) {
    if (walkable[cell] !== 1) continue;
    freeList.push(cell);
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
    halfW,
    halfD,
    walkable,
    region: new Int32Array(cells).fill(-1),
    free: Int32Array.from(freeList),
    freeCount: freeList.length,
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
  labelRegions(nav);
  return nav;
}

/** The grid cell under a point, clamped to the grid. */
export function cellAt(nav: NpcNav, x: number, z: number): number {
  const col = Math.min(nav.cols - 1, Math.max(0, Math.floor((x - nav.x0) / nav.cellW)));
  const row = Math.min(nav.rows - 1, Math.max(0, Math.floor((z - nav.z0) / nav.cellD)));
  return row * nav.cols + col;
}

export function cellX(nav: NpcNav, cell: number): number {
  return nav.x0 + ((cell % nav.cols) + 0.5) * nav.cellW;
}

export function cellZ(nav: NpcNav, cell: number): number {
  return nav.z0 + (Math.floor(cell / nav.cols) + 0.5) * nav.cellD;
}

/** Whether a walker centred on this point stands in free space. */
export function isFreeAt(nav: NpcNav, x: number, z: number): boolean {
  if (Math.abs(x) > nav.halfW || Math.abs(z) > nav.halfD) return false;
  return nav.walkable[cellAt(nav, x, z)] === 1;
}

/** A random free cell, weighted by area (bigger rooms get more walkers); -1 when the floor is full. */
export function randomFreeCell(nav: NpcNav, random: () => number): number {
  if (nav.freeCount === 0) return -1;
  return nav.free[Math.min(nav.freeCount - 1, Math.floor(random() * nav.freeCount))] ?? -1;
}

/**
 * The free cell nearest a point (breadth-first over the grid), for a walker
 * the floor changed under — furniture dropped on it, a wall drawn through
 * it. -1 when the floor has no free cell.
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
    const col = cell % nav.cols;
    const row = (cell - col) / nav.cols;
    for (let n = 0; n < 4; n++) {
      const nc = col + NEIGHBOUR_DX[n]!;
      const nr = row + NEIGHBOUR_DZ[n]!;
      if (nc < 0 || nr < 0 || nc >= nav.cols || nr >= nav.rows) continue;
      const next = nr * nav.cols + nc;
      if (nav.seen[next] === stamp) continue;
      if (nav.walkable[next] === 1) return next;
      nav.seen[next] = stamp;
      queue[tail++] = next;
    }
  }
  return -1;
}

/**
 * Somewhere for a walker standing in `from` to head for: usually a spot
 * beside a piece of furniture (it stops and looks at the sofa, the
 * bookcase), otherwise any free cell, always one it can reach and at least
 * a metre away when the region allows. `taken` turns down spots another
 * walker already claimed, so they don't pile up at the one sofa (ignored
 * only when nothing else is left). -1 when its region has no other cell.
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
  const acceptable = (cell: number): boolean => {
    if (cell === from || nav.region[cell] !== region) return false;
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
  for (let i = 0; i < PICK_TRIES; i++) {
    const cell = nav.free[Math.floor(random() * nav.freeCount)] ?? -1;
    if (cell >= 0 && acceptable(cell)) return cell;
  }
  // A small or crowded region: scan from a random start for any other cell in it.
  const offset = Math.floor(random() * nav.freeCount);
  let fallback = -1;
  for (let i = 0; i < nav.freeCount; i++) {
    const cell = nav.free[(offset + i) % nav.freeCount]!;
    if (cell === from || nav.region[cell] !== region) continue;
    if (acceptable(cell)) return cell;
    if (fallback < 0) fallback = cell;
  }
  return fallback;
}

/**
 * Route from a point to a cell's centre and write the string-pulled
 * waypoints (x, z pairs, start excluded, goal included) into `out`. Returns
 * the number of waypoints, 0 when there is no route. At most
 * `out.length / 2` are written; a longer route ends early.
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

/** Whether a straight walk between two points stays on free cells. */
export function lineIsFree(nav: NpcNav, ax: number, az: number, bx: number, bz: number): boolean {
  const length = Math.hypot(bx - ax, bz - az);
  const step = Math.min(nav.cellW, nav.cellD) * 0.5;
  const samples = Math.max(1, Math.ceil(length / step));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    if (nav.walkable[cellAt(nav, ax + (bx - ax) * t, az + (bz - az) * t)] !== 1) return false;
  }
  return true;
}

/**
 * Grid A* (8-connected, no corner cutting, octile heuristic) from `start`
 * to `goal`. Writes the cell path, start first, into `nav.rawPath` and
 * returns its length, 0 when unreachable.
 */
function aStar(nav: NpcNav, start: number, goal: number): number {
  const { cols, rows, walkable, g, f, parent, seen, closed } = nav;
  const stamp = nextStamp(nav);
  const goalCol = goal % cols;
  const goalRow = (goal - goalCol) / cols;
  const heuristic = (cell: number): number => {
    const col = cell % cols;
    const dx = Math.abs(col - goalCol);
    const dz = Math.abs((cell - col) / cols - goalRow);
    return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
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
    const col = current % cols;
    const row = (current - col) / cols;
    for (let n = 0; n < 8; n++) {
      const dx = NEIGHBOUR_DX[n]!;
      const dz = NEIGHBOUR_DZ[n]!;
      const nc = col + dx;
      const nr = row + dz;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const next = nr * cols + nc;
      if (walkable[next] !== 1 || closed[next] === stamp) continue;
      // A diagonal step needs both side cells free, or it clips a corner.
      if (n >= 4 && (walkable[row * cols + nc] !== 1 || walkable[nr * cols + col] !== 1)) continue;
      const cost = g[current]! + (n >= 4 ? SQRT2 : 1);
      if (seen[next] === stamp && cost >= g[next]!) continue;
      g[next] = cost;
      f[next] = cost + heuristic(next);
      parent[next] = current;
      if (seen[next] === stamp && nav.heapPos[next]! >= 0) {
        siftUp(nav, nav.heapPos[next]!);
      } else {
        seen[next] = stamp;
        heapSize = heapPush(nav, heapSize, next);
      }
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

/** Flood-fill the walkable cells into regions, using A*'s moves. */
function labelRegions(nav: NpcNav): void {
  const { cols, rows, walkable, region } = nav;
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
      const col = cell % cols;
      const row = (cell - col) / cols;
      for (let n = 0; n < 8; n++) {
        const nc = col + NEIGHBOUR_DX[n]!;
        const nr = row + NEIGHBOUR_DZ[n]!;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const next = nr * cols + nc;
        if (walkable[next] !== 1 || region[next]! >= 0) continue;
        if (n >= 4 && (walkable[row * cols + nc] !== 1 || walkable[nr * cols + col] !== 1)) continue;
        region[next] = label;
        queue[tail++] = next;
      }
    }
    label++;
  }
}

function nextStamp(nav: NpcNav): number {
  nav.stamp = nav.stamp >= 0xfffffffe ? 1 : nav.stamp + 1;
  if (nav.stamp === 1) {
    nav.seen.fill(0);
    nav.closed.fill(0);
  }
  return nav.stamp;
}

interface GridShape {
  cols: number;
  rows: number;
  cellW: number;
  cellD: number;
  x0: number;
  z0: number;
}

/** Visit the cells whose centres fall in a box's AABB grown by `reach`. */
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
      visit(row * grid.cols + col, grid.x0 + (col + 0.5) * grid.cellW, z);
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
