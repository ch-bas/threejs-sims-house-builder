import { useEffect } from 'react';
import type { FurnitureItem } from '../lib/types';

export interface KeyboardShortcutHandlers {
  removeItem(id: string): void;
  duplicateItem(id: string): void;
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
}

export interface UseKeyboardShortcutsOptions {
  selectedItem: FurnitureItem | null;
  hasSignalItems: boolean;
  handlers: KeyboardShortcutHandlers;
}

const ARROW_DELTAS: Record<string, readonly [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export function useKeyboardShortcuts({
  selectedItem,
  hasSignalItems,
  handlers,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

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

      if (event.key === 'Escape') {
        event.preventDefault();
        handlers.deselect();
        return;
      }

      if (event.key === 'f' && selectedItem) {
        event.preventDefault();
        handlers.focusOnSelection();
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedItem) {
        event.preventDefault();
        handlers.removeItem(selectedItem.id);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'd' && selectedItem) {
        event.preventDefault();
        handlers.duplicateItem(selectedItem.id);
        return;
      }

      if (event.key === 'r' && selectedItem) {
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

      if (event.key === 'p' && !ctrlOrCmd) {
        event.preventDefault();
        handlers.toggleSidebar();
        return;
      }

      const delta = ARROW_DELTAS[event.key];
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
  }, [selectedItem, hasSignalItems, handlers]);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
