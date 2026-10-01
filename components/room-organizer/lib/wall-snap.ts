import { projectOntoSegment } from './opening-snap';
import type { InteriorWall, Vec2 } from './types';

export type WallSnapKind = 'vertex' | 'on-wall' | 'right-angle' | 'none';

export interface WallSnapResult {
  point: Vec2;
  kind: WallSnapKind;
}

export interface WallSnapOptions {
  /** The pointer position in world space. */
  point: Vec2;
  /** Walls already on the floor — their endpoints are vertex-snap targets. */
  existingWalls: readonly InteriorWall[];
  /** When chaining, the previous endpoint enables right-angle snapping. */
  fromPoint?: Vec2 | null;
  /** Building footprint, used as additional snap targets at the corners and edges. */
  roomWidth: number;
  roomDepth: number;
  /** Maximum distance, in metres, considered "near enough" to snap. */
  snapDistance?: number;
}

/**
 * Resolve a freeform pointer into a snapped wall endpoint:
 *
 *   1. Snap to any existing wall endpoint (or building corner) within the
 *      snap distance — most useful for closing rectangles.
 *   2. Snap onto the body of an existing wall or the building's edge (a
 *      T-junction), so no gap is left for the walker to slip through (#412).
 *      When chaining, the point stays square to `fromPoint` if it can.
 *   3. Snap to the orthogonal projection from `fromPoint` when chaining,
 *      so the user gets clean horizontal / vertical walls.
 *   4. Otherwise return the original pointer.
 *
 * The final point is always clamped to the lot footprint so users can't
 * draw walls into the grass beyond the building's edge.
 *
 * Pure: no React, no Three.js. Easy to unit test.
 */
export function snapWallEndpoint({
  point,
  existingWalls,
  fromPoint = null,
  roomWidth,
  roomDepth,
  snapDistance = 0.45,
}: WallSnapOptions): WallSnapResult {
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  // Clamp the cursor up front — every snap branch operates against a
  // point already inside the lot, so vertex / right-angle snaps stay
  // accurate even when the user has dragged the cursor onto the grass.
  const clamped: Vec2 = {
    x: Math.max(-halfW, Math.min(halfW, point.x)),
    z: Math.max(-halfD, Math.min(halfD, point.z)),
  };

  // 1. Vertex snap — existing wall endpoints + building corners.
  const vertices: Vec2[] = [];
  for (const wall of existingWalls) {
    vertices.push({ x: wall.x1, z: wall.z1 }, { x: wall.x2, z: wall.z2 });
  }
  vertices.push(
    { x: -halfW, z: -halfD },
    { x: halfW, z: -halfD },
    { x: halfW, z: halfD },
    { x: -halfW, z: halfD }
  );

  let best: WallSnapResult | null = null;
  let bestDist = snapDistance;
  for (const vertex of vertices) {
    // Don't snap to a stale endpoint outside the lot — that would defeat
    // the clamp and re-poison new walls.
    if (
      vertex.x < -halfW - 0.001 ||
      vertex.x > halfW + 0.001 ||
      vertex.z < -halfD - 0.001 ||
      vertex.z > halfD + 0.001
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

  // The right-angle snap relative to the chain anchor, if any.
  let rightAngle: Vec2 | null = null;
  if (fromPoint) {
    const dx = clamped.x - fromPoint.x;
    const dz = clamped.z - fromPoint.z;
    if (Math.abs(dz) < snapDistance && Math.abs(dx) > 0.05) rightAngle = { x: clamped.x, z: fromPoint.z };
    else if (Math.abs(dx) < snapDistance && Math.abs(dz) > 0.05) rightAngle = { x: fromPoint.x, z: clamped.z };
  }

  // 2. On-wall snap — the nearest wall body, the building's edges included.
  // While chaining, a junction that would bend a square wall off its axis
  // gives way to the right-angle snap (a wall drawn alongside another stays straight).
  const segments: Array<{ x1: number; z1: number; x2: number; z2: number }> = [
    ...existingWalls,
    { x1: -halfW, z1: -halfD, x2: halfW, z2: -halfD },
    { x1: halfW, z1: -halfD, x2: halfW, z2: halfD },
    { x1: halfW, z1: halfD, x2: -halfW, z2: halfD },
    { x1: -halfW, z1: halfD, x2: -halfW, z2: -halfD },
  ];
  bestDist = snapDistance;
  for (const segment of segments) {
    const projected = projectOntoSegment(clamped, segment, 0);
    if (!projected || projected.distance >= bestDist) continue;
    const square = fromPoint ? squareOnto(segment, fromPoint, clamped, snapDistance) : null;
    if (!square && rightAngle) continue;
    bestDist = projected.distance;
    best = { point: clampTo(square ?? projected.point, halfW, halfD), kind: 'on-wall' };
  }
  if (best) return best;

  // 3. Right-angle snap.
  if (rightAngle) return { point: rightAngle, kind: 'right-angle' };

  return { point: clamped, kind: 'none' };
}

function clampTo(point: Vec2, halfW: number, halfD: number): Vec2 {
  return { x: Math.max(-halfW, Math.min(halfW, point.x)), z: Math.max(-halfD, Math.min(halfD, point.z)) };
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
