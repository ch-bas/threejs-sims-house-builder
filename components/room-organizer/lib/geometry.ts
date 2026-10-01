import { isWallHung, mountBand } from './mount-band';
import { isOpening, isWallMounted } from './opening-snap';
import { buildWalkColliders, type WalkCollider } from './walk-collision';
import type { FurnitureItem, InteriorWall, Vec2 } from './types';

export function boundingRadius(item: Pick<FurnitureItem, 'width' | 'depth'>): number {
  return Math.hypot(item.width / 2, item.depth / 2);
}

/**
 * Half-extents of an item's axis-aligned bounding box in world space, given
 * its oriented footprint. Shared by bounds tests, wall snapping, and the 2D
 * renderer so rotated items report a consistent footprint everywhere.
 */
export function rotatedHalfExtents(
  item: Pick<FurnitureItem, 'width' | 'depth' | 'rotation'>
): { halfW: number; halfD: number } {
  const cos = Math.abs(Math.cos(item.rotation ?? 0));
  const sin = Math.abs(Math.sin(item.rotation ?? 0));
  return {
    halfW: (item.width * cos + item.depth * sin) / 2,
    halfD: (item.width * sin + item.depth * cos) / 2,
  };
}

/**
 * Oriented-bounding-box overlap via the separating-axis theorem (SAT) in the
 * XZ plane. The cheap bounding-circle test runs first as a broad phase; SAT
 * then eliminates the false positives circles produce on long, thin items
 * (sofas, fences, counters) sitting diagonally near each other.
 */
export function itemsOverlap(a: FurnitureItem, b: FurnitureItem): boolean {
  if (!a.position || !b.position) return false;
  const distance = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
  if (distance >= boundingRadius(a) + boundingRadius(b)) return false;
  return obbOverlap(toObb(a), toObb(b));
}

interface Obb {
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
}

function toObb(item: FurnitureItem): Obb {
  const rotation = item.rotation ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    cx: item.position?.x ?? 0,
    cz: item.position?.z ?? 0,
    hw: item.width / 2,
    hd: item.depth / 2,
    // Three's rotY maps the local +X axis to (cosθ, −sinθ) in world XZ, so the
    // width axis is (cos, −sin) and the depth axis is (sin, cos).
    ax: cos,
    az: -sin,
    bx: sin,
    bz: cos,
  };
}

function obbOverlap(a: Obb, b: Obb): boolean {
  // SAT: two convex boxes are disjoint iff a separating axis exists among the
  // four face normals. Project each box's half-extents and the centre delta
  // onto every axis and compare.
  const axes: ReadonlyArray<readonly [number, number]> = [
    [a.ax, a.az],
    [a.bx, a.bz],
    [b.ax, b.az],
    [b.bx, b.bz],
  ];
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  for (const [x, z] of axes) {
    const projectedDistance = Math.abs(dx * x + dz * z);
    const extentA = a.hw * Math.abs(a.ax * x + a.az * z) + a.hd * Math.abs(a.bx * x + a.bz * z);
    const extentB = b.hw * Math.abs(b.ax * x + b.az * z) + b.hd * Math.abs(b.bx * x + b.bz * z);
    if (projectedDistance >= extentA + extentB) return false;
  }
  return true;
}

export function itemInBounds(item: FurnitureItem, roomWidth: number, roomDepth: number): boolean {
  if (!item.position) return false;
  // Rotation-aware AABB of the item's oriented footprint.
  const { halfW, halfD } = rotatedHalfExtents(item);
  return (
    item.position.x - halfW >= -roomWidth / 2 &&
    item.position.x + halfW <= roomWidth / 2 &&
    item.position.z - halfD >= -roomDepth / 2 &&
    item.position.z + halfD <= roomDepth / 2
  );
}

/** True when the item's rotation-aware AABB is entirely beyond the room rect. */
export function itemFullyOutside(item: FurnitureItem, roomWidth: number, roomDepth: number): boolean {
  if (!item.position) return false;
  const { halfW, halfD } = rotatedHalfExtents(item);
  return (
    item.position.x + halfW <= -roomWidth / 2 ||
    item.position.x - halfW >= roomWidth / 2 ||
    item.position.z + halfD <= -roomDepth / 2 ||
    item.position.z - halfD >= roomDepth / 2
  );
}

