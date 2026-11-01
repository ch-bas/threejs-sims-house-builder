import { clampToBuilding, cutoutRect, footprintOutline, type FootprintBuilding, type FootprintRect } from './footprint';
import { projectOntoSegment } from './opening-snap';
import type { FootprintCutout, InteriorWall, Vec2 } from './types';

export type WallSnapKind = 'vertex' | 'on-wall' | 'right-angle' | 'angle' | 'none';

export interface WallSnapResult {
  point: Vec2;
  kind: WallSnapKind;
}

/** Free endpoints round to this, the step zones use, so areas read as clean numbers (#723). */
export const WALL_GRID = 0.1;
/** A chained wall turns in these steps from its anchor; Shift draws it free (#723). */
export const WALL_ANGLE_STEP_DEG = 15;
/** Shorter than this a click ends the chain rather than place a wall. */
export const MIN_WALL_LENGTH = 0.1;
/** Shorter than this a pointer gives no direction to snap. */
const MIN_AIM = 0.05;

export interface WallSnapOptions {
  /** The pointer position in world space. */
  point: Vec2;
  /** Walls already on the floor — their endpoints are vertex-snap targets. */
  existingWalls: readonly InteriorWall[];
  /** When chaining, the previous endpoint enables the angle steps. */
  fromPoint?: Vec2 | null;
  /** Building footprint, used as additional snap targets at the corners and edges. */
  roomWidth: number;
  roomDepth: number;
  /** The corner cut out of the building (#727): its two walls snap, and nothing lands in it. */
  cutout?: FootprintCutout | undefined;
  /** Maximum distance, in metres, considered "near enough" to snap. */
  snapDistance?: number;
  /** Shift: no angle steps and no grid. Vertices and walls still catch the point. */
  free?: boolean;
}

/**
 * Resolve a freeform pointer into a snapped wall endpoint:
 *
 *   1. Snap to any existing wall endpoint (or building corner) within the
 *      snap distance — most useful for closing rectangles.
 *   2. Snap onto the body of an existing wall or the building's edge (a
 *      T-junction), so no gap is left for the walker to slip through (#412).
 *      When chaining, the point stays on the wall's angle step if it can.
 *   3. When chaining, turn to the nearest 15° step from `fromPoint` at a length
 *      on the 0.1 m grid: 'right-angle' on the axes, 'angle' between them.
 *   4. Otherwise round the pointer to the grid, still kind 'none'. `free`
 *      skips the steps and the grid and returns the pointer as it is.
 *
 * The final point is always clamped to the building's outline so users can't
 * draw walls into the grass beyond its edge, or into a corner cut out of it.
 *
 * Pure: no React, no Three.js. Easy to unit test.
 */
export function snapWallEndpoint({
  point,
  existingWalls,
  fromPoint = null,
  roomWidth,
  roomDepth,
  cutout,
  snapDistance = 0.45,
  free = false,
}: WallSnapOptions): WallSnapResult {
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const building: FootprintBuilding = { width: roomWidth, height: roomDepth, cutout };
  const notch = cutoutRect(building);
  // Clamp the cursor up front — every snap branch operates against a
  // point already inside the lot, so vertex / right-angle snaps stay
  // accurate even when the user has dragged the cursor onto the grass.
  const clamped = clampToBuilding(building, point);
  const outline = footprintOutline(building);

  // 1. Vertex snap — existing wall endpoints + building corners.
  const vertices: Vec2[] = [];
  for (const wall of existingWalls) {
    vertices.push({ x: wall.x1, z: wall.z1 }, { x: wall.x2, z: wall.z2 });
  }
  vertices.push(...outline);

  let best: WallSnapResult | null = null;
  let bestDist = snapDistance;
  for (const vertex of vertices) {
    // Don't snap to a stale endpoint outside the lot — that would defeat
    // the clamp and re-poison new walls.
    if (
      vertex.x < -halfW - 0.001 ||
      vertex.x > halfW + 0.001 ||
      vertex.z < -halfD - 0.001 ||
      vertex.z > halfD + 0.001 ||
      (notch && vertex.x > notch.x0 && vertex.x < notch.x1 && vertex.z > notch.z0 && vertex.z < notch.z1)
    ) {
      continue;
    }
    const distance = Math.hypot(vertex.x - clamped.x, vertex.z - clamped.z);
    if (distance < bestDist) {
      bestDist = distance;
      best = { point: vertex, kind: 'vertex' };
    }
  }
  if (best) return best;

  // The angle step from the chain anchor, if any.
  // Aimed by where the cursor is, not where the cut pushed it: the reach stops the wall at the notch.
  const inLot = clampToBuilding({ width: roomWidth, height: roomDepth }, point);
  const angled = fromPoint && !free ? angleStep(fromPoint, inLot, building) : null;

  // 2. On-wall snap — the nearest wall body, the building's edges included.
  // While chaining, a junction that would bend a square wall off its axis
  // gives way to the right-angle snap (a wall drawn alongside another stays straight).
  const segments: Array<{ x1: number; z1: number; x2: number; z2: number }> = [
    ...existingWalls,
    ...outline.map((from, index) => {
      const to = outline[(index + 1) % outline.length]!;
      return { x1: from.x, z1: from.z, x2: to.x, z2: to.z };
    }),
  ];
  bestDist = snapDistance;
  for (const segment of segments) {
    const projected = projectOntoSegment(clamped, segment, 0);
    if (!projected || projected.distance >= bestDist) continue;
    const square = fromPoint && !free
      ? squareOnto(segment, fromPoint, clamped, snapDistance) ?? rayOnto(segment, fromPoint, angled?.point, clamped, snapDistance)
      : null;
    if (!square && angled?.kind === 'right-angle') continue;
    bestDist = projected.distance;
    const landed = square ?? (free ? projected.point : gridAlong(projected.point, segment));
    best = { point: clampToBuilding(building, landed), kind: 'on-wall' };
  }
  if (best) return best;

  // 3. Angle step.
  if (angled) return angled;

  // 4. The grid, unless drawing free.
  if (free) return { point: clamped, kind: 'none' };
  return { point: clampToBuilding(building, { x: onGrid(clamped.x), z: onGrid(clamped.z) }), kind: 'none' };
}

