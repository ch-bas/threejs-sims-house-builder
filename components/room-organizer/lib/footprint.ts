/**
 * Footprint primitives every layer must agree on (#451): an item's rotated
 * extents, the low-profile height cut, and clamping into the room. Also the
 * shape of the building itself: the rectangle, less the optional corner
 * cut-out that makes it an L (#727). A leaf module (it imports only types), so
 * `lib/walk-collision` (which `lib/geometry` itself imports) can share them
 * without a cycle. Import them from here.
 */

import type { FootprintCorner, FootprintCutout, FurnitureItem, RoomLayout, Vec2, WallId } from './types';

/**
 * Half-extents of an item's axis-aligned bounding box in world space, given
 * its oriented footprint. Shared by bounds tests, wall snapping, the walker's
 * colliders and the 2D renderer so rotated items report a consistent
 * footprint everywhere.
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
 * Anything at or under this height goes UNDER furniture by design (rugs are
 * 0.02 m) — a rug beneath a sofa is the intended use, not a collision, and
 * the walker steps over it.
 */
export const LOW_PROFILE_MAX_HEIGHT = 0.05;

/**
 * Clamp a position so the item's rotated footprint stays inside the room and,
 * with a `cutout`, out of the cut corner: it leaves by the shorter way.
 */
export function clampToFootprint(
  item: Pick<FurnitureItem, 'width' | 'depth' | 'rotation'>,
  position: { x: number; z: number },
  roomWidth: number,
  roomDepth: number,
  cutout?: FootprintCutout | null
): { x: number; z: number } {
  const { halfW, halfD } = rotatedHalfExtents(item);
  const maxX = Math.max(0, roomWidth / 2 - halfW);
  const maxZ = Math.max(0, roomDepth / 2 - halfD);
  const clamped = {
    x: Math.min(maxX, Math.max(-maxX, position.x)),
    z: Math.min(maxZ, Math.max(-maxZ, position.z)),
  };
  const notch = cutoutRect({ width: roomWidth, height: roomDepth, cutout });
  if (!notch || !cutout || !entersCutout(item, clamped, { width: roomWidth, height: roomDepth, cutout })) return clamped;
  const x = cutout.corner.endsWith('e') ? notch.x0 - halfW : notch.x1 + halfW;
  const z = cutout.corner.startsWith('n') ? notch.z1 + halfD : notch.z0 - halfD;
  // The shorter way out first, each exit kept within the walls: a wing too
  // narrow for the item sends it to the other one.
  const exits = [
    { x: Math.min(maxX, Math.max(-maxX, x)), z: clamped.z },
    { x: clamped.x, z: Math.min(maxZ, Math.max(-maxZ, z)) },
  ].sort((a, b) => Math.hypot(a.x - clamped.x, a.z - clamped.z) - Math.hypot(b.x - clamped.x, b.z - clamped.z));
  const building = { width: roomWidth, height: roomDepth, cutout };
  return exits.find((exit) => !entersCutout(item, exit, building)) ?? clamped;
}

// ---------------------------------------------------------------------------
// The building's outline (#727)
// ---------------------------------------------------------------------------

/** What the shape of the building depends on. `height` is the depth, as on `RoomLayout`. */
export interface FootprintBuilding extends Pick<RoomLayout, 'width' | 'height'> {
  cutout?: FootprintCutout | null | undefined;
}

/** World rectangle, x0 < x1 and z0 < z1. */
export interface FootprintRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** The smallest cut-out, in either direction. */
export const MIN_CUTOUT_SIZE = 1;
/** What each wing of the L keeps, in metres: narrower isn't a room. */
export const MIN_WING_SIZE = 2;
const CORNERS: readonly FootprintCorner[] = ['nw', 'ne', 'sw', 'se'];

export function isFootprintCutout(value: unknown): value is FootprintCutout {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { corner, width, depth } = value as Record<string, unknown>;
  const size = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n >= MIN_CUTOUT_SIZE;
  return CORNERS.includes(corner as FootprintCorner) && size(width) && size(depth);
}

/** Whether the cut leaves both wings of the L standing on a house this size. */
export function cutoutFits(cutout: Pick<FootprintCutout, 'width' | 'depth'>, width: number, depth: number): boolean {
  return (
    cutout.width >= MIN_CUTOUT_SIZE &&
    cutout.depth >= MIN_CUTOUT_SIZE &&
    cutout.width <= width - MIN_WING_SIZE &&
    cutout.depth <= depth - MIN_WING_SIZE
  );
}

export function sameCutout(a: FootprintCutout | undefined, b: FootprintCutout | undefined): boolean {
  return a?.corner === b?.corner && a?.width === b?.width && a?.depth === b?.depth;
}