/**
 * Anything at or under this height goes UNDER furniture by design (rugs are
 * 0.02 m) — a rug beneath a sofa is the intended use, not a collision.
 */
export const LOW_PROFILE_MAX_HEIGHT = 0.05;

export function isLowProfile(item: Pick<FurnitureItem, 'height'>): boolean {
  return item.height <= LOW_PROFILE_MAX_HEIGHT;
}

// Intended-stacking families (#120): small tabletop items sit ON these
// surfaces (the Office template puts the computer and lamp on the desk) and
// seats tuck UNDER tables (the Kitchen template's dining chairs). Items have
// no elevation field, so the layer model is by type. The 2D plan's draw order
// (lib/plan-order, #286) reads the same families.
const SURFACE_TYPES = new Set([
  'desk',
  'dining-table',
  'table',
  'side-table',
  'picnic-table',
  'coffee-table',
  'counter',
  'nightstand',
  'dresser',
]);
const TABLETOP_TYPES = new Set(['computer', 'lamp', 'plant', 'books', 'candles', 'flowerpot', 'wifi']);
const SEAT_TYPES = new Set(['chair', 'dining-chair', 'bench', 'armchair', 'garden-bench']);

/** Small items that sit ON a surface (desk, table, counter) rather than the floor. */
export function isTabletopType(type: string): boolean {
  return TABLETOP_TYPES.has(type);
}

function isIntendedStack(a: FurnitureItem, b: FurnitureItem): boolean {
  const stacksOn = (surface: FurnitureItem, top: FurnitureItem): boolean =>
    SURFACE_TYPES.has(surface.type) && (TABLETOP_TYPES.has(top.type) || SEAT_TYPES.has(top.type));
  return stacksOn(a, b) || stacksOn(b, a);
}

/**
 * Wall-hung decor shares the floor's footprint but not its height (#376): a
 * painting over a sofa is the intended use. A pair with a hung item collides
 * only where the two mount bands overlap, so hung items still collide with
 * each other and with furniture tall enough to reach them.
 */
function bandsOverlap(a: FurnitureItem, b: FurnitureItem): boolean {
  const bandA = mountBand(a);
  const bandB = mountBand(b);
  return bandA.bottom < bandB.top && bandB.bottom < bandA.top;
}

/**
 * Layer-aware pair test (#120). Wall-plane items (doors, windows, cameras)
 * collide only with EACH OTHER — two doors overlapping on one wall is real,
 * but floor furniture flush under a window or beneath a 2.4 m camera is the
 * intended use. The old symmetric 2D test flagged the shipped Living Room
 * template (rug under sofa) red on load.
 */
function pairCollides(a: FurnitureItem, b: FurnitureItem): boolean {
  if (isWallMounted(a.type) !== isWallMounted(b.type)) return false;
  // Within the wall layer, a camera mounts at 2.4 m — clear of every door
  // (2.05 m) and window, so camera-over-the-entrance is intended use, not a
  // collision (#146). Camera-vs-camera and opening-vs-opening still collide.
  if (
    (a.type === 'security-camera' && isOpening(b.type)) ||
    (b.type === 'security-camera' && isOpening(a.type))
  ) {
    return false;
  }
  if (isLowProfile(a) || isLowProfile(b)) return false;
  if (isIntendedStack(a, b)) return false;
  if ((isWallHung(a.type) || isWallHung(b.type)) && !bandsOverlap(a, b)) return false;
  return itemsOverlap(a, b);
}

/**
 * A world-space (x/z, metres) rectangle inside the room that furniture can't
 * occupy: the recessed entrance's porch (#285), or a stairwell hole cut by
 * the stairs on the floor below (#372).
 */
export interface KeepOutRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Rotation (radians, Y axis) about the rect's centre; absent means axis-aligned. */
  rotation?: number;
  /**
   * A hole in the floor rather than outside space: only what stands on the
   * floor falls in. Low-profile items, wall-hung decor and stairs stacked on
   * the flight below are exempt, and outdoor items can't stand in it.
   */
  hole?: boolean;
}

