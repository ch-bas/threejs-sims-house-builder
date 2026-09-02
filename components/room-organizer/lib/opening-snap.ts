/**
 * Doors and windows MUST sit on a wall — anywhere else and the cutout
 * geometry has no wall to punch through, leaving an unanchored slab
 * floating in mid-air. Force-snap their position to the nearest exterior
 * or interior wall on placement and on drag.
 */

import { CAMERA_BRACKET_ARM } from './constants';
import type { InteriorWall } from './types';

export type WallKind = 'exterior' | 'interior';

export interface OpeningSnap {
  position: { x: number; z: number };
  /**
   * Rotation (radians, around Y) that aligns the opening's width axis with
   * the wall it's snapping to. Used as the default rotation on initial
   * placement; user-driven rotates aren't overridden by drag-snaps.
   */
  rotation: number;
  wallKind: WallKind;
  /** Distance from the original cursor position to the wall, in metres. */
  distance: number;
  /**
   * The interior wall segment this snap landed on, when `wallKind` is
   * `interior`. Wall-mounted items use it to seat on whichever side the cursor
   * is on (an interior wall has no fixed inside/outside) and to inset by the
   * wall's half-thickness so the item's back face rests on the surface rather
   * than sinking into the centreline.
   */
  interiorWall?: { x1: number; z1: number; x2: number; z2: number };
}

/**
 * Interior walls are modelled 0.16 m thick (see three/interior-walls.ts, which
 * owns the authoritative constant). A flush inset measured from the wall
 * centreline would bury a wall-mounted item's back face half that depth inside
 * the wall, so seating against an interior wall adds this half-thickness.
 */
const INTERIOR_WALL_HALF_THICKNESS = 0.08;

export interface SnapOpeningOptions {
  position: { x: number; z: number };
  itemWidth: number;
  roomWidth: number;
  roomDepth: number;
  interiorWalls?: readonly InteriorWall[];
}

export function snapOpeningToWall(options: SnapOpeningOptions): OpeningSnap {
  const { position, itemWidth, roomWidth, roomDepth } = options;
  const interiorWalls = options.interiorWalls ?? [];

  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const half = itemWidth / 2;

  interface Candidate extends OpeningSnap {}
  const candidates: Candidate[] = [
    {
      position: { x: clamp(position.x, -halfW + half, halfW - half), z: -halfD },
      rotation: 0,
      wallKind: 'exterior',
      distance: Math.abs(position.z - -halfD),
    },
    {
      position: { x: clamp(position.x, -halfW + half, halfW - half), z: halfD },
      rotation: Math.PI,
      wallKind: 'exterior',
      distance: Math.abs(position.z - halfD),
    },
    {
      position: { x: halfW, z: clamp(position.z, -halfD + half, halfD - half) },
      rotation: -Math.PI / 2,
      wallKind: 'exterior',
      distance: Math.abs(position.x - halfW),
    },
    {
      position: { x: -halfW, z: clamp(position.z, -halfD + half, halfD - half) },
      rotation: Math.PI / 2,
      wallKind: 'exterior',
      distance: Math.abs(position.x - -halfW),
    },
  ];

  for (const wall of interiorWalls) {
    const projected = projectOntoSegment(position, wall, half);
    if (!projected) continue;
    candidates.push({
      position: projected.point,
      // Three.js rotation.y rotates the local +X axis toward -Z, so to put
      // the opening's width axis along a wall whose direction is
      // (dx, dz), the rotation we want is -atan2(dz, dx).
      rotation: -Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1),
      wallKind: 'interior',
      distance: projected.distance,
      interiorWall: { x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 },
    });
  }

  candidates.sort((a, b) => a.distance - b.distance);
  // Always at least four exterior candidates exist, so this is safe.
  return candidates[0]!;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.max(min, Math.min(max, value));
}

