/**
 * Whether the `?` shortcut overlay is open (#932): `?` and the View menu's
 * Keys entry flip it; the overlay's host shows it. The keys that act from a
 * window capture listener (the placement ghost, the wall length) give way
 * while it is open, so nothing acts behind the modal.
 *
 * Pure: no React, no DOM.
 */

let open = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

export function toggleShortcutsOverlay(): void {
  set(!open);
}

export function openShortcutsOverlay(): void {
  set(true);
}

export function closeShortcutsOverlay(): void {
  set(false);
}

export function isShortcutsOverlayOpen(): boolean {
  return open;
}

/** Follow it; returns the unsubscribe. */
export function subscribeShortcutsOverlay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
