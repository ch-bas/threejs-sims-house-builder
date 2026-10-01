import { recordSnapshot } from './version-history';
import type { RoomLayout } from './types';

/**
 * True for a house nobody has worked on. Furniture is not the only work: a
 * shell with drawn partitions, dormers, a sloped site or a porch and no
 * furniture yet is hours of design, so structure counts too.
 */
function isUntouched(layout: RoomLayout): boolean {
  if (layout.floorPlanImage) return false;
  if (layout.floors.length > 1) return false;
  if (layout.terrain || layout.entrance || layout.frontage) return false;
  if (layout.neighbours && Object.values(layout.neighbours).some(Boolean)) return false;
  if ((layout.roof?.dormers?.length ?? 0) > 0) return false;
  return layout.floors.every(
    (floor) => floor.items.length === 0 && (floor.interiorWalls?.length ?? 0) === 0
  );
}

/**
 * Take a forced restore point of the design that is about to be replaced
 * wholesale — share link, library/template load, History restore, JSON
 * import, cross-tab adopt (#298). The autosave cadence alone can leave the outgoing design up
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

/**
 * The one confirm every whole-house replacement asks before it runs —
 * template, library, paste-board, History restore, JSON import (#364).
 * `incoming` names what replaces the house ("the Bedroom template"). Asks
 * only when the current house holds work; an untouched one is replaced
 * silently. Returns whether to go ahead.
 */
export function confirmReplace(
  current: RoomLayout,
  incoming: string,
  ask: (message: string) => boolean = (message) => window.confirm(message)
): boolean {
  if (isUntouched(current)) return true;
  return ask(`Replace your current house with ${incoming}? Undo restores it.`);
}
