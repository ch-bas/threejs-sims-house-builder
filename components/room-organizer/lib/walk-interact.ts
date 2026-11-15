/**
 * Sitting down in EXPLORE (#463b): `E` near a chair, sofa or bed lowers the
 * walker to seat height and turns it to face the TV, or the way the seat
 * faces. `E` near a lamp switches it (#910). Pure: what the walker is
 * looking at, and the pose it takes to sit.
 */

import { isInsideBuilding } from './footprint';
import { isNightLit } from './night-lights';
import { hasSeatSurface, seatSurfaceHeight } from './seat-surface';
import { sightBlocked, type WalkCollider } from './walk-collision';
import type { FootprintCutout, FurnitureItem } from './types';

/** Seated eye height above the seat. */
export const SEATED_EYE = 0.72;
/** A seat this far from the walker's centre (to its footprint) is in reach. */
const SEAT_REACH = 1.2;
/** Anything this close counts, whichever way the walker faces. */
const SEAT_TOUCHING = 0.45;
/** cos of the widest angle off the view a seat further away may be at. */
const SEAT_VIEW_COS = 0.5;
/**
 * cos of the half-angle of what the walker counts as facing (35°): `E` acts
 * on what is in it before anything merely in reach (#910).
 */
const FACING_CONE_COS = Math.cos((35 * Math.PI) / 180);
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

/**
 * The point of the item's rotated footprint nearest (x, z), standing at
 * `at`, as the way from (x, z) to it, with its length; 0 inside it.
 */
function nearestOnFootprint(item: FurnitureItem, at: Point, x: number, z: number): { toX: number; toZ: number; distance: number } {
  const rotation = item.rotation ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = x - at.x;
  const dz = z - at.z;
  // Three's rotateY: local +x is (cos, −sin), local +z is (sin, cos).
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const ox = lx - Math.max(-item.width / 2, Math.min(item.width / 2, lx));
  const oz = lz - Math.max(-item.depth / 2, Math.min(item.depth / 2, lz));
  // Back to world: the walker's offset from the nearest point, reversed.
  return { toX: -(ox * cos + oz * sin), toZ: -(-ox * sin + oz * cos), distance: Math.hypot(ox, oz) };
}

/** cos of the angle between (dirX, dirZ), of length `dirLength`, and (toX, toZ); 1 for no length. */
function facingCos(toX: number, toZ: number, dirX: number, dirZ: number, dirLength: number): number {
  const length = Math.hypot(toX, toZ);
  return length < 1e-6 ? 1 : (toX * dirX + toZ * dirZ) / (length * dirLength);
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
  footprint?: { width: number; depth: number; cutout?: FootprintCutout | undefined };
  /**
   * The recessed porch's plan rect: inside the footprint but out on the lot,
   * as the walker counts it, so a bench on the porch is outdoors (#566).
   */
  porch?: { x0: number; x1: number; z0: number; z1: number };
}

/** The point a walker sits on, for a seat standing at `at`: a little forward of the centre, clear of the back. */
function sitPoint(seat: FurnitureItem, at: Point): Point {
  const rotation = seat.rotation ?? 0;
  const inset = seat.type === 'bed' ? 0 : seat.depth * SEAT_FORWARD;
  return { x: at.x + Math.sin(rotation) * inset, z: at.z + Math.cos(rotation) * inset };
}

/** Whether a seat (or a lamp) standing at `at` is out on the lot. */
function seatOutdoors(seat: FurnitureItem, at: Point, sight: SeatSight): boolean {
  const { footprint, porch } = sight;
  if (!footprint) return seat.category === 'outdoor';
  if (porch && at.x > porch.x0 && at.x < porch.x1 && at.z > porch.z0 && at.z < porch.z1) return true;
  return !isInsideBuilding({ width: footprint.width, height: footprint.depth, cutout: footprint.cutout }, at.x, at.z);
}

/** What `E` acts on (#910): a seat to sit on, or a lamp to switch. */
export type Interactable = { kind: 'seat'; item: FurnitureItem } | { kind: 'lamp'; item: FurnitureItem };

export interface InteractOptions {
  /**
   * Lamps are offered too: while the clock lights them. By day a switch
   * would change nothing the walker can see.
   */
  lamps?: boolean;
}

/** The point the walker's line of sight goes to: where it would sit, or a lamp's centre. */
function targetPoint(kind: Interactable['kind'], item: FurnitureItem, at: Point): Point {
  return kind === 'seat' ? sitPoint(item, at) : at;
}

/**
 * What the walker at (x, z), facing (dirX, dirZ), would act on with `E`: a
 * seat (or, with `options.lamps`, a lamp) in reach that is in view, or right
 * beside it. Null when none. What the walker faces (a 35° cone, to the
 * item's nearest edge or its centre) comes first, a seat before a lamp, then
 * the nearer: a lamp beside the sofa never takes `E` from sitting (#910).
 * With `sight`, nothing behind a wall or a partition is in reach, and neither
 * is anything on the other side of the shell (#566).
 */
export function findInteractable(
  items: readonly FurnitureItem[],
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  sight?: SeatSight,
  options: InteractOptions = {}
): Interactable | null {
  let best: Interactable | null = null;
  let bestRank = Infinity;
  let bestDistance = Infinity;
  const dirLength = Math.hypot(dirX, dirZ) || 1;
  for (const item of items) {
    const at = item.position;
    if (!at) continue;
    const kind = isSeat(item) ? 'seat' : options.lamps && isNightLit(item.type) ? 'lamp' : null;
    if (kind === null) continue;
    const near = nearestOnFootprint(item, at, x, z);
    const distance = near.distance;
    if (distance > SEAT_REACH) continue;
    // Toward the centre, or the nearest edge of a long sofa straight ahead.
    const facing = Math.max(facingCos(at.x - x, at.z - z, dirX, dirZ, dirLength), facingCos(near.toX, near.toZ, dirX, dirZ, dirLength));
    if (distance > SEAT_TOUCHING && facing < SEAT_VIEW_COS) continue;
    // Faced before merely in reach; a seat before a lamp; then the nearer.
    const rank = (facing >= FACING_CONE_COS ? 0 : 2) + (kind === 'seat' ? 0 : 1);
    if (rank > bestRank || (rank === bestRank && distance >= bestDistance)) continue;
    if (sight) {
      // Reaching never crosses the shell: the view stays indoors or out.
      if (Boolean(sight.outside) !== seatOutdoors(item, at, sight)) continue;
      const target = targetPoint(kind, item, at);
      if (sightBlocked(sight.colliders, x, z, target.x, target.z, sight.feetY)) continue;
    }
    best = { kind, item };
    bestRank = rank;
    bestDistance = distance;
  }
  return best;
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
  return findInteractable(items, x, z, dirX, dirZ, sight)?.item ?? null;
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