/** True when the item's footprint overlaps the rect (touching edges don't count). */
function itemEntersRect(item: FurnitureItem, rect: KeepOutRect): boolean {
  if (!item.position) return false;
  if (rect.rotation) {
    const cos = Math.cos(rect.rotation);
    const sin = Math.sin(rect.rotation);
    return obbOverlap(toObb(item), {
      cx: (rect.x0 + rect.x1) / 2,
      cz: (rect.z0 + rect.z1) / 2,
      hw: (rect.x1 - rect.x0) / 2,
      hd: (rect.z1 - rect.z0) / 2,
      ax: cos,
      az: -sin,
      bx: sin,
      bz: cos,
    });
  }
  const { halfW, halfD } = rotatedHalfExtents(item);
  return (
    item.position.x - halfW < rect.x1 &&
    item.position.x + halfW > rect.x0 &&
    item.position.z - halfD < rect.z1 &&
    item.position.z + halfD > rect.z0
  );
}

/** True when the item's rotation-aware AABB lies wholly inside an axis-aligned rect. */
function itemInsideRect(item: FurnitureItem, rect: KeepOutRect): boolean {
  if (!item.position || rect.rotation) return false;
  const { halfW, halfD } = rotatedHalfExtents(item);
  return (
    item.position.x - halfW >= rect.x0 &&
    item.position.x + halfW <= rect.x1 &&
    item.position.z - halfD >= rect.z0 &&
    item.position.z + halfD <= rect.z1
  );
}

function keepsOut(item: FurnitureItem, rect: KeepOutRect): boolean {
  if (rect.hole && (isLowProfile(item) || isWallHung(item.type) || item.type === 'stairs')) return false;
  return itemEntersRect(item, rect);
}

/** Whether a floor item stands inside one of the storey's partitions (#368). */
function straddlesInteriorWall(
  item: FurnitureItem,
  allItems: readonly FurnitureItem[],
  interiorWalls: readonly InteriorWall[],
  roomWidth: number,
  roomDepth: number
): boolean {
  // The walker's wall boxes, door gaps included. Wall-plane items never
  // become item colliders, so passing only them returns just the walls.
  const walls: readonly WalkCollider[] = buildWalkColliders(
    allItems.filter((other) => isWallMounted(other.type)),
    interiorWalls,
    { roomWidth, roomDepth }
  );
  const box = toObb(item);
  return walls.some((wall) => obbOverlap(box, wall));
}

/** What else on the storey an item may not overlap, besides other items. */
export interface CollisionContext {
  /** Porch and stairwell rects (`floorKeepOut`). */
  keepOut?: readonly KeepOutRect[] | undefined;
  /** The storey's partitions. */
  interiorWalls?: readonly InteriorWall[] | undefined;
}

export function hasCollisions(
  item: FurnitureItem,
  allItems: readonly FurnitureItem[],
  roomWidth: number,
  roomDepth: number,
  context: CollisionContext = {}
): boolean {
  if (!item.position) return false;
  const keepOut = context.keepOut ?? [];
  const interiorWalls = context.interiorWalls ?? [];
  const overlapsAnother = (): boolean =>
    allItems.some((other) => other.id !== item.id && pairCollides(item, other));
  // Wall-plane items (doors, windows, cameras) live in — or on the exterior
  // side of — the wall by design, so the room-bounds test never applies:
  // they'd always poke through the wall and read as out-of-bounds.
  if (isWallMounted(item.type)) return overlapsAnother();
  // Outdoor items belong outside the building footprint — flag them when any
  // part of their footprint pokes into the room. The porch is outside space
  // too, so one standing wholly on it is fine (#406). They still collide with
  // other items (e.g. two trees on the same spot).
  if (item.category === 'outdoor') {
    const onPorch = keepOut.some((rect) => !rect.hole && itemInsideRect(item, rect));
    if (!onPorch && !itemFullyOutside(item, roomWidth, roomDepth)) return true;
    return overlapsAnother();
  }
  if (!itemInBounds(item, roomWidth, roomDepth)) return true;
  // The porch is outside too, just inside the footprint (#285); a stairwell
  // is a hole in the floor (#372).
  if (keepOut.some((rect) => keepsOut(item, rect))) return true;
  // Rugs run under a partition's baseboard and decor hangs on it; anything
  // else standing inside one is impassable in the walkthrough too (#368).
  if (
    interiorWalls.length > 0 &&
    !isLowProfile(item) &&
    !isWallHung(item.type) &&
    straddlesInteriorWall(item, allItems, interiorWalls, roomWidth, roomDepth)
  ) {
    return true;
  }
  return overlapsAnother();
}

