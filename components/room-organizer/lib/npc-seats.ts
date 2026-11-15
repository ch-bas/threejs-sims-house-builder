/**
 * Where the walkers (hooks/use-npcs.ts) can sit. Every seat on the floor is
 * reduced to one or more slots: the spot the hips land on, the yaw the sitter
 * faces, and an approach point clear of the seat's own footprint where the
 * walker turns in. Seats face their local +z: the builders in
 * three/builders/builders-seating.ts put every backrest at −z, and a bed's
 * headboard is at −z, so a walker sits on the end of the bed (#617).
 */

import { seatSurfaceHeight } from './seat-surface';
import type { FurnitureItem } from './types';
import type { WalkCollider } from './walk-collision';

export interface NpcSeat {
  /** Item id plus slot index: stable while the item stays put. */
  key: string;
  itemId: string;
  /** The item's type: what sitting there is for (`lib/npc-needs`). */
  itemType: string;
  /** Where the hips land. */
  x: number;
  z: number;
  /** Yaw the sitter faces (Three's rotation.y; the figure faces +z). */
  rotation: number;
  /** Height of the sitting surface above the floor, metres. */
  seatHeight: number;
  /** In front of the seat, outside its footprint. */
  approachX: number;
  approachZ: number;
  /**
   * How many people the whole item takes at once (#907): one per slot, but
   * a bed sleeps one, a double bed (`DOUBLE_BED_WIDTH` or wider) two.
   */
  places: number;
}

/** What the walkers sit on; how high comes from lib/seat-surface (#623). */
const NPC_SEAT_TYPES: ReadonlySet<string> = new Set(['chair', 'dining-chair', 'armchair', 'sofa', 'bench', 'garden-bench', 'bed']);

/** Seats wide enough for several people get one slot per this many metres. */
const SLOT_WIDTH = 0.65;
/** How far in front of the seat's front edge the walker turns round. */
const APPROACH_GAP = 0.35;
/** The hips sit a little forward of the centre, clear of the backrest. */
const HIP_FORWARD = 0.08;
/** On a bed the hips sit this far in from the foot end. */
const BED_EDGE = 0.25;
/** A bed this wide (m) or wider sleeps two. */
export const DOUBLE_BED_WIDTH = 1.35;
/**
 * Chairs that stand pushed in at a desk or a table: when their front isn't
 * free floor, the walker comes in from the side, or else from behind (#904).
 */
const PULLED_IN_TYPES: ReadonlySet<string> = new Set(['chair', 'dining-chair']);
/**
 * Where a sitter's feet stand in front of its hips: three/people-model's
 * SIT_HIP_BACK (0.23 m) at the tallest walker. The walk into a seat ends there.
 */
const SIT_FEET_FORWARD = 0.24;
/** The walk from a side or rear approach to the feet keeps this clear of everything else (m). */
const PULL_OUT_CLEARANCE = 0.1;
/** Points tested along that walk, this far apart (m): under half the thinnest partition. */
const PULL_OUT_STEP = 0.04;

/** What a pushed-in chair's way in is tested against: the storey's nav (lib/npc-path). */
export interface SeatGround {
  /** Whether a walker can stand on a point. */
  isFree(x: number, z: number): boolean;
  /** Everything a walker can't pass through: furniture and partitions (`NpcNav.colliders`). */
  blockers: readonly WalkCollider[];
}

export function isNpcSeat(item: Pick<FurnitureItem, 'type' | 'sofaShape'>): boolean {
  if (!NPC_SEAT_TYPES.has(item.type)) return false;
  // Corner sofas have no single front to sit facing.
  return item.type !== 'sofa' || (item.sofaShape ?? 'standard') === 'standard';
}

/**
 * Every seat slot on the floor. With the `ground` (the storey's nav), a
 * chair whose front is blocked, pushed in at a desk or a table, is
 * approached from whichever side is free, or else from behind (#904), but
 * only when the straight walk from there to where the feet go crosses
 * nothing but the chair itself, partitions included. A chair tucked under
 * a table (its feet would stand inside it) keeps its blocked front, and the
 * walkers pass it over.
 */
