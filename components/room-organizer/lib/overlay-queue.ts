/**
 * Overlay policy for small screens (Responsive & mobile sprint).
 *
 * On a phone, or any viewport too short for the floating desktop chrome, the
 * item editor becomes a bottom sheet and toasts share a single slot under the
 * top pills: one at a time, the rest queued, so two achievements can no
 * longer cover half the screen. Pure: no React, no DOM.
 */

/**
 * Viewports that get the bottom-sheet item editor and the single toast slot.
 * Must match the "Overlays (mobile sprint)" rules in app/globals.css.
 */
export const COMPACT_OVERLAY_QUERY = '(max-width: 768px), (max-height: 500px)';

/**
 * Viewports where the header stats box is hidden (app/globals.css), so the
 * save-failed and changed-in-another-tab notices need their own slot (#385).
 */
export const HEADER_HIDDEN_QUERY = '(max-width: 1100px), (max-height: 500px)';

/** How many status notices a single-slot host keeps waiting. */
export const MAX_QUEUED_NOTICES = 6;

/**
 * Adds a notice to a newest-first list, dropping the oldest past `limit`.
 * A desktop host shows the whole (short) list; a single-slot host queues.
 */
export function enqueueNewestFirst<T>(list: readonly T[], item: T, limit: number): readonly T[] {
  return [item, ...list].slice(0, Math.max(0, limit));
}

/** The notice a single-slot host shows: the oldest, so they play in order. */
export function queueHead<T>(newestFirst: readonly T[]): T | undefined {
  return newestFirst[newestFirst.length - 1];
}

/**
 * Index of the next queued entry after the one at `shown`, or null once the
 * queue is drained (the caller then clears it).
 */
export function advanceQueue(shown: number, length: number): number | null {
  const next = shown + 1;
  return next < length ? next : null;
}

export interface BandRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Gap between the overlay stack and whatever sits above it. */
export const STACK_GAP = 8;

/**
 * Top edge for the overlay stack: just under every piece of chrome in the
 * top band that it would otherwise cover (pills, touch camera row, minimap,
 * tool chips), whatever the HUD layout of the moment. Only chrome that
 * starts in the top `bandFraction` of the viewport and overlaps the stack's
 * own column counts, and the result never goes below `maxFraction` of the
 * viewport, so a tall left column can't push the stack onto the sheet.
 */
export function overlayStackTop(
  chrome: readonly BandRect[],
  column: { left: number; right: number },
  viewportHeight: number,
  minTop: number,
  { bandFraction = 0.4, maxFraction = 0.5 }: { bandFraction?: number; maxFraction?: number } = {}
): number {
  const bandLimit = viewportHeight * bandFraction;
  let top = minTop;
  for (const rect of chrome) {
    if (rect.bottom <= rect.top || rect.right <= rect.left) continue;
    if (rect.top >= bandLimit) continue;
    if (rect.right <= column.left || rect.left >= column.right) continue;
    top = Math.max(top, rect.bottom + STACK_GAP);
  }
  return Math.round(Math.min(top, Math.max(minTop, viewportHeight * maxFraction)));
}

type Listener = () => void;

/** A boolean with subscribers, shaped for `useSyncExternalStore`. */
export interface FlagStore {
  get(): boolean;
  set(value: boolean): void;
  subscribe(listener: Listener): () => void;
}

export function createFlagStore(initial = false): FlagStore {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Set while a status notice holds the single toast slot. Achievements wait
 * for it, so on a phone the two hosts never show a toast each.
 */
export const statusToastInSlot = createFlagStore();