export type AutoOrganizeStrategy = 'shelf' | 'by-category' | 'by-size';

export function autoOrganize(
  items: readonly FurnitureItem[],
  roomWidth: number,
  roomDepth: number,
  strategy: AutoOrganizeStrategy = 'shelf',
  margin = 0.3
): FurnitureItem[] {
  if (items.length === 0) return [];

  const ordered = orderItemsForStrategy(items, strategy);
  // Locked items keep their spot and rotation like every other geometry
  // path (#389), and the packing flows around them.
  const obstacles = items
    .filter((item) => item.locked && item.position)
    .map((item) => {
      const { halfW, halfD } = rotatedHalfExtents(item);
      const { x, z } = item.position ?? { x: 0, z: 0 };
      return { x0: x - halfW, x1: x + halfW, z0: z - halfD, z1: z + halfD };
    });
  const organized: FurnitureItem[] = [];
  let cursorX = -roomWidth / 2 + margin;
  let cursorZ = -roomDepth / 2 + margin;
  let rowMaxDepth = 0;

  for (const item of ordered) {
    if (item.locked) {
      organized.push(item);
      continue;
    }

    let placed: Vec2 | null = null;
    for (;;) {
      if (cursorX + item.width + margin > roomWidth / 2) {
        cursorX = -roomWidth / 2 + margin;
        // A row a locked item filled is empty; with no margin it must still
        // advance, or the skip loop below never ends.
        const rowStep = rowMaxDepth + margin;
        cursorZ += rowStep > 0 ? rowStep : item.depth;
        rowMaxDepth = 0;
      }

      // An item the grid can't hold — wider than the room even on a fresh
      // row, or the rows have consumed the remaining depth — keeps its
      // original spot and rotation: packing what fits beats stacking every
      // leftover in an overlapping pile at the origin (#128).
      const fitsWidth = cursorX + item.width + margin <= roomWidth / 2;
      const fitsDepth = cursorZ + item.depth + margin <= roomDepth / 2;
      if (!fitsWidth || !fitsDepth) break;

      // Skip past a locked item in the way (its edge plus the margin is
      // always right of the cursor, so this terminates).
      const blocker = obstacles.find(
        (rect) =>
          cursorX < rect.x1 + margin &&
          cursorX + item.width + margin > rect.x0 &&
          cursorZ < rect.z1 + margin &&
          cursorZ + item.depth + margin > rect.z0
      );
      if (blocker) {
        cursorX = blocker.x1 + margin;
        continue;
      }

      placed = { x: cursorX + item.width / 2, z: cursorZ + item.depth / 2 };
      cursorX += item.width + margin;
      rowMaxDepth = Math.max(rowMaxDepth, item.depth);
      break;
    }

    organized.push(placed ? { ...item, position: placed, rotation: 0 } : item);
  }

  return organized;
}

function orderItemsForStrategy(items: readonly FurnitureItem[], strategy: AutoOrganizeStrategy): readonly FurnitureItem[] {
  if (strategy === 'shelf') return items;

  if (strategy === 'by-size') {
    return [...items].sort((a, b) => b.width * b.depth - a.width * a.depth);
  }

  // by-category: cluster items with the same category together.
  return [...items].sort((a, b) => (a.category ?? 'zzz').localeCompare(b.category ?? 'zzz'));
}

export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export interface SnapToWallOptions {
  position: Vec2;
  item: Pick<FurnitureItem, 'width' | 'depth' | 'rotation' | 'category'>;
  roomWidth: number;
  roomDepth: number;
  /** Maximum distance (m) from the wall at which snapping is applied. */
  threshold?: number;
}

/**
 * Snap a position flush against the nearest wall face when within
 * `threshold` of it, on either side. Indoor items snap to the inner face,
 * outdoor items to the outer one (they live outside the footprint), and only
 * alongside the wall: an item far from the building is left alone (#380).
 * Uses the item's rotated axis-aligned half-extents.
 */