export function findNpcSeats(items: readonly FurnitureItem[], ground?: SeatGround): NpcSeat[] {
  const seats: NpcSeat[] = [];
  for (const item of items) {
    if (!item.position || !isNpcSeat(item)) continue;
    const rotation = item.rotation ?? 0;
    // Local +z (forward) and +x (along the width) in world space.
    const fx = Math.sin(rotation);
    const fz = Math.cos(rotation);
    const wx = Math.cos(rotation);
    const wz = -Math.sin(rotation);
    const slots = Math.max(1, Math.floor(item.width / SLOT_WIDTH));
    const seatHeight = seatSurfaceHeight(item) ?? item.height;
    const places = item.type === 'bed' ? (item.width >= DOUBLE_BED_WIDTH ? 2 : 1) : slots;
    for (let slot = 0; slot < slots; slot++) {
      const along = (slot + 0.5) * (item.width / slots) - item.width / 2;
      const cx = item.position.x + wx * along;
      const cz = item.position.z + wz * along;
      const forward = item.type === 'bed' ? Math.max(0, item.depth / 2 - BED_EDGE) : item.depth * HIP_FORWARD;
      const approach = item.depth / 2 + APPROACH_GAP;
      let approachX = cx + fx * approach;
      let approachZ = cz + fz * approach;
      if (ground && slots === 1 && PULLED_IN_TYPES.has(item.type) && !ground.isFree(approachX, approachZ)) {
        const side = item.width / 2 + APPROACH_GAP;
        const feetX = cx + fx * (forward + SIT_FEET_FORWARD);
        const feetZ = cz + fz * (forward + SIT_FEET_FORWARD);
        // Right, left, then behind: the first a walker can stand on and walk in from.
        const candidates = [cx + wx * side, cz + wz * side, cx - wx * side, cz - wz * side, cx - fx * approach, cz - fz * approach];
        for (let i = 0; i < candidates.length; i += 2) {
          const x = candidates[i]!;
          const z = candidates[i + 1]!;
          if (!ground.isFree(x, z) || !wayInClear(ground.blockers, item, x, z, feetX, feetZ)) continue;
          approachX = x;
          approachZ = z;
          break;
        }
      }
      seats.push({
        key: `${item.id}:${slot}`,
        itemId: item.id,
        itemType: item.type,
        x: cx + fx * forward,
        z: cz + fz * forward,
        rotation,
        seatHeight,
        approachX,
        approachZ,
        places,
      });
    }
  }
  return seats;
}

/**
 * Whether the straight walk from (x0, z0) to the feet at (x1, z1) keeps
 * `PULL_OUT_CLEARANCE` from every blocker but the chair's own box: the
 * feet must not end under a table, nor the walk cut a corner of it or pass
 * through a partition.
 */
function wayInClear(blockers: readonly WalkCollider[], chair: FurnitureItem, x0: number, z0: number, x1: number, z1: number): boolean {
  const length = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(length / PULL_OUT_STEP));
  for (const box of blockers) {
    if (isOwnBox(box, chair)) continue;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const dx = x0 + (x1 - x0) * t - box.cx;
      const dz = z0 + (z1 - z0) * t - box.cz;
      if (Math.abs(dx * box.ax + dz * box.az) < box.hw + PULL_OUT_CLEARANCE && Math.abs(dx * box.bx + dz * box.bz) < box.hd + PULL_OUT_CLEARANCE) {
        return false;
      }
    }
  }
  return true;
}

/** The chair's own collider: the box at its centre, its size. */
function isOwnBox(box: WalkCollider, chair: FurnitureItem): boolean {
  const at = chair.position!;
  return (
    !box.wall &&
    Math.abs(box.cx - at.x) < 1e-6 &&
    Math.abs(box.cz - at.z) < 1e-6 &&
    Math.abs(box.hw - chair.width / 2) < 1e-6 &&
    Math.abs(box.hd - chair.depth / 2) < 1e-6
  );
}
