import { useEffect } from 'react';
import type { FurnitureItem } from '../lib/types';

export interface KeyboardShortcutHandlers {
  removeItem(id: string): void;
  removeInteriorWall(id: string): void; 
  toggleExteriorWall(id: string): void;
  duplicateItem(id: string): void;
  /** Copy the selection to the furniture clipboard; true if anything was copied. */
  copySelection(): boolean;
  /** Paste the furniture clipboard onto the active floor; true if anything was pasted. */
  pasteClipboard(): boolean;
  rotateItem(id: string): void;
  rotateItemBy(id: string, radians: number): void;
  moveItem(id: string, x: number, z: number): void;
  toggle2D(): void;
  toggleMeasurements(): void;
  toggleSnap(): void;
  toggleSignals(): void;
  undo(): void;
  redo(): void;
  deselect(): void;
  focusOnSelection(): void;
  advanceTime(deltaHours: number): void;
  changeFloor(delta: number): void;
  toggleSidebar(): void;
  /**
   * Keyboard placement (#168): both are passed only while an item placed from
   * a catalog tile is still being positioned. Enter then locks it in place and
   * Escape takes it back out, ahead of the plain deselect.
   */
  confirmPlacement?(): void;
  cancelPlacement?(): void;
}

export interface UseKeyboardShortcutsOptions {
  selectedItem: FurnitureItem | null;
  selectedWall: { id: string; kind: 'exterior' | 'interior' } | null;
  hasSignalItems: boolean;
  /**
   * When first-person walkthrough owns the keyboard (WASD/arrows drive the
   * camera), every bare single-key shortcut is gated off so holding e.g. W to
   * walk forward doesn't also toggle the WiFi overlay (see #67). Undo/redo and
   * Escape still fire; duplicate/copy/paste do not (#339). The view-only
   * `[`/`]` (time of day) and PageUp/PageDown (floor) stay live (#463c, #446).
   */
  walkthroughActive?: boolean;
  /** Whether an item drag is in progress; read at keypress time. */
  isDragActive?: () => boolean;
  handlers: KeyboardShortcutHandlers;
}

const ARROW_DELTAS: Record<string, readonly [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

const DRAG_INTERRUPTING_CHORDS = new Set(['z', 'y', 'd', 'v']);
const DRAG_INTERRUPTING_KEYS = new Set([
  'Delete',
  'Backspace',
  'r',
  'R',
  '2',
  'PageUp',
  'PageDown',
  ...Object.keys(ARROW_DELTAS),
]);

/**
 * Shortcuts that change the layout, the active floor, or the render mode.
 * Mid-drag they rebuild the furniture under the dragged mesh, and the release
 * then commits the stale in-flight positions on top of the result (#207).
 */
function interruptsDrag(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey) return DRAG_INTERRUPTING_CHORDS.has(event.key.toLowerCase());
  return DRAG_INTERRUPTING_KEYS.has(event.key);
}