function projectOntoSegment(
  point: { x: number; z: number },
  segment: { x1: number; z1: number; x2: number; z2: number },
  endpointInset: number
): { point: { x: number; z: number }; distance: number } | null {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-6) return null;
  const length = Math.sqrt(lengthSquared);

  // Don't allow the opening to overflow either end of the segment.
  if (length <= endpointInset * 2) return null;
  const usableMin = endpointInset / length;
  const usableMax = 1 - endpointInset / length;

  const rawT = ((point.x - segment.x1) * dx + (point.z - segment.z1) * dz) / lengthSquared;
  const t = clamp(rawT, usableMin, usableMax);
  const projected = { x: segment.x1 + t * dx, z: segment.z1 + t * dz };
  const distance = Math.hypot(point.x - projected.x, point.z - projected.z);
  return { point: projected, distance };
}

/**
 * Which side of an interior wall the cursor is on, expressed as a sign along
 * the wall's `(sin rot, cos rot)` normal. `snapOpeningToWall` derives that
 * normal from `rot = -atan2(dz, dx)`, i.e. N = (-dz, dx)/len — the left-hand
 * perpendicular of the wall direction. A camera dropped on the −N side should
 * seat there instead of teleporting to the +N side.
 *
 * Returns +1 when the cursor lies on the +N side (or exactly on the line).
 */
function interiorWallSide(
  cursor: { x: number; z: number },
  wall: { x1: number; z1: number; x2: number; z2: number }
): 1 | -1 {
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  // Perpendicular component of (cursor - wallStart) along N = (-dz, dx).
  const localPerp = (cursor.x - wall.x1) * -dz + (cursor.z - wall.z1) * dx;
  return localPerp >= 0 ? 1 : -1;
}

export function isOpening(type: string): boolean {
  return type === 'door' || type === 'window';
}


/**
 * Items that belong flush against a wall. Openings (doors/windows) cut through
 * the wall; surface-mounted items (security cameras) sit against it and face
 * into the room.
 */
export function isWallMounted(type: string): boolean {
  return isOpening(type) || type === 'security-camera';
}

/**
 * Snap a surface-mounted item (e.g. a security camera) to the nearest wall,
 * then inset its centre into the room by half its depth so the body's back
 * face rests on the wall and the footprint stays in-bounds (otherwise
 * `itemInBounds` would flag a false collision). The returned rotation faces
 * the item's local +Z axis into the room, matching how the camera and its
 * vision cone are modelled.
 */
export function snapWallMountedItem(options: SnapOpeningOptions & { itemDepth: number }): OpeningSnap {
  const snap = snapOpeningToWall(options);
  // Three.js rotation.y maps the local +Z axis to (sin θ, cos θ) in world XZ.
  // For an exterior wall that direction always points into the room, so the
  // sign is +1. For an interior wall it's an arbitrary normal, so seat the item
  // on whichever side the cursor dropped and inset past the wall half-thickness
  // so the back face rests on the surface instead of the centreline.
  let inset = options.itemDepth / 2 + 0.02;
  let side: 1 | -1 = 1;
  if (snap.wallKind === 'interior' && snap.interiorWall) {
    side = interiorWallSide(options.position, snap.interiorWall);
    inset += INTERIOR_WALL_HALF_THICKNESS;
  }
  const forwardX = Math.sin(snap.rotation) * side;
  const forwardZ = Math.cos(snap.rotation) * side;
  return {
    ...snap,
    position: {
      x: snap.position.x + forwardX * inset,
      z: snap.position.z + forwardZ * inset,
    },
  };
}

/**
 * Re-seat a wall-mounted item against the nearest wall.
 *
 * - Default (flush): the item's back rests on the wall and its body sits on
 *   whichever side it currently *faces*, so a camera turned to face outside
 *   moves to the exterior side and its cone starts at the wall surface instead
 *   of passing through it.
 * - With `bracketArm`: the item stands off the wall by that distance along the
 *   wall's inward normal (a stand-off mount), independent of facing — so a
 *   bracketed camera can pan freely while its base stays on the wall.
 */
