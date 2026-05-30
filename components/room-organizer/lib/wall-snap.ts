import type { InteriorWall, Vec2 } from './types';

export type WallSnapKind = 'vertex' | 'right-angle' | 'none';

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
 *   2. Snap to the orthogonal projection from `fromPoint` when chaining,
 *      so the user gets clean horizontal / vertical walls.
 *   3. Otherwise return the original pointer.
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

  // 2. Right-angle snap relative to the chain anchor.
  if (fromPoint) {
    const dx = clamped.x - fromPoint.x;
    const dz = clamped.z - fromPoint.z;
    if (Math.abs(dz) < snapDistance && Math.abs(dx) > 0.05) {
      return { point: { x: clamped.x, z: fromPoint.z }, kind: 'right-angle' };
    }
    if (Math.abs(dx) < snapDistance && Math.abs(dz) > 0.05) {
      return { point: { x: fromPoint.x, z: clamped.z }, kind: 'right-angle' };
    }
  }

  return { point: clamped, kind: 'none' };
}