export function useKeyboardShortcuts({
  selectedItem,
  selectedWall,
  hasSignalItems,
  walkthroughActive = false,
  isDragActive,
  handlers,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (ownsKey(event)) return;

      // Held until the drop; view-only keys (snap, measurements, time) still work.
      if (isDragActive?.() && interruptsDrag(event)) {
        event.preventDefault();
        return;
      }

      const ctrlOrCmd = event.ctrlKey || event.metaKey;
      // Letter shortcuts match regardless of case, so Caps Lock doesn't
      // silently disable them (#294).
      const key = event.key.toLowerCase();
      if (ctrlOrCmd && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) handlers.redo();
        else handlers.undo();
        return;
      }
      if (ctrlOrCmd && key === 'y') {
        event.preventDefault();
        handlers.redo();
        return;
      }

      // Duplicate / copy / paste edit the house, so they are off while the
      // walkthrough owns the keyboard, like the bare keys below; undo/redo
      // above stay available (#339).
      if (ctrlOrCmd && key === 'd' && selectedItem && !walkthroughActive) {
        event.preventDefault();
        handlers.duplicateItem(selectedItem.id);
        return;
      }

      // Furniture clipboard (#153). Ctrl+C only engages while furniture is
      // selected, so copying text elsewhere in the page keeps working; Ctrl+V
      // engages only when the clipboard actually has furniture.
      if (ctrlOrCmd && key === 'c' && selectedItem && !walkthroughActive) {
        if (handlers.copySelection()) event.preventDefault();
        return;
      }
      if (ctrlOrCmd && key === 'v' && !walkthroughActive) {
        if (handlers.pasteClipboard()) event.preventDefault();
        return;
      }

      // A pending keyboard placement owns Enter/Escape (#168).
      if (event.key === 'Enter' && handlers.confirmPlacement) {
        event.preventDefault();
        handlers.confirmPlacement();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        if (handlers.cancelPlacement) handlers.cancelPlacement();
        else handlers.deselect();
        return;
      }

      // Everything below is a bare single-key shortcut. Never swallow browser
      // shortcuts like Cmd/Ctrl+F (find), Ctrl+R (reload), or Cmd+M.
      // AltGr is reported as ctrlKey+altKey on Windows, so a plain guard on
      // those modifiers makes AltGr-produced keys (e.g. `[`/`]` on German /
      // French / Nordic layouts) unreachable. Skip the guard when AltGraph is
      // actually engaged — real Ctrl/Cmd chords never set the AltGraph state.
      const altGraph = event.getModifierState('AltGraph');
      if (!altGraph && (ctrlOrCmd || event.altKey)) return;

      // The clock and the floor only change what you look at, so they work
      // while walking too: day to night with `[`/`]` (#463c), another storey
      // with PageUp/PageDown, landing at its stairs (#446).
      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        handlers.advanceTime(event.key === ']' ? 1 : -1);
        return;
      }
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault();
        handlers.changeFloor(event.key === 'PageUp' ? 1 : -1);
        return;
      }

      // While walkthrough owns the keyboard, WASD/arrows/Shift drive the camera.
      // Gate every other bare single-key shortcut below off so walking forward
      // (W) doesn't also toggle the WiFi overlay, `2`/`m`/`g`/`p` don't fire
      // mid-walk, etc. (see #67). Undo/redo and Escape above still work; the
      // walkthrough hook owns its own Esc-to-exit handling.
      if (walkthroughActive) return;

      if (key === 'f' && selectedItem) {
        event.preventDefault();
        handlers.focusOnSelection();
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedItem) {
        event.preventDefault();
        // Lock enforcement lives in the handler: it must see the whole
        // selection, not just the primary — gating on the primary's lock here
        // blocked deleting unlocked extras and let locked extras through (#115).
        handlers.removeItem(selectedItem.id);
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedWall) {
        event.preventDefault();
        if (selectedWall.kind === 'interior') {
          handlers.removeInteriorWall(selectedWall.id);
        } else {
          handlers.toggleExteriorWall(selectedWall.id);
        }
        return;
      }

      if (key === 'r' && selectedItem) {
        event.preventDefault();
        if (event.shiftKey) {
          // Fine-grained 15° rotations when Shift is held.
          handlers.rotateItemBy(selectedItem.id, Math.PI / 12);
        } else {
          handlers.rotateItem(selectedItem.id);
        }
        return;
      }

      if (event.key === '2') {
        event.preventDefault();
        handlers.toggle2D();
        return;
      }

      if (key === 'm') {
        event.preventDefault();
        handlers.toggleMeasurements();
        return;
      }

      if (key === 'g') {
        event.preventDefault();
        handlers.toggleSnap();
        return;
      }

      if (key === 'w' && hasSignalItems) {
        event.preventDefault();
        handlers.toggleSignals();
        return;
      }

      if (key === 'p') {
        event.preventDefault();
        handlers.toggleSidebar();
        return;
      }

      const delta = ARROW_DELTAS[event.key];
      if (delta && selectedItem?.position && !selectedItem.locked) {
        event.preventDefault();
        const step = event.shiftKey ? 1.0 : 0.1;
        const [dx, dz] = delta;
        handlers.moveItem(
          selectedItem.id,
          selectedItem.position.x + dx * step,
          selectedItem.position.z + dz * step
        );
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedItem, selectedWall, hasSignalItems, walkthroughActive, isDragActive, handlers]);
}

/**
 * Whether the focused control keeps this key for itself. Text fields keep
 * everything (their own text undo included). A native <select> keeps keys
 * that drive it (arrows, letters for type-ahead, Space/Enter) but has no
 * undo of its own, and picking an option leaves it focused, so Ctrl/Cmd+Z
 * and Ctrl/Cmd+Y still reach the editor (#415).
 */
function ownsKey(event: KeyboardEvent): boolean {
  if (!isTypingTarget(event.target)) return false;
  if (!(event.target instanceof HTMLSelectElement)) return true;
  const key = event.key.toLowerCase();
  return !((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y'));
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}
