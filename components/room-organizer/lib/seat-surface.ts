/**
 * How high a seat's sitting surface is (#623): one table, read by the
 * walkers (`lib/npc-seats`) and by the seated player (`lib/walk-interact`),
 * so both sit at the same height on the same sofa and rise with a resized one.
 * Each entry is the top of the seat in the item's builder, as a fraction of
 * the item height plus a fixed thickness where the builder uses one.
 */

import type { FurnitureItem } from './types';

interface SeatSurface {
  fraction: number;
  /** Metres added to the fraction: a seat board of fixed thickness. */
  offset?: number;
}

const SEAT_SURFACES: Readonly<Record<string, SeatSurface>> = {
  // builders-seating.ts: a 0.1 h seat board centred at 0.5 h.
  chair: { fraction: 0.55 },
  'dining-chair': { fraction: 0.55 },
  // The seat block, 0.45 h tall at 0.35 h.
  armchair: { fraction: 0.575 },
  // The seat block, 0.5 h tall at 0.4 h; the cushions on it give under the sitter.
  sofa: { fraction: 0.65 },
  // The top board is the item's top.
  bench: { fraction: 1 },
  // builders-outdoor.ts: a 6 cm board at 0.5 h.
  'garden-bench': { fraction: 0.5, offset: 0.03 },
  // builders-bedroom.ts: the mattress, 0.32 h tall at 0.46 h.
  bed: { fraction: 0.62 },
  // builders-bathroom.ts: a 0.07 h seat ring at 0.5 h.
  toilet: { fraction: 0.535 },
};

/** The type's sitting surface; undefined for anything else, a prototype key such as "constructor" included. */
function seatSurfaceOf(type: string): SeatSurface | undefined {
  return Object.hasOwn(SEAT_SURFACES, type) ? SEAT_SURFACES[type] : undefined;
}

/** Whether the item has a sitting surface. */
export function hasSeatSurface(item: Pick<FurnitureItem, 'type'>): boolean {
  return seatSurfaceOf(item.type) !== undefined;
}

/** Height of the sitting surface above the item's base, metres; null for something you can't sit on. */
export function seatSurfaceHeight(item: Pick<FurnitureItem, 'type' | 'height'>): number | null {
  const surface = seatSurfaceOf(item.type);
  if (!surface) return null;
  return Math.min(item.height, item.height * surface.fraction + (surface.offset ?? 0));
}