export function reseatWallMountedItem(
  options: SnapOpeningOptions & { itemDepth: number; rotation: number; bracketArm?: number }
): { x: number; z: number } {
  const snap = snapOpeningToWall(options); // wall-plane point + wall-normal rotation
  const inwardX = Math.sin(snap.rotation);
  const inwardZ = Math.cos(snap.rotation);
  const isInterior = snap.wallKind === 'interior' && snap.interiorWall != null;

  if (options.bracketArm != null) {
    // Stand-off mount: an exterior wall's normal already points into the room,
    // but an interior wall's is arbitrary, so put the arm on the cursor's side
    // instead of unconditionally along +normal (which flings it through the
    // wall when the camera sits on the −normal side).
    const bracketSide = isInterior ? interiorWallSide(options.position, snap.interiorWall!) : 1;
    return {
      x: snap.position.x + inwardX * bracketSide * options.bracketArm,
      z: snap.position.z + inwardZ * bracketSide * options.bracketArm,
    };
  }

  const facingX = Math.sin(options.rotation);
  const facingZ = Math.cos(options.rotation);
  // +1 if the item faces along the wall normal, −1 if it faces the other side.
  const side = facingX * inwardX + facingZ * inwardZ >= 0 ? 1 : -1;
  // Interior walls are thick; inset past the half-thickness so the back face
  // rests on the surface rather than embedding into the centreline.
  const inset = options.itemDepth / 2 + 0.02 + (isInterior ? INTERIOR_WALL_HALF_THICKNESS : 0);
  return {
    x: snap.position.x + inwardX * side * inset,
    z: snap.position.z + inwardZ * side * inset,
  };
}

export interface SettledPlacement {
  position: { x: number; z: number };
  /** Present only when the item's rotation must change to stay wall-aligned. */
  rotation?: number;
  /** Present for surface-mounted items (cameras): the wall's inward-normal yaw. */
  wallRotation?: number;
}

/**
 * Settle a wall-mounted item's committed position back onto its wall — the
 * single re-snap rule shared by drag release, group-drag commits, keyboard
 * nudges, and duplication, so no code path can strand an opening off its
 * wall (#116). Returns null for items that don't mount on walls.
 */
export function settleWallMountedItem(
  item: {
    type: string;
    width: number;
    depth: number;
    rotation?: number;
    cameraBracket?: boolean;
  },
  position: { x: number; z: number },
  roomWidth: number,
  roomDepth: number,
  interiorWalls: readonly InteriorWall[] = []
): SettledPlacement | null {
  if (isOpening(item.type)) {
    const snapped = snapOpeningToWall({
      position,
      itemWidth: item.width,
      roomWidth,
      roomDepth,
      interiorWalls,
    });
    const patch: SettledPlacement = { position: snapped.position };
    if (Math.abs((item.rotation ?? 0) - snapped.rotation) > 1e-3) patch.rotation = snapped.rotation;
    return patch;
  }
  if (item.type === 'security-camera') {
    const snapped = snapWallMountedItem({
      position,
      itemWidth: item.width,
      itemDepth: item.depth,
      roomWidth,
      roomDepth,
      interiorWalls,
    });
    if (item.cameraBracket) {
      const reseated = reseatWallMountedItem({
        position,
        itemWidth: item.width,
        itemDepth: item.depth,
        roomWidth,
        roomDepth,
        interiorWalls,
        rotation: item.rotation ?? snapped.rotation,
        bracketArm: CAMERA_BRACKET_ARM,
      });
      return { position: reseated, wallRotation: snapped.rotation };
    }
    const patch: SettledPlacement = { position: snapped.position, wallRotation: snapped.rotation };
    if (Math.abs((item.rotation ?? 0) - snapped.rotation) > 1e-3) patch.rotation = snapped.rotation;
    return patch;
  }
  return null;
}
