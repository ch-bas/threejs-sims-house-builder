import { INITIAL_LAYOUT } from './initial-layout';
import { recordSnapshot } from './version-history';
import type { RoomLayout } from './types';

/**
 * Top-level fields that are not work: the name and id are labels, and the
 * floor-plan opacity and fit only style an image (the image itself counts).
 */
const NOT_WORK = new Set<string>(['id', 'name', 'floorPlanOpacity', 'floorPlanFitMode']);

/** Structural equality over JSON-shaped data; a key holding `undefined` counts as absent. */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => sameData(value, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameData(left[key], right[key])) return false;
  }
  return true;
}

/**
 * True for a house nobody has worked on: the initial layout, give or take a
 * name (#346). Compared field by field against `INITIAL_LAYOUT` rather than
 * against a hand-picked list of "work" fields, so zones, colours, the room
 * size, the roof, storey heights — and any field added later — all count.
 */
function isUntouched(layout: RoomLayout): boolean {
  const keys = new Set([...Object.keys(layout), ...Object.keys(INITIAL_LAYOUT)]);
  for (const key of keys) {
    if (NOT_WORK.has(key)) continue;
    if (!sameData(layout[key as keyof RoomLayout], INITIAL_LAYOUT[key as keyof RoomLayout])) return false;
  }
  return true;
}

/**
 * Take a forced restore point of the design that is about to be replaced
 * wholesale — share link, library/template load, History restore, JSON
 * import, cross-tab adopt (#298). The autosave cadence alone can leave the
 * outgoing design up to five minutes stale in the ring, or absent from it
 * entirely. Each load path calls this exactly once, in the handler that
 * applies the new layout (#352).
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
