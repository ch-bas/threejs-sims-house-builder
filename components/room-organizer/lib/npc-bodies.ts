/**
 * The first-person walker and the walkers, as each other's obstacles (#585).
 * One `NpcHandOff` per editor: the walkthrough writes where the player is
 * (and sits) every frame, the walkers' step writes where each of them is,
 * and each side reads the other's. Nothing here allocates per frame: the
 * bodies are mutated in place, and the array of them is replaced only when
 * walkers come or go.
 */

import { boxCollider, type WalkCollider } from './walk-collision';

/** The walkers' body radius (`lib/npc-path` NPC_RADIUS): the box the player bumps into. */
const NPC_BODY_RADIUS = 0.22;
/** How tall a walker is to the player's resolve: it blocks from its floor to above head height. */
const NPC_BODY_HEIGHT = 1.9;
/**
 * Two sitters' hips closer than this share a seat. A three-seat sofa's
 * slots are 0.67 m apart, so the player in the middle leaves both ends
 * free; a two-seat's are 0.5 m either side of the centre the player takes.
 */
export const SEAT_SHARE_GAP = 0.55;

/** The first-person walker, as the walkers see it. */
export interface PlayerBody {
  /** Walking (EXPLORE's first-person view is on); the rest is stale otherwise. */
  present: boolean;
  x: number;
  z: number;
  /** Feet height, world Y. */
  y: number;
  /** The storey the player is on. */
  floorIndex: number;
  /** Where the player sits, NaN while standing. */
  seatX: number;
  seatZ: number;
}

/** A walker, as the player's resolve and seat lookup see it. */
export interface NpcBody {
  /** A box the walker's width, from its floor to above its head. */
  collider: WalkCollider;
  floorIndex: number;
  /** The hips' spot of the seat it is stepping into, sitting on or leaving; NaN otherwise. */
  seatX: number;
  seatZ: number;
}

export interface NpcHandOff {
  player: PlayerBody;
  /** The walkers of the storeys drawn; parked ones aren't there to bump into. */
  bodies: readonly NpcBody[];
}

export function createNpcHandOff(): NpcHandOff {
  return {
    player: { present: false, x: 0, z: 0, y: 0, floorIndex: 0, seatX: Number.NaN, seatZ: Number.NaN },
    bodies: [],
  };
}

export function createNpcBody(x: number, z: number, floorY: number, floorIndex: number): NpcBody {
  return {
    collider: boxCollider(x, z, NPC_BODY_RADIUS * 2, NPC_BODY_RADIUS * 2, 0, false, floorY, floorY + NPC_BODY_HEIGHT),
    floorIndex,
    seatX: Number.NaN,
    seatZ: Number.NaN,
  };
}

/** Move a walker's body to (x, z) on the floor at `floorY`. */
export function moveNpcBody(body: NpcBody, x: number, z: number, floorY: number, floorIndex: number): void {
  const box = body.collider;
  box.cx = x;
  box.cz = z;
  box.bottom = floorY;
  box.top = floorY + NPC_BODY_HEIGHT;
  body.floorIndex = floorIndex;
}

/** Whether a walker on `floorIndex` sits (or is sitting down or getting up) with its hips near (x, z). */
export function seatTakenByWalker(bodies: readonly NpcBody[], floorIndex: number, x: number, z: number): boolean {
  for (const body of bodies) {
    if (body.floorIndex !== floorIndex || Number.isNaN(body.seatX)) continue;
    if (Math.hypot(body.seatX - x, body.seatZ - z) < SEAT_SHARE_GAP) return true;
  }
  return false;
}

/** Whether the player sits with its hips near (x, z) on `floorIndex`. */
export function seatTakenByPlayer(player: PlayerBody, floorIndex: number, x: number, z: number): boolean {
  if (!player.present || player.floorIndex !== floorIndex || Number.isNaN(player.seatX)) return false;
  return Math.hypot(player.seatX - x, player.seatZ - z) < SEAT_SHARE_GAP;
}

/** The colliders with every walker's body appended, cached per storey array. */
export type BodiesCache = WeakMap<readonly WalkCollider[], { bodies: readonly NpcBody[]; all: readonly WalkCollider[] }>;

/**
 * A storey's colliders plus the walkers' bodies, for the player's resolve.
 * Built when either set changes, never per frame: the bodies' boxes are
 * moved in place, so the array stays valid while the walkers walk.
 */
export function withNpcBodies(
  colliders: readonly WalkCollider[],
  bodies: readonly NpcBody[],
  cache: BodiesCache
): readonly WalkCollider[] {
  if (bodies.length === 0) return colliders;
  const hit = cache.get(colliders);
  if (hit && hit.bodies === bodies) return hit.all;
  const all = [...colliders, ...bodies.map((body) => body.collider)];
  cache.set(colliders, { bodies, all });
  return all;
}
