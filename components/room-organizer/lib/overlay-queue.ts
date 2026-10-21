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

/**
 * Single-slot variant of `enqueueNewestFirst`: the head (the oldest entry,
 * on screen) is never dropped; past `limit` the oldest *waiting* entry goes.
 */
export function enqueueKeepingHead<T>(list: readonly T[], item: T, limit: number): readonly T[] {
  const next = [item, ...list];
  const head = list[list.length - 1];
  if (head === undefined || next.length <= limit) return next;
  // Keep the newest waiting entries and the head; the ones between go.
  return [...next.slice(0, Math.max(0, limit - 1)), head];
}

/** The notice a single-slot host shows: the oldest, so they play in order. */
export function queueHead<T>(newestFirst: readonly T[]): T | undefined {
  return newestFirst[newestFirst.length - 1];
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

/**
 * The lowest the stack may reach: the top of the open item sheet when the
 * sheet is under the stack's column, else the bottom of the viewport.
 */
export function stackFloor(
  sheet: BandRect | null,
  column: { left: number; right: number },
  viewportHeight: number
): number {
  if (!sheet || sheet.bottom <= sheet.top) return viewportHeight;
  if (sheet.right <= column.left || sheet.left >= column.right) return viewportHeight;
  return Math.min(viewportHeight, sheet.top);
}

/**
 * How much the stack gives up to stay clear of the open sheet: 0 nothing,
 * 1 the notices drop to one line, 2 the toasts wait as well.
 */
export type StackSqueeze = 0 | 1 | 2;
export const MAX_SQUEEZE: StackSqueeze = 2;

/**
 * Places a stack of `height` under the chrome (`preferredTop`) and above
 * `floor`. When it doesn't fit there it is raised to sit on the floor —
 * over the chrome, never over the sheet — but not above `minTop`.
 */
export function fitAboveFloor(
  preferredTop: number,
  height: number,
  floor: number,
  minTop: number
): { top: number; fits: boolean } {
  if (preferredTop + height + STACK_GAP <= floor) return { top: preferredTop, fits: true };
  return { top: Math.round(Math.max(minTop, floor - STACK_GAP - height)), fits: false };
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

/**
 * Set while the stack holds its toasts back to clear the open sheet
 * (squeeze 2). Toast timers pause meanwhile, so nothing expires unseen.
 */
export const toastsHeldBack = createFlagStore();
