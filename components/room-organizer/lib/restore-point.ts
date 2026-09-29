import { recordSnapshot } from './version-history';
import type { RoomLayout } from './types';

/** True for a house nobody has worked on: no items anywhere, no floor plan. */
function isUntouched(layout: RoomLayout): boolean {
  return !layout.floorPlanImage && layout.floors.every((floor) => floor.items.length === 0);
}

/**
 * Take a forced restore point of the design that is about to be replaced
 * wholesale — share link, library/template load, JSON import, cross-tab
 * adopt (#298). The autosave cadence alone can leave the outgoing design up
 * to five minutes stale in the ring, or absent from it entirely.
 *
 * Empty houses are skipped so first-run users don't fill the ring with
 * blanks. Never throws: a failed snapshot must not block the replacement.
 */
export function snapshotBeforeReplace(outgoing: RoomLayout | null | undefined): void {
  if (!outgoing) return;
  try {
    if (isUntouched(outgoing)) return;
    recordSnapshot(outgoing, { force: true });
  } catch (error) {
    console.warn('Failed to record a restore point:', error);
  }
}
