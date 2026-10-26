/**
 * Where the walkers (hooks/use-npcs.ts) can sit. Every seat on the floor is
 * reduced to one or more slots: the spot the hips land on, the yaw the sitter
 * faces, and an approach point clear of the seat's own footprint where the
 * walker turns in. Seats face their local +z: the builders in
 * three/builders/builders-seating.ts put every backrest at −z.
 */

import { seatSurfaceHeight } from './seat-surface';
import type { FurnitureItem } from './types';

export interface NpcSeat {
  /** Item id plus slot index: stable while the item stays put. */
  key: string;
  itemId: string;
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
}

/** What the walkers sit on; how high comes from lib/seat-surface (#623). */
const NPC_SEAT_TYPES: ReadonlySet<string> = new Set(['chair', 'dining-chair', 'armchair', 'sofa', 'bench', 'garden-bench']);

/** Seats wide enough for several people get one slot per this many metres. */
const SLOT_WIDTH = 0.65;
/** How far in front of the seat's front edge the walker turns round. */
const APPROACH_GAP = 0.35;
/** The hips sit a little forward of the centre, clear of the backrest. */
const HIP_FORWARD = 0.08;

export function isNpcSeat(item: Pick<FurnitureItem, 'type' | 'sofaShape'>): boolean {
  if (!NPC_SEAT_TYPES.has(item.type)) return false;
  // Corner sofas have no single front to sit facing.
  return item.type !== 'sofa' || (item.sofaShape ?? 'standard') === 'standard';
}

export function findNpcSeats(items: readonly FurnitureItem[]): NpcSeat[] {
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
    for (let slot = 0; slot < slots; slot++) {
      const along = (slot + 0.5) * (item.width / slots) - item.width / 2;
      const cx = item.position.x + wx * along;
      const cz = item.position.z + wz * along;
      const forward = item.depth * HIP_FORWARD;
      const approach = item.depth / 2 + APPROACH_GAP;
      seats.push({
        key: `${item.id}:${slot}`,
        itemId: item.id,
        x: cx + fx * forward,
        z: cz + fz * forward,
        rotation,
        seatHeight,
        approachX: cx + fx * approach,
        approachZ: cz + fz * approach,
      });
    }
  }
  return seats;
}
