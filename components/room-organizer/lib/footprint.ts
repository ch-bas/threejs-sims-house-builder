/**
 * Footprint primitives every layer must agree on (#451): an item's rotated
 * extents, the low-profile height cut, and clamping into the room. A leaf
 * module (it imports only types), so `lib/walk-collision` (which `lib/geometry`
 * itself imports) can share them without a cycle. Import them from here.
 */

import type { FurnitureItem } from './types';

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

/** Clamp a position so the item's rotated footprint stays inside the room. */
export function clampToFootprint(
  item: Pick<FurnitureItem, 'width' | 'depth' | 'rotation'>,
  position: { x: number; z: number },
  roomWidth: number,
  roomDepth: number
): { x: number; z: number } {
  const { halfW, halfD } = rotatedHalfExtents(item);
  const maxX = Math.max(0, roomWidth / 2 - halfW);
  const maxZ = Math.max(0, roomDepth / 2 - halfD);
  return {
    x: Math.min(maxX, Math.max(-maxX, position.x)),
    z: Math.min(maxZ, Math.max(-maxZ, position.z)),
  };
}