/** Divides by 10, as 3 * 0.1 is 0.30000000000000004; + 0 turns -0 into 0. */
function onGrid(value: number): number {
  return Math.round(value / WALL_GRID) / 10 + 0;
}

/** A point on a square wall, rounded along it within its ends: the snap keeps the other axis. */
function gridAlong(point: Vec2, segment: { x1: number; z1: number; x2: number; z2: number }): Vec2 {
  const within = (value: number, a: number, b: number): number => Math.max(Math.min(a, b), Math.min(Math.max(a, b), value));
  if (Math.abs(segment.z2 - segment.z1) < 1e-9) return { ...point, x: within(onGrid(point.x), segment.x1, segment.x2) };
  if (Math.abs(segment.x2 - segment.x1) < 1e-9) return { ...point, z: within(onGrid(point.z), segment.z1, segment.z2) };
  return point;
}

/** How far a ray from a point inside the lot runs before it leaves the lot, or enters `notch`. */
export function reachInLot(from: Vec2, dirX: number, dirZ: number, halfW: number, halfD: number, notch: FootprintRect | null = null): number {
  const along = (start: number, dir: number, half: number): number =>
    dir > 1e-9 ? (half - start) / dir : dir < -1e-9 ? (-half - start) / dir : Infinity;
  const reach = Math.max(0, Math.min(along(from.x, dirX, halfW), along(from.z, dirZ, halfD)));
  return notch ? Math.min(reach, reachToNotch(from, dirX, dirZ, notch)) : reach;
}

/** Where a ray enters the open rectangle, or Infinity: running along its edge isn't entering. */
function reachToNotch(from: Vec2, dirX: number, dirZ: number, notch: FootprintRect): number {
  const slab = (start: number, dir: number, low: number, high: number): [number, number] | null => {
    if (Math.abs(dir) <= 1e-9) return start > low && start < high ? [-Infinity, Infinity] : null;
    const a = (low - start) / dir;
    const b = (high - start) / dir;
    return [Math.min(a, b), Math.max(a, b)];
  };
  const x = slab(from.x, dirX, notch.x0, notch.x1);
  const z = slab(from.z, dirZ, notch.z0, notch.z1);
  if (!x || !z) return Infinity;
  const enter = Math.max(x[0], z[0], 0);
  return enter < Math.min(x[1], z[1]) - 1e-9 ? enter : Infinity;
}