/** The cut corner as a world rectangle on the footprint, or null for a plain rectangle. */
export function cutoutRect({ width, height, cutout }: FootprintBuilding): FootprintRect | null {
  if (!cutout) return null;
  const hw = width / 2;
  const hd = height / 2;
  const east = cutout.corner.endsWith('e');
  const north = cutout.corner.startsWith('n');
  return {
    x0: east ? hw - cutout.width : -hw,
    x1: east ? hw : -hw + cutout.width,
    z0: north ? -hd : hd - cutout.depth,
    z1: north ? -hd + cutout.depth : hd,
  };
}

/**
 * The outline of the building, clockwise on the plan from the north-west
 * corner: four points for a rectangle, six for an L. `grow` offsets it
 * outwards, for the plinth and the eaves. The cut keeps its size as the
 * rectangle grows, which is exactly an outward offset of its two walls.
 */
export function footprintOutline(building: FootprintBuilding, grow = 0): Vec2[] {
  const hw = building.width / 2 + grow;
  const hd = building.height / 2 + grow;
  const corners: Record<FootprintCorner, Vec2> = {
    nw: { x: -hw, z: -hd },
    ne: { x: hw, z: -hd },
    se: { x: hw, z: hd },
    sw: { x: -hw, z: hd },
  };
  const order: readonly FootprintCorner[] = ['nw', 'ne', 'se', 'sw'];
  const notch = cutoutRect({ ...building, width: hw * 2, height: hd * 2 });
  const corner = building.cutout?.corner;
  if (!notch || !corner) return order.map((key) => corners[key]);
  const innerX = corner.endsWith('e') ? notch.x0 : notch.x1;
  const innerZ = corner.startsWith('n') ? notch.z1 : notch.z0;
  const onNorthSouth = { x: innerX, z: corners[corner].z };
  const onEastWest = { x: corners[corner].x, z: innerZ };
  const inner = { x: innerX, z: innerZ };
  // Clockwise, ne and sw are reached along the north and south walls, nw and
  // se along the west and east ones.
  const steps = corner === 'ne' || corner === 'sw' ? [onNorthSouth, inner, onEastWest] : [onEastWest, inner, onNorthSouth];
  return order.flatMap((key) => (key === corner ? steps : [corners[key]]));
}

/**
 * Whether a world point lies on the building's outline, within `tolerance`:
 * on an outer wall's plane and along its run, including the two walls of
 * the cut corner. A partition drawn to the shell ends here (#660).
 */
export function onFootprintEdge(building: FootprintBuilding, x: number, z: number, tolerance = 0.001): boolean {
  const outline = footprintOutline(building);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    const minX = Math.min(a.x, b.x) - tolerance;
    const maxX = Math.max(a.x, b.x) + tolerance;
    const minZ = Math.min(a.z, b.z) - tolerance;
    const maxZ = Math.max(a.z, b.z) + tolerance;
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return true;
  }
  return false;
}

/** Whether a world point stands on the building: within the rectangle, not in the cut (edges count as on it). */
export function isInsideBuilding(building: FootprintBuilding, x: number, z: number): boolean {
  if (Math.abs(x) > building.width / 2 || Math.abs(z) > building.height / 2) return false;
  const notch = cutoutRect(building);
  return !(notch && x > notch.x0 && x < notch.x1 && z > notch.z0 && z < notch.z1);
}

/** The nearest point standing on the building: inside the rectangle, and out of the cut by the shorter way. */
export function clampToBuilding(building: FootprintBuilding, point: Vec2): Vec2 {
  const hw = building.width / 2;
  const hd = building.height / 2;
  const clamped = { x: Math.max(-hw, Math.min(hw, point.x)), z: Math.max(-hd, Math.min(hd, point.z)) };
  const notch = cutoutRect(building);
  const corner = building.cutout?.corner;
  if (!notch || !corner || isInsideBuilding(building, clamped.x, clamped.z)) return clamped;
  const x = corner.endsWith('e') ? notch.x0 : notch.x1;
  const z = corner.startsWith('n') ? notch.z1 : notch.z0;
  return Math.abs(clamped.x - x) <= Math.abs(clamped.z - z) ? { x, z: clamped.z } : { x: clamped.x, z };
}

/** Whether an item's rotated footprint at `position` overlaps the cut (touching its walls doesn't count). */
export function entersCutout(
  item: Pick<FurnitureItem, 'width' | 'depth' | 'rotation'>,
  position: { x: number; z: number },
  building: FootprintBuilding
): boolean {
  const notch = cutoutRect(building);
  if (!notch) return false;
  const { halfW, halfD } = rotatedHalfExtents(item);
  return position.x + halfW > notch.x0 && position.x - halfW < notch.x1 && position.z + halfD > notch.z0 && position.z - halfD < notch.z1;
}

