import { useEffect, useRef } from 'react';

/**
 * The Android back gesture closes the open surface instead of leaving the
 * editor (#926). Where the browser has `CloseWatcher` (Chromium 120+, every
 * current Android), the surface on top owns one watcher; back closes it
 * without adding a history entry, so the share-hash logic and reloads are
 * untouched. Elsewhere nothing changes: iOS has no back inside a standalone
 * app, and desktop users have Escape.
 *
 * One watcher at a time, for the top surface, so back closes the same thing
 * Escape does: surfaces stack by `layer` first (the drawer covers the item
 * sheet on a phone, and its own handler closes a popover beside it first,
 * as Escape does), then by when they opened. A browser lets a page create
 * only one ungrouped watcher without a user gesture; keeping exactly one
 * alive means back never closes two things at once.
 *
 * Chromium also turns Escape into a close request after an uncancelled
 * keydown. Escape already has its own handlers (`useDialogFocus`, the global
 * shortcut), so a close request that follows an Escape keydown is ignored
 * and desktop keyboards behave exactly as before.
 */

/** The stacking order of the surfaces back can close; higher closes first. */
export const BACK_LAYER = {
  /** The item popover, a bottom sheet on a phone. */
  itemSheet: 10,
  /** The side panels drawer: full screen on a phone, over the sheet. */
  drawer: 20,
  /**
   * Every other dialog `useDialogFocus` handles Escape for: a confirm asked
   * from the drawer, the start chooser, a toast holding the keys. Back
   * answers them first, as Escape does (a confirm hears Cancel).
   */
  dialog: 30,
} as const;

interface CloseWatcherLike {
  onclose: ((event: Event) => void) | null;
  destroy(): void;
}

type CloseWatcherConstructor = new () => CloseWatcherLike;

interface BackEntry {
  readonly layer: number;
  readonly order: number;
  readonly onBack: () => void;
}

const entries = new Set<BackEntry>();
let nextOrder = 0;
let watcher: CloseWatcherLike | null = null;
let watched: BackEntry | null = null;
let lastEscapeAt = Number.NEGATIVE_INFINITY;
let escapeListening = false;

/** A close request this soon after an Escape keydown is that Escape's. */
const ESCAPE_ECHO_MS = 300;

function closeWatcherClass(): CloseWatcherConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { CloseWatcher?: unknown }).CloseWatcher;
  return typeof candidate === 'function' ? (candidate as CloseWatcherConstructor) : null;
}

/** Whether this browser closes surfaces on back (tests stub `CloseWatcher`). */
export function backDismissSupported(): boolean {
  return closeWatcherClass() !== null;
}

function noteEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') lastEscapeAt = performance.now();
}

function topEntry(): BackEntry | null {
  let top: BackEntry | null = null;
  for (const entry of entries) {
    if (!top || entry.layer > top.layer || (entry.layer === top.layer && entry.order > top.order)) top = entry;
  }
  return top;
}

function dropWatcher(): void {
  if (!watcher) return;
  watcher.onclose = null;
  watcher.destroy();
  watcher = null;
  watched = null;
}

/** Keeps exactly one watcher alive, for the top surface. */
function sync(): void {
  const top = topEntry();
  if (top === watched && watcher) return;
  dropWatcher();
  const Watcher = closeWatcherClass();
  if (!top || !Watcher) return;
  let created: CloseWatcherLike;
  try {
    created = new Watcher();
  } catch {
    // A browser that refuses a watcher leaves back as it was.
    return;
  }
  created.onclose = () => {
    // A closed watcher is spent: forget it, then make one for whatever is
    // still open — the same surface, if its back only closed a popover.
    if (watcher === created) {
      watcher = null;
      watched = null;
    }
    if (performance.now() - lastEscapeAt >= ESCAPE_ECHO_MS && entries.has(top)) top.onBack();
    window.setTimeout(sync, 0);
  };
  watcher = created;
  watched = top;
}

/** For tests: forget the last Escape, so the next close request counts as back. */
export function resetBackDismiss(): void {
  lastEscapeAt = Number.NEGATIVE_INFINITY;
}

/**
 * While `open`, back closes this surface through `onBack` (which should do
 * what Escape does to it). The watcher is made in the open transition and
 * dropped on close, so a hidden surface never holds one (#3).
 */
export function useBackDismiss(open: boolean, layer: number, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (!open || !backDismissSupported()) return undefined;
    if (!escapeListening) {
      window.addEventListener('keydown', noteEscape, true);
      escapeListening = true;
    }
    const entry: BackEntry = { layer, order: nextOrder++, onBack: () => onBackRef.current() };
    entries.add(entry);
    sync();
    return () => {
      entries.delete(entry);
      sync();
      if (entries.size === 0 && escapeListening) {
        window.removeEventListener('keydown', noteEscape, true);
        escapeListening = false;
      }
    };
  }, [open, layer]);
}
