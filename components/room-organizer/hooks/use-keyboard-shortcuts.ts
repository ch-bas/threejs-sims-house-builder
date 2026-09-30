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
   * walk forward doesn't also toggle the WiFi overlay (see #67). Ctrl/Cmd chords
   * (undo/redo/duplicate) and Escape still fire.
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
      if (isTypingTarget(event.target)) return;

      // Held until the drop; view-only keys (snap, measurements, time) still work.
      if (isDragActive?.() && interruptsDrag(event)) {
        event.preventDefault();
        return;
      }

      const ctrlOrCmd = event.ctrlKey || event.metaKey;
      if (ctrlOrCmd && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) handlers.redo();
        else handlers.undo();
        return;
      }
      if (ctrlOrCmd && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        handlers.redo();
        return;
      }

      if (ctrlOrCmd && event.key.toLowerCase() === 'd' && selectedItem) {
        event.preventDefault();
        handlers.duplicateItem(selectedItem.id);
        return;
      }

      // Furniture clipboard (#153). Ctrl+C only engages while furniture is
      // selected, so copying text elsewhere in the page keeps working; Ctrl+V
      // engages only when the clipboard actually has furniture.
      if (ctrlOrCmd && event.key.toLowerCase() === 'c' && selectedItem) {
        if (handlers.copySelection()) event.preventDefault();
        return;
      }
      if (ctrlOrCmd && event.key.toLowerCase() === 'v') {
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

      // While walkthrough owns the keyboard, WASD/arrows/Shift drive the camera.
      // Gate every bare single-key shortcut below off so walking forward (W)
      // doesn't also toggle the WiFi overlay, `2`/`m`/`g`/`p`/`[`/`]`/PageUp/Down
      // don't fire mid-walk, etc. (see #67). Ctrl/Cmd chords and Escape above
      // still work; the walkthrough hook owns its own Esc-to-exit handling.
      if (walkthroughActive) return;

      // Everything below is a bare single-key shortcut. Never swallow browser
      // shortcuts like Cmd/Ctrl+F (find), Ctrl+R (reload), or Cmd+M.
      // AltGr is reported as ctrlKey+altKey on Windows, so a plain guard on
      // those modifiers makes AltGr-produced keys (e.g. `[`/`]` on German /
      // French / Nordic layouts) unreachable. Skip the guard when AltGraph is
      // actually engaged — real Ctrl/Cmd chords never set the AltGraph state.
      const altGraph = event.getModifierState('AltGraph');
      if (!altGraph && (ctrlOrCmd || event.altKey)) return;

      if (event.key === 'f' && selectedItem) {
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

      if (event.key.toLowerCase() === 'r' && selectedItem) {
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

      if (event.key === '[') {
        event.preventDefault();
        handlers.advanceTime(-1);
        return;
      }
      if (event.key === ']') {
        event.preventDefault();
        handlers.advanceTime(1);
        return;
      }

      if (event.key === 'PageUp') {
        event.preventDefault();
        handlers.changeFloor(1);
        return;
      }
      if (event.key === 'PageDown') {
        event.preventDefault();
        handlers.changeFloor(-1);
        return;
      }

      if (event.key === 'm') {
        event.preventDefault();
        handlers.toggleMeasurements();
        return;
      }

      if (event.key === 'g') {
        event.preventDefault();
        handlers.toggleSnap();
        return;
      }

      if (event.key === 'w' && hasSignalItems) {
        event.preventDefault();
        handlers.toggleSignals();
        return;
      }

      if (event.key === 'p') {
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

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}
