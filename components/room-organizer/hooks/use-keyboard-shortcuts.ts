import { useEffect } from 'react';
import { EDIT_KEYS as K } from '../lib/keymap';
import { isPhotoMode } from '../lib/photo-mode';
import { isTypingTarget } from '../lib/walk-input';
import type { FurnitureItem } from '../lib/types';
import type { SelectedWall } from '../lib/wall-sides';

export interface KeyboardShortcutHandlers {
  removeItem(id: string): void;
  /** One Placed Items row, never the selection around it (#634). */
  removeRow(id: string): void;
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
  /** U: lock or unlock the selection (#635). */
  toggleLock(id: string): void;
  /** An arrow nudge met a locked item: say so (#635). */
  refuseLocked(id: string): void;
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
  /** `?`: open or close the shortcut overlay (#932). */
  toggleShortcuts(): void;
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
  selectedWall: SelectedWall | null;
  hasSignalItems: boolean;
  /**
   * When first-person walkthrough owns the keyboard (WASD/arrows drive the
   * camera), every bare single-key shortcut is gated off so holding e.g. W to
   * walk forward doesn't also toggle the WiFi overlay (see #67). Undo/redo and
   * Escape still fire; duplicate/copy/paste do not (#339). The view-only
   * `[`/`]` (time of day) and PageUp/PageDown (floor) stay live (#463c, #446).
   */
  walkthroughActive?: boolean;
  /**
   * EXPLORE (the game mode, not the 3D walk): nothing edits the house, the
   * 2D plan included (#643, #699). Duplicate, copy, paste, delete, rotate and
   * the arrow nudge are off; undo/redo (#339) and the view keys stay.
   */
  exploring?: boolean;
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

const DRAG_INTERRUPTING_CHORDS = new Set<string>([K.undo, K.redo, K.duplicate, K.paste]);
const DRAG_INTERRUPTING_KEYS = new Set<string>([
  K.deleteKey,
  K.backspace,
  K.rotate,
  K.rotate.toUpperCase(),
  K.lock,
  K.lock.toUpperCase(),
  K.plan,
  K.floorUp,
  K.floorDown,
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
  exploring = false,
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
      if (ctrlOrCmd && key === K.undo) {
        event.preventDefault();
        if (event.shiftKey) handlers.redo();
        else handlers.undo();
        return;
      }
      if (ctrlOrCmd && key === K.redo) {
        event.preventDefault();
        handlers.redo();
        return;
      }

      // Duplicate / copy / paste edit the house, so they are off while the
      // walkthrough owns the keyboard, like the bare keys below, and in
      // EXPLORE on the 2D plan too (#699); undo/redo above stay (#339).
      const editsOff = walkthroughActive || exploring;
      if (ctrlOrCmd && key === K.duplicate && selectedItem && !editsOff) {
        event.preventDefault();
        handlers.duplicateItem(selectedItem.id);
        return;
      }

      // Furniture clipboard (#153). Ctrl+C only engages while furniture is
      // selected, so copying text elsewhere in the page keeps working; Ctrl+V
      // engages only when the clipboard actually has furniture.
      if (ctrlOrCmd && key === K.copy && selectedItem && !editsOff) {
        if (handlers.copySelection()) event.preventDefault();
        return;
      }
      if (ctrlOrCmd && key === K.paste && !editsOff) {
        if (handlers.pasteClipboard()) event.preventDefault();
        return;
      }

      // A pending keyboard placement owns Enter/Escape (#168).
      if (event.key === K.confirm && handlers.confirmPlacement) {
        event.preventDefault();
        handlers.confirmPlacement();
        return;
      }

      if (event.key === K.escape) {
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
      if (event.key === K.earlier || event.key === K.later) {
        event.preventDefault();
        handlers.advanceTime(event.key === K.later ? 1 : -1);
        return;
      }
      if (event.key === K.floorUp || event.key === K.floorDown) {
        event.preventDefault();
        // One storey per press: a held key would rebuild the scene thirty
        // times a second and skip storeys unseen.
        if (!event.repeat) handlers.changeFloor(event.key === K.floorUp ? 1 : -1);
        return;
      }

      // While walkthrough owns the keyboard, WASD/arrows/Shift drive the camera.
      // Gate every other bare single-key shortcut below off so walking forward
      // (W) doesn't also toggle the WiFi overlay, `2`/`m`/`g`/`p` don't fire
      // mid-walk, etc. (see #67). Undo/redo and Escape above still work; the
      // walkthrough hook owns its own Esc-to-exit handling.
      if (walkthroughActive) return;

      // The shortcut overlay (#932): view-only, so EXPLORE and a tour get it
      // too. Photo mode's key guard stops it before here; the check holds
      // should that guard ever let a key by.
      if (event.key === K.shortcuts) {
        event.preventDefault();
        if (!event.repeat && !isPhotoMode()) handlers.toggleShortcuts();
        return;
      }

      if (key === K.focus && selectedItem) {
        event.preventDefault();
        // Once per press: each repeat would restart the camera's glide (#930).
        if (!event.repeat) handlers.focusOnSelection();
        return;
      }

      // EXPLORE on the 2D plan: the view keys (f, 2, m, g, w, p) work, the
      // keys that change the house below do not (#699).
      const deleteKey = event.key === K.deleteKey || event.key === K.backspace;
      if (exploring && (deleteKey || key === K.rotate || key === K.lock || Object.hasOwn(ARROW_DELTAS, event.key))) return;

      // A held delete key takes one thing. Focus moves on after a removal, so
      // its repeats would otherwise land on whatever comes next: another row,
      // the selection, a wall (#634).
      if (deleteKey && event.repeat) {
        event.preventDefault();
        return;
      }

      // A focused Placed Items row means that row, whatever is selected: the
      // drawer covers the scene, so nothing else shows what went (#634).
      const rowItemId = deleteKey ? focusedRowItemId(event.target) : null;
      if (rowItemId !== null) {
        event.preventDefault();
        handlers.removeRow(rowItemId);
        return;
      }

      if (deleteKey && selectedItem) {
        event.preventDefault();
        // Lock enforcement lives in the handler: it must see the whole
        // selection, not just the primary — gating on the primary's lock here
        // blocked deleting unlocked extras and let locked extras through (#115).
        handlers.removeItem(selectedItem.id);
        return;
      }

      if (deleteKey && selectedWall) {
        event.preventDefault();
        if (selectedWall.kind === 'interior') {
          handlers.removeInteriorWall(selectedWall.id);
        } else {
          handlers.toggleExteriorWall(selectedWall.id);
        }
        return;
      }

      if (key === K.rotate && selectedItem) {
        event.preventDefault();
        if (event.shiftKey) {
          // Fine-grained 15° rotations when Shift is held.
          handlers.rotateItemBy(selectedItem.id, Math.PI / 12);
        } else {
          handlers.rotateItem(selectedItem.id);
        }
        return;
      }

      if (key === K.lock && selectedItem) {
        event.preventDefault();
        // Once per press: a held key would flip it on every repeat.
        if (!event.repeat) handlers.toggleLock(selectedItem.id);
        return;
      }

      if (event.key === K.plan) {
        event.preventDefault();
        handlers.toggle2D();
        return;
      }

      if (key === K.measurements) {
        event.preventDefault();
        handlers.toggleMeasurements();
        return;
      }

      if (key === K.snap) {
        event.preventDefault();
        handlers.toggleSnap();
        return;
      }

      if (key === K.signals && hasSignalItems) {
        event.preventDefault();
        handlers.toggleSignals();
        return;
      }

      if (key === K.panels) {
        event.preventDefault();
        handlers.toggleSidebar();
        return;
      }

      const delta = ARROW_DELTAS[event.key];
      if (delta && selectedItem?.position && selectedItem.locked) {
        event.preventDefault();
        // Once per press: a held key repeats thirty times a second.
        if (!event.repeat) handlers.refuseLocked(selectedItem.id);
        return;
      }
      if (delta && selectedItem?.position) {
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
  }, [selectedItem, selectedWall, hasSignalItems, walkthroughActive, exploring, isDragActive, handlers]);
}

function focusedRowItemId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[data-placed-item-id]')?.dataset.placedItemId ?? null;
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
  return !((event.ctrlKey || event.metaKey) && (key === K.undo || key === K.redo));
}
