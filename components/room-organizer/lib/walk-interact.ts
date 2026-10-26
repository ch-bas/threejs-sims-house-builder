/**
 * Sitting down in EXPLORE (#463b): `E` near a chair, sofa or bed lowers the
 * walker to seat height and turns it to face the TV, or the way the seat
 * faces. Pure: which seat the walker is looking at, and the pose it takes.
 */

import { hasSeatSurface, seatSurfaceHeight } from './seat-surface';
import { sightBlocked, type WalkCollider } from './walk-collision';
import type { FurnitureItem } from './types';

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
  return hasSeatSurface(item);
}

interface Point {
  x: number;
  z: number;
}

/** Distance from (x, z) to the item, standing at `at`: its rotated footprint; 0 inside it. */
function footprintDistance(item: FurnitureItem, at: Point, x: number, z: number): number {
  const rotation = item.rotation ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = x - at.x;
  const dz = z - at.z;
  // Three's rotateY: local +x is (cos, −sin), local +z is (sin, cos).
  const lx = Math.max(0, Math.abs(dx * cos - dz * sin) - item.width / 2);
  const lz = Math.max(0, Math.abs(dx * sin + dz * cos) - item.depth / 2);
  return Math.hypot(lx, lz);
}

/** Where the walker can see: the walls between it and a seat or a TV (#566). */
export interface SeatSight {
  /** The walker's colliders; only the walls among them block the view. */
  colliders: readonly WalkCollider[];
  /** World Y of the feet: walls of the storeys either side are skipped. */
  feetY?: number;
  /**
   * The walker is out on the lot: seats indoors are not in reach, and
   * indoors a seat outside isn't either.
   */
  outside?: boolean;
  /**
   * The house's footprint (metres, centred on the origin): a seat standing
   * outside it is outdoors, whatever its category. Without it the catalogue
   * category decides.
   */
  footprint?: { width: number; depth: number };
}

/** The point a walker sits on, for a seat standing at `at`: a little forward of the centre, clear of the back. */
function sitPoint(seat: FurnitureItem, at: Point): Point {
  const rotation = seat.rotation ?? 0;
  const inset = seat.type === 'bed' ? 0 : seat.depth * SEAT_FORWARD;
  return { x: at.x + Math.sin(rotation) * inset, z: at.z + Math.cos(rotation) * inset };
}

/** Whether a seat standing at `at` is out on the lot. */
function seatOutdoors(seat: FurnitureItem, at: Point, footprint: SeatSight['footprint']): boolean {
  if (!footprint) return seat.category === 'outdoor';
  return Math.abs(at.x) > footprint.width / 2 || Math.abs(at.z) > footprint.depth / 2;
}

/**
 * The seat the walker at (x, z), facing (dirX, dirZ), would sit on: the
 * nearest one in reach that is in view, or right beside it. Null when none.
 * With `sight`, a seat behind a wall or a partition is not in reach, and
 * neither is one on the other side of the shell (#566).
 */
export function findSeat(
  items: readonly FurnitureItem[],
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  sight?: SeatSight
): FurnitureItem | null {
  let best: FurnitureItem | null = null;
  let bestScore = Infinity;
  const dirLength = Math.hypot(dirX, dirZ) || 1;
  for (const item of items) {
    const at = item.position;
    if (!at || !isSeat(item)) continue;
    const distance = footprintDistance(item, at, x, z);
    if (distance > SEAT_REACH) continue;
    const toX = at.x - x;
    const toZ = at.z - z;
    const toLength = Math.hypot(toX, toZ);
    const facing = toLength < 1e-6 ? 1 : (toX * dirX + toZ * dirZ) / (toLength * dirLength);
    if (distance > SEAT_TOUCHING && facing < SEAT_VIEW_COS) continue;
    // Prefer what is straight ahead over what is merely nearer.
    const score = distance - facing * 0.5;
    if (score >= bestScore) continue;
    if (sight) {
      // Sitting never crosses the shell: the view stays indoors or out.
      if (Boolean(sight.outside) !== seatOutdoors(item, at, sight.footprint)) continue;
      const seatAt = sitPoint(item, at);
      if (sightBlocked(sight.colliders, x, z, seatAt.x, seatAt.z, sight.feetY)) continue;
    }
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
 * faces its TV in the starter layouts). With `sight`, a TV behind a wall or
 * a partition doesn't count (#566).
 */
export function seatPose(
  seat: FurnitureItem,
  items: readonly FurnitureItem[],
  floorY: number,
  sight?: Pick<SeatSight, 'colliders'>
): SeatPose | null {
  if (!seat.position || !isSeat(seat)) return null;
  const rotation = seat.rotation ?? 0;
  const forwardX = Math.sin(rotation);
  const forwardZ = Math.cos(rotation);
  const { x, z } = sitPoint(seat, seat.position);
  // The walkers' seat table (#623): a person beside the player sits as high.
  const eyeY = floorY + (seatSurfaceHeight(seat) ?? seat.height) + SEATED_EYE;

  let tv: FurnitureItem | null = null;
  let tvDistance = TV_RANGE;
  for (const item of items) {
    if (item.type !== 'tv' || !item.position) continue;
    const toX = item.position.x - x;
    const toZ = item.position.z - z;
    const distance = Math.hypot(toX, toZ);
    if (distance < 1e-6 || distance >= tvDistance) continue;
    if ((toX * forwardX + toZ * forwardZ) / distance < 0.3) continue;
    if (sight && sightBlocked(sight.colliders, x, z, item.position.x, item.position.z, floorY)) continue;
    tv = item;
    tvDistance = distance;
  }
  if (tv?.position) {
    return { x, z, eyeY, lookX: tv.position.x, lookY: floorY + tv.height + TV_SCREEN_ABOVE_STAND, lookZ: tv.position.z };
  }
  return { x, z, eyeY, lookX: x + forwardX * 3, lookY: eyeY, lookZ: z + forwardZ * 3 };
}