/** The larger part of a rectangle left beside the cut, or null when it all lies inside. Unchanged when clear. */
export function trimRectToCutout<R extends { x: number; z: number; w: number; d: number }>(
  rect: R,
  notch: FootprintRect | null
): R | null {
  if (!notch) return rect;
  const right = rect.x + rect.w;
  const bottom = rect.z + rect.d;
  if (right <= notch.x0 || rect.x >= notch.x1 || bottom <= notch.z0 || rect.z >= notch.z1) return rect;
  const parts = [
    { x: rect.x, z: rect.z, w: notch.x0 - rect.x, d: rect.d },
    { x: notch.x1, z: rect.z, w: right - notch.x1, d: rect.d },
    { x: rect.x, z: rect.z, w: rect.w, d: notch.z0 - rect.z },
    { x: rect.x, z: notch.z1, w: rect.w, d: bottom - notch.z1 },
  ].filter((part) => part.w > 0 && part.d > 0);
  if (parts.length === 0) return null;
  const best = parts.reduce((kept, part) => (part.w * part.d > kept.w * kept.d ? part : kept));
  return { ...rect, ...best };
}

/** The building's floor area in m², before any porch. */
export function buildingArea(building: FootprintBuilding): number {
  const area = building.width * building.height;
  return building.cutout ? area - building.cutout.width * building.cutout.depth : area;
}

/** The two walls a cut adds to the four sides: one along x, one along z. */
export type ShellWallId = WallId | 'notch-x' | 'notch-z';

/**
 * One exterior wall as built. `side` is the way it faces, and the wall whose
 * colour, visibility and frame it shares: the two new walls of an L are more
 * of a north or south side and an east or west one. x1 ≤ x2 and z1 ≤ z2.
 */
export interface ShellWall {
  id: ShellWallId;
  side: WallId;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** A point along a side, in that side's frame: origin mid-house, along the wall mesh's local +X. */
export function alongSide(side: WallId, x: number, z: number): number {
  switch (side) {
    case 'north':
      return x;
    case 'south':
      // Rotated π: local +X is world −X.
      return -x;
    case 'east':
      return z;
    case 'west':
      // Rotated π/2: local +X is world −Z.
      return -z;
  }
}

/** A shell wall's two ends in its side's frame, low to high, and its length. */
export function shellWallSpan(wall: ShellWall): { from: number; to: number; length: number } {
  const a = alongSide(wall.side, wall.x1, wall.z1);
  const b = alongSide(wall.side, wall.x2, wall.z2);
  return { from: Math.min(a, b), to: Math.max(a, b), length: Math.abs(b - a) };
}

/**
 * Every exterior wall of the building: north, south, west, east, shortened
 * where the cut takes their end, then the cut's two walls.
 */
export function shellWalls(building: FootprintBuilding): ShellWall[] {
  const hw = building.width / 2;
  const hd = building.height / 2;
  const notch = cutoutRect(building);
  const corner = building.cutout?.corner;
  const trimX = (north: boolean): [number, number] =>
    notch && corner?.startsWith('n') === north ? (corner.endsWith('e') ? [-hw, notch.x0] : [notch.x1, hw]) : [-hw, hw];
  const trimZ = (east: boolean): [number, number] =>
    notch && corner?.endsWith('e') === east ? (corner.startsWith('n') ? [notch.z1, hd] : [-hd, notch.z0]) : [-hd, hd];
  const [northX1, northX2] = trimX(true);
  const [southX1, southX2] = trimX(false);
  const [westZ1, westZ2] = trimZ(false);
  const [eastZ1, eastZ2] = trimZ(true);
  const walls: ShellWall[] = [
    { id: 'north', side: 'north', x1: northX1, z1: -hd, x2: northX2, z2: -hd },
    { id: 'south', side: 'south', x1: southX1, z1: hd, x2: southX2, z2: hd },
    { id: 'west', side: 'west', x1: -hw, z1: westZ1, x2: -hw, z2: westZ2 },
    { id: 'east', side: 'east', x1: hw, z1: eastZ1, x2: hw, z2: eastZ2 },
  ];
  if (!notch || !corner) return walls;
  const north = corner.startsWith('n');
  const east = corner.endsWith('e');
  const innerX = east ? notch.x0 : notch.x1;
  const innerZ = north ? notch.z1 : notch.z0;
  walls.push(
    { id: 'notch-x', side: north ? 'north' : 'south', x1: notch.x0, z1: innerZ, x2: notch.x1, z2: innerZ },
    { id: 'notch-z', side: east ? 'east' : 'west', x1: innerX, z1: notch.z0, x2: innerX, z2: notch.z1 }
  );
  return walls;
}