export function snapToWall({
  position,
  item,
  roomWidth,
  roomDepth,
  threshold = 0.35,
}: SnapToWallOptions): Vec2 {
  const { halfW, halfD } = rotatedHalfExtents(item);
  // Inner face: the centre sits half an extent inside the wall; outer: outside.
  const sign = item.category === 'outdoor' ? 1 : -1;
  const faceX = roomWidth / 2 + sign * halfW;
  const faceZ = roomDepth / 2 + sign * halfD;

  let { x, z } = position;
  // Beside the wall: the item's extent overlaps the wall's run.
  const besideXWalls = Math.abs(position.z) < roomDepth / 2 + halfD;
  const besideZWalls = Math.abs(position.x) < roomWidth / 2 + halfW;
  if (besideXWalls) {
    if (Math.abs(x + faceX) < threshold) x = -faceX;
    else if (Math.abs(x - faceX) < threshold) x = faceX;
  }
  if (besideZWalls) {
    if (Math.abs(z + faceZ) < threshold) z = -faceZ;
    else if (Math.abs(z - faceZ) < threshold) z = faceZ;
  }

  return { x, z };
}

export function totalCost(items: readonly FurnitureItem[]): number {
  return items.reduce((sum, item) => sum + (item.price ?? 0), 0);
}

/**
 * Interior floor area covered by furniture. Outdoor items are excluded: they
 * must sit entirely outside the room, so counting them inflated the interior
 * coverage of a bare room with a garden (#164).
 */
export function footprintArea(items: readonly FurnitureItem[]): number {
  return items.reduce(
    (sum, item) => (item.category === 'outdoor' ? sum : sum + item.width * item.depth),
    0
  );
}

export function itemCountByCategory(items: readonly FurnitureItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.category ?? 'uncategorized';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface SnapToNeighborOptions {
  position: Vec2;
  movingItem: Pick<FurnitureItem, 'id' | 'width' | 'depth' | 'rotation'>;
  otherItems: readonly FurnitureItem[];
  /** Items moving with this one (a group drag): their positions are stale, never targets (#380). */
  excludeIds?: ReadonlySet<string>;
  threshold?: number;
}

/**
 * Snap a candidate position so that the moving item's edges or centers align
 * with the nearest neighbor's edges or centers (within `threshold`). Returns
 * the adjusted position. Works in rotated-bounding-box space.
 */
export function snapToNeighbors({
  position,
  movingItem,
  otherItems,
  excludeIds,
  threshold = 0.2,
}: SnapToNeighborOptions): Vec2 {
  const { cosAbs, sinAbs } = rotatedExtents(movingItem.rotation ?? 0);
  const halfW = (movingItem.width * cosAbs + movingItem.depth * sinAbs) / 2;
  const halfD = (movingItem.width * sinAbs + movingItem.depth * cosAbs) / 2;

  let bestX = position.x;
  let bestZ = position.z;
  let bestXDelta = threshold;
  let bestZDelta = threshold;

  for (const other of otherItems) {
    if (other.id === movingItem.id || excludeIds?.has(other.id) || !other.position) continue;
    const otherExtents = rotatedExtents(other.rotation ?? 0);
    const otherHalfW = (other.width * otherExtents.cosAbs + other.depth * otherExtents.sinAbs) / 2;
    const otherHalfD = (other.width * otherExtents.sinAbs + other.depth * otherExtents.cosAbs) / 2;

    const candidatesX = [
      other.position.x,
      other.position.x - otherHalfW + halfW,
      other.position.x + otherHalfW - halfW,
      other.position.x - otherHalfW - halfW,
      other.position.x + otherHalfW + halfW,
    ];
    const candidatesZ = [
      other.position.z,
      other.position.z - otherHalfD + halfD,
      other.position.z + otherHalfD - halfD,
      other.position.z - otherHalfD - halfD,
      other.position.z + otherHalfD + halfD,
    ];

    for (const cx of candidatesX) {
      const delta = Math.abs(cx - position.x);
      if (delta < bestXDelta) {
        bestXDelta = delta;
        bestX = cx;
      }
    }
    for (const cz of candidatesZ) {
      const delta = Math.abs(cz - position.z);
      if (delta < bestZDelta) {
        bestZDelta = delta;
        bestZ = cz;
      }
    }
  }

  return { x: bestX, z: bestZ };
}

function rotatedExtents(rotation: number): { cosAbs: number; sinAbs: number } {
  return { cosAbs: Math.abs(Math.cos(rotation)), sinAbs: Math.abs(Math.sin(rotation)) };
}
