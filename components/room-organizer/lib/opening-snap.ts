/**
 * Doors and windows MUST sit on a wall — anywhere else and the cutout
 * geometry has no wall to punch through, leaving an unanchored slab
 * floating in mid-air. Force-snap their position to the nearest exterior
 * or interior wall on placement and on drag.
 */

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
}

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
  const inset = options.itemDepth / 2 + 0.02;
  // Three.js rotation.y maps the local +Z axis to (sin θ, cos θ) in world XZ;
  // that direction points into the room for every wall snapOpeningToWall picks.
  const forwardX = Math.sin(snap.rotation);
  const forwardZ = Math.cos(snap.rotation);
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
  const snap = snapOpeningToWall(options); // wall-plane point + inward-facing rotation
  const inwardX = Math.sin(snap.rotation);
  const inwardZ = Math.cos(snap.rotation);
  if (options.bracketArm != null) {
    return {
      x: snap.position.x + inwardX * options.bracketArm,
      z: snap.position.z + inwardZ * options.bracketArm,
    };
  }
  const facingX = Math.sin(options.rotation);
  const facingZ = Math.cos(options.rotation);
  // +1 if the item faces the room interior, −1 if it faces the exterior.
  const side = facingX * inwardX + facingZ * inwardZ >= 0 ? 1 : -1;
  const inset = options.itemDepth / 2 + 0.02;
  return {
    x: snap.position.x + inwardX * side * inset,
    z: snap.position.z + inwardZ * side * inset,
  };
}