/** The cursor turned to the nearest angle step from `from`, its length on the grid and on the building. */
function angleStep(from: Vec2, cursor: Vec2, building: FootprintBuilding): WallSnapResult | null {
  const length = Math.hypot(cursor.x - from.x, cursor.z - from.z);
  if (length < MIN_AIM) return null;
  const step = (WALL_ANGLE_STEP_DEG * Math.PI) / 180;
  const steps = Math.round(Math.atan2(cursor.z - from.z, cursor.x - from.x) / step);
  // Rounded so the axes are exact: cos(90°) is 6e-17, a wall a hair off square.
  const dirX = Math.round(Math.cos(steps * step) * 1e12) / 1e12;
  const dirZ = Math.round(Math.sin(steps * step) * 1e12) / 1e12;
  const reach = Math.min(Math.max(WALL_GRID, onGrid(length)), reachInLot(from, dirX, dirZ, building.width / 2, building.height / 2, cutoutRect(building)));
  return {
    point: { x: from.x + dirX * reach, z: from.z + dirZ * reach },
    kind: steps % 6 === 0 ? 'right-angle' : 'angle',
  };
}

/**
 * Where the horizontal or vertical line through `from` crosses the segment,
 * when that crossing lies within `snapDistance` of the cursor — the square
 * T-junction a chained wall would make. Null otherwise.
 */
function squareOnto(
  segment: { x1: number; z1: number; x2: number; z2: number },
  from: Vec2,
  cursor: Vec2,
  snapDistance: number
): Vec2 | null {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  let best: Vec2 | null = null;
  let bestDist = snapDistance;
  // Horizontal line z = from.z, then vertical line x = from.x.
  const crossings: Array<number | null> = [
    Math.abs(dz) > 1e-9 ? (from.z - segment.z1) / dz : null,
    Math.abs(dx) > 1e-9 ? (from.x - segment.x1) / dx : null,
  ];
  for (const t of crossings) {
    if (t === null || t < 0 || t > 1) continue;
    const point = { x: segment.x1 + t * dx, z: segment.z1 + t * dz };
    // A zero-length wall from the anchor onto the line it already sits on isn't a junction.
    if (Math.hypot(point.x - from.x, point.z - from.z) < 0.05) continue;
    const distance = Math.hypot(point.x - cursor.x, point.z - cursor.z);
    if (distance < bestDist) {
      bestDist = distance;
      best = point;
    }
  }
  return best;
}

/** Where the ray from `from` through `aim` crosses the segment, when that is near the cursor. */
function rayOnto(
  segment: { x1: number; z1: number; x2: number; z2: number },
  from: Vec2,
  aim: Vec2 | undefined,
  cursor: Vec2,
  snapDistance: number
): Vec2 | null {
  if (!aim) return null;
  const rayX = aim.x - from.x;
  const rayZ = aim.z - from.z;
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const cross = rayX * dz - rayZ * dx;
  if (Math.abs(cross) < 1e-9) return null;
  const onRay = ((segment.x1 - from.x) * dz - (segment.z1 - from.z) * dx) / cross;
  const onSegment = ((segment.x1 - from.x) * rayZ - (segment.z1 - from.z) * rayX) / cross;
  if (onRay <= 0 || onSegment < 0 || onSegment > 1) return null;
  const point = { x: from.x + onRay * rayX, z: from.z + onRay * rayZ };
  return Math.hypot(point.x - cursor.x, point.z - cursor.z) < snapDistance ? point : null;
}

/** A length as typed: "3.2", "3,2", "3.2 m". Null for anything else, or a wall too short to place. */
export function parseWallLength(text: string): number | null {
  const match = /^\s*(\d+[.,]?\d*|[.,]\d+)\s*m?\s*$/i.exec(text);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) && value >= MIN_WALL_LENGTH ? value : null;
}

/** A wall's heading on the plan, 0–359°: 0 points east, 90 up the screen. */
export function wallAngleDegrees(from: Vec2, to: Vec2): number {
  const degrees = Math.round((Math.atan2(from.z - to.z, to.x - from.x) * 180) / Math.PI);
  return ((degrees % 360) + 360) % 360;
}

/**
 * The end of a wall `length` long from `from` along `direction`. Null when it
 * would leave the lot or reach a corner cut out of it: a typed measurement is
 * kept or refused, never trimmed.
 */
export function wallEndAtLength(from: Vec2, direction: Vec2, length: number, roomWidth: number, roomDepth: number, cutout?: FootprintCutout | undefined): Vec2 | null {
  const norm = Math.hypot(direction.x, direction.z);
  if (norm < 1e-9) return null;
  const end = { x: from.x + (direction.x / norm) * length, z: from.z + (direction.z / norm) * length };
  const inside = Math.abs(end.x) <= roomWidth / 2 + 1e-6 && Math.abs(end.z) <= roomDepth / 2 + 1e-6;
  if (!inside) return null;
  const building = { width: roomWidth, height: roomDepth, cutout };
  const notch = cutoutRect(building);
  if (notch && reachToNotch(from, direction.x / norm, direction.z / norm, notch) < length - 1e-6) return null;
  return clampToBuilding(building, end);
}
