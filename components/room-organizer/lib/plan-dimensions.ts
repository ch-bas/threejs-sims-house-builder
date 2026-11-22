import { clampToBuilding, isInsideBuilding, shellWalls, type FootprintBuilding } from './footprint';
import type { FloorLayout, PinnedDimension, Vec2 } from './types';

/**
 * Dimensions pinned on the plan (#921): the measure tool's two points, kept
 * on the storey they were measured on. Pure: the schema repairs them with
 * these rules, the reducer adds and removes them, and a resize or a corner
 * cut moves the ends that stood on the walls with the walls.
 */

/** A storey keeps at most this many pins. */
export const MAX_DIMENSIONS_PER_FLOOR = 100;
/** Shorter than this (metres) there is nothing to dimension. */
export const MIN_DIMENSION_LENGTH = 0.01;
/** How far (metres) a pinned line may sit off its points. */
export const MAX_DIMENSION_OFFSET = 5;
/** How far past a wall (metres) a pin's end may sit and still count as indoors. */
export const PIN_INDOOR_TOLERANCE = 0.05;
/** How close to a wall (metres) a pinned end counts as standing on it. */
const ON_WALL = 1e-6;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): value is Vec2 {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as Record<string, unknown>;
  return isFiniteNumber(point.x) && isFiniteNumber(point.z);
}

/** The pin's length in metres. */
export function dimensionLength(dimension: Pick<PinnedDimension, 'a' | 'b'>): number {
  return Math.hypot(dimension.b.x - dimension.a.x, dimension.b.z - dimension.a.z);
}

/** A pin as stored: an id, two finite points far enough apart, and a finite offset if any. */
export function isPinnedDimension(value: unknown): value is PinnedDimension {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id === '') return false;
  if (!isPoint(v.a) || !isPoint(v.b)) return false;
  if (v.offset !== undefined && !isFiniteNumber(v.offset)) return false;
  return dimensionLength({ a: v.a, b: v.b }) >= MIN_DIMENSION_LENGTH;
}

/**
 * The pin with its numbers in range: each coordinate through `clampCoordinate`
 * (the schema's), the offset within `MAX_DIMENSION_OFFSET` and dropped at 0.
 * Returns `dimension` itself when nothing changes.
 */
export function clampDimension(dimension: PinnedDimension, clampCoordinate: (value: number) => number): PinnedDimension {
  const a = { x: clampCoordinate(dimension.a.x), z: clampCoordinate(dimension.a.z) };
  const b = { x: clampCoordinate(dimension.b.x), z: clampCoordinate(dimension.b.z) };
  const offset = dimension.offset === undefined ? 0 : Math.max(-MAX_DIMENSION_OFFSET, Math.min(MAX_DIMENSION_OFFSET, dimension.offset));
  const samePoints = a.x === dimension.a.x && a.z === dimension.a.z && b.x === dimension.b.x && b.z === dimension.b.z;
  const sameOffset = dimension.offset === undefined || (dimension.offset === offset && offset !== 0);
  if (samePoints && sameOffset) return dimension;
  return { id: dimension.id, a, b, ...(offset !== 0 ? { offset } : {}) };
}

/**
 * One end of a pin after the footprint changed from `from` to `to`: an end
 * on or inside the old house stays in the new one, and one on an outer wall,
 * the L's notch walls included, moves with that wall, as an opening does; an
 * end out in the garden stays.
 */
function followEnd(point: Vec2, from: FootprintBuilding, to: FootprintBuilding): Vec2 {
  if (!isInsideBuilding(from, point.x, point.z)) return point;
  const after = new Map(shellWalls(to).map((wall) => [wall.id, wall]));
  let { x, z } = point;
  for (const wall of shellWalls(from)) {
    const moved = after.get(wall.id);
    if (!moved) continue;
    const upright = wall.x1 === wall.x2;
    const onLine = upright ? Math.abs(point.x - wall.x1) <= ON_WALL : Math.abs(point.z - wall.z1) <= ON_WALL;
    const along = upright ? point.z : point.x;
    const [lo, hi] = upright ? [wall.z1, wall.z2] : [wall.x1, wall.x2];
    if (!onLine || along < lo - ON_WALL || along > hi + ON_WALL) continue;
    if (upright) x = moved.x1;
    else z = moved.z1;
  }
  const moved = clampToBuilding(to, { x, z });
  return moved.x === point.x && moved.z === point.z ? point : moved;
}

/**
 * How far (metres) the pin's furthest end sits outside the walls; 0 when
 * both ends are within `tolerance` of the house's rectangle. The blueprint
 * and the print leave far pins off as they leave far items off.
 */
export function dimensionOutsideWalls(layout: Pick<FootprintBuilding, 'width' | 'height'>, dimension: Pick<PinnedDimension, 'a' | 'b'>, tolerance: number): number {
  const beyond = Math.max(
    ...[dimension.a, dimension.b].map((end) => Math.max(Math.abs(end.x) - layout.width / 2, Math.abs(end.z) - layout.height / 2))
  );
  return beyond > tolerance ? beyond : 0;
}

/**
 * A storey's pins after the footprint changed (a resize or a corner cut):
 * ends follow the walls (`followEnd`), and a pin squeezed shorter than
 * `MIN_DIMENSION_LENGTH` goes. Returns `dimensions` itself when nothing moves.
 */
export function dimensionsAfterFootprint(
  dimensions: readonly PinnedDimension[],
  from: FootprintBuilding,
  to: FootprintBuilding
): readonly PinnedDimension[] {
  let changed = false;
  const next: PinnedDimension[] = [];
  for (const dimension of dimensions) {
    const a = followEnd(dimension.a, from, to);
    const b = followEnd(dimension.b, from, to);
    if (a === dimension.a && b === dimension.b) {
      next.push(dimension);
      continue;
    }
    changed = true;
    if (dimensionLength({ a, b }) >= MIN_DIMENSION_LENGTH) next.push({ ...dimension, a, b });
  }
  return changed ? next : dimensions;
}

/** How far (metres) a new pin's line sits off its points, so it clears the edges it was measured from. */
export const DEFAULT_PIN_OFFSET = 0.25;

/**
 * The offset a new pin from `a` to `b` takes: `DEFAULT_PIN_OFFSET` towards
 * the top of the sheet for a level line, the left for an upright one, the
 * side its label reads from (plan-geometry `pinnedDimensionLines`).
 */
export function defaultPinOffset(a: Vec2, b: Vec2): number {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (!(length > 0)) return 0;
  const left = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
  const up = left.z < -1e-9 || (Math.abs(left.z) <= 1e-9 && left.x < 0);
  return up ? DEFAULT_PIN_OFFSET : -DEFAULT_PIN_OFFSET;
}

/** `floor` with `dimensions`, the key dropped when there are none. */
export function withDimensions(floor: FloorLayout, dimensions: readonly PinnedDimension[]): FloorLayout {
  if (dimensions.length > 0) return { ...floor, dimensions: [...dimensions] };
  const { dimensions: _none, ...rest } = floor;
  return rest;
}
