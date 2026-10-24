/**
 * Sitting down in EXPLORE (#463b): `E` near a chair, sofa or bed lowers the
 * walker to seat height and turns it to face the TV, or the way the seat
 * faces. Pure: which seat the walker is looking at, and the pose it takes.
 */

import type { FurnitureItem } from './types';

/** Seat height above the floor for each type you can sit on, capped by the item's own height. */
const SEAT_HEIGHTS: Readonly<Record<string, number>> = {
  chair: 0.46,
  'dining-chair': 0.46,
  armchair: 0.42,
  sofa: 0.42,
  bench: 0.45,
  'garden-bench': 0.45,
  bed: 0.55,
  toilet: 0.42,
};
/** Seated eye height above the seat. */
export const SEATED_EYE = 0.72;
/** A seat this far from the walker's centre (to its footprint) is in reach. */
const SEAT_REACH = 1.2;
/** Anything this close counts, whichever way the walker faces. */
const SEAT_TOUCHING = 0.45;
/** cos of the widest angle off the view a seat further away may be at. */
const SEAT_VIEW_COS = 0.5;
const TV_RANGE = 8;
/** Look at the screen, which sits on top of the TV stand. */
const TV_SCREEN_ABOVE_STAND = 0.35;
/** Seats are sat on a little forward of their centre, clear of the back. */
const SEAT_FORWARD = 0.1;

export function isSeat(item: Pick<FurnitureItem, 'type'>): boolean {
  return item.type in SEAT_HEIGHTS;
}

/** Distance from (x, z) to the item's rotated footprint; 0 inside it. */
function footprintDistance(item: FurnitureItem & { position: { x: number; z: number } }, x: number, z: number): number {
  const rotation = item.rotation ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = x - item.position.x;
  const dz = z - item.position.z;
  // Three's rotateY: local +x is (cos, −sin), local +z is (sin, cos).
  const lx = Math.max(0, Math.abs(dx * cos - dz * sin) - item.width / 2);
  const lz = Math.max(0, Math.abs(dx * sin + dz * cos) - item.depth / 2);
  return Math.hypot(lx, lz);
}

/**
 * The seat the walker at (x, z), facing (dirX, dirZ), would sit on: the
 * nearest one in reach that is in view, or right beside it. Null when none.
 */
export function findSeat(
  items: readonly FurnitureItem[],
  x: number,
  z: number,
  dirX: number,
  dirZ: number
): FurnitureItem | null {
  let best: FurnitureItem | null = null;
  let bestScore = Infinity;
  const dirLength = Math.hypot(dirX, dirZ) || 1;
  for (const item of items) {
    if (!item.position || !isSeat(item)) continue;
    const placed = item as FurnitureItem & { position: { x: number; z: number } };
    const distance = footprintDistance(placed, x, z);
    if (distance > SEAT_REACH) continue;
    const toX = item.position.x - x;
    const toZ = item.position.z - z;
    const toLength = Math.hypot(toX, toZ);
    const facing = toLength < 1e-6 ? 1 : (toX * dirX + toZ * dirZ) / (toLength * dirLength);
    if (distance > SEAT_TOUCHING && facing < SEAT_VIEW_COS) continue;
    // Prefer what is straight ahead over what is merely nearer.
    const score = distance - facing * 0.5;
    if (score >= bestScore) continue;
    best = item;
    bestScore = score;
  }
  return best;
}

export interface SeatPose {
  /** Where the walker sits, and its eye height (world). */
  x: number;
  z: number;
  eyeY: number;
  /** The point it looks at: the TV's screen, or straight ahead. */
  lookX: number;
  lookY: number;
  lookZ: number;
}

/**
 * Where a walker sits on `seat` on a storey whose floor is at `floorY`, and
 * what it looks at: the nearest TV in front of the seat within range, else
 * the way the seat faces (catalog seats face local +z, like the sofa that
 * faces its TV in the starter layouts).
 */
export function seatPose(seat: FurnitureItem, items: readonly FurnitureItem[], floorY: number): SeatPose | null {
  if (!seat.position || !isSeat(seat)) return null;
  const rotation = seat.rotation ?? 0;
  const forwardX = Math.sin(rotation);
  const forwardZ = Math.cos(rotation);
  const inset = seat.type === 'bed' ? 0 : seat.depth * SEAT_FORWARD;
  const x = seat.position.x + forwardX * inset;
  const z = seat.position.z + forwardZ * inset;
  const eyeY = floorY + Math.min(seat.height, SEAT_HEIGHTS[seat.type] ?? seat.height) + SEATED_EYE;

  let tv: FurnitureItem | null = null;
  let tvDistance = TV_RANGE;
  for (const item of items) {
    if (item.type !== 'tv' || !item.position) continue;
    const toX = item.position.x - x;
    const toZ = item.position.z - z;
    const distance = Math.hypot(toX, toZ);
    if (distance < 1e-6 || distance >= tvDistance) continue;
    if ((toX * forwardX + toZ * forwardZ) / distance < 0.3) continue;
    tv = item;
    tvDistance = distance;
  }
  if (tv?.position) {
    return { x, z, eyeY, lookX: tv.position.x, lookY: floorY + tv.height + TV_SCREEN_ABOVE_STAND, lookZ: tv.position.z };
  }
  return { x, z, eyeY, lookX: x + forwardX * 3, lookY: eyeY, lookZ: z + forwardZ * 3 };
}
