// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { useKeyboardShortcuts, type KeyboardShortcutHandlers } from './use-keyboard-shortcuts';

function makeHandlers(): { [K in keyof KeyboardShortcutHandlers]: ReturnType<typeof vi.fn> } {
  return {
    removeItem: vi.fn(),
    removeRow: vi.fn(),
    removeInteriorWall: vi.fn(),
    toggleExteriorWall: vi.fn(),
    duplicateItem: vi.fn(),
    copySelection: vi.fn(() => true),
    pasteClipboard: vi.fn(() => true),
    rotateItem: vi.fn(),
    rotateItemBy: vi.fn(),
    moveItem: vi.fn(),
    toggleLock: vi.fn(),
    refuseLocked: vi.fn(),
    toggle2D: vi.fn(),
    toggleMeasurements: vi.fn(),
    toggleSnap: vi.fn(),
    toggleSignals: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    deselect: vi.fn(),
    focusOnSelection: vi.fn(),
    advanceTime: vi.fn(),
    changeFloor: vi.fn(),
    toggleSidebar: vi.fn(),
  };
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init });
  window.dispatchEvent(event);
  return event;
}

const setup = (
  dragging: boolean,
  placing = false,
  {
    walkthroughActive = false,
    exploring = false,
    hasSignalItems = false,
    selectedWall = null,
  }: {
    walkthroughActive?: boolean;
    exploring?: boolean;
    hasSignalItems?: boolean;
    selectedWall?: { id: string; kind: 'exterior' | 'interior' } | null;
  } = {}
) => {
  const handlers = {
    ...makeHandlers(),
    ...(placing ? { confirmPlacement: vi.fn(), cancelPlacement: vi.fn() } : {}),
  };
  renderHook(() =>
    useKeyboardShortcuts({
      selectedItem: makeItem({ id: 'chair', position: { x: 0, z: 0 }, locked: false }),
      selectedWall,
      hasSignalItems,
      walkthroughActive,
      exploring,
      isDragActive: () => dragging,
      handlers: handlers as unknown as KeyboardShortcutHandlers,
    })
  );
  const calls = () =>
    Object.entries(handlers)
      .filter(([, fn]) => fn.mock.calls.length > 0)
      .map(([name]) => name);
  return { handlers, calls };
};

describe('useKeyboardShortcuts — mid-drag gate (#207)', () => {
  afterEach(cleanup);

  it.each([
    ['Ctrl+Z (undo)', 'z', { ctrlKey: true }],
    ['Ctrl+Shift+Z (redo)', 'Z', { ctrlKey: true, shiftKey: true }],
    ['Cmd+Z (undo)', 'z', { metaKey: true }],
    ['Ctrl+Y (redo)', 'y', { ctrlKey: true }],
    ['Ctrl+D (duplicate)', 'd', { ctrlKey: true }],
    ['Ctrl+V (paste)', 'v', { ctrlKey: true }],
    ['Delete', 'Delete', {}],
    ['Backspace', 'Backspace', {}],
    ['R (rotate)', 'r', {}],
    ['Shift+R (fine rotate)', 'R', { shiftKey: true }],
    ['2 (2D view)', '2', {}],
    ['PageUp (floor)', 'PageUp', {}],
    ['PageDown (floor)', 'PageDown', {}],
    ['ArrowUp (nudge)', 'ArrowUp', {}],
    ['Shift+ArrowLeft (nudge)', 'ArrowLeft', { shiftKey: true }],
  ] as const)('holds %s until the drop', (_label, key, init) => {
    const { calls } = setup(true);
    const event = press(key, init);
    expect(calls()).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ['g (snap)', 'g', {}, 'toggleSnap'],
    ['m (measurements)', 'm', {}, 'toggleMeasurements'],
    [']' + ' (time)', ']', {}, 'advanceTime'],
    ['Ctrl+C (copy)', 'c', { ctrlKey: true }, 'copySelection'],
  ] as const)('still handles view-only %s mid-drag', (_label, key, init, handler) => {
    const { calls } = setup(true);
    press(key, init);
    expect(calls()).toEqual([handler]);
  });

  it('never swallows browser chords like Ctrl+R mid-drag', () => {
    const { calls } = setup(true);
    const event = press('r', { ctrlKey: true });
    expect(calls()).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    ['z', { ctrlKey: true }, 'undo'],
    ['Delete', {}, 'removeItem'],
    ['r', {}, 'rotateItem'],
    ['ArrowUp', {}, 'moveItem'],
    ['PageUp', {}, 'changeFloor'],
  ] as const)('handles %s normally when no drag is active', (key, init, handler) => {
    const { calls } = setup(false);
    press(key, init);
    expect(calls()).toEqual([handler]);
  });
});

describe('useKeyboardShortcuts — pending keyboard placement (#168)', () => {
  afterEach(cleanup);

  it('Enter confirms the placement', () => {
    const { calls } = setup(false, true);
    const event = press('Enter');
    expect(calls()).toEqual(['confirmPlacement']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Escape cancels the placement instead of deselecting', () => {
    const { calls } = setup(false, true);
    press('Escape');
    expect(calls()).toEqual(['cancelPlacement']);
  });

  it('arrows and R still nudge and rotate the pending item', () => {
    const { calls } = setup(false, true);
    press('ArrowRight');
    press('r');
    expect(calls()).toEqual(['rotateItem', 'moveItem']);
  });

  it('without a placement, Escape deselects and Enter is left alone', () => {
    const { calls } = setup(false);
    const enter = press('Enter');
    expect(enter.defaultPrevented).toBe(false);
    press('Escape');
    expect(calls()).toEqual(['deselect']);
  });
});

describe('useKeyboardShortcuts — letter shortcuts ignore case (#294)', () => {
  afterEach(cleanup);

  it.each([
    ['F', 'focusOnSelection'],
    ['M', 'toggleMeasurements'],
    ['G', 'toggleSnap'],
    ['W', 'toggleSignals'],
    ['P', 'toggleSidebar'],
    ['R', 'rotateItem'],
  ] as const)('Caps Lock %s still fires %s', (key, handler) => {
    const { calls } = setup(false, false, { hasSignalItems: true });
    const event = press(key);
    expect(calls()).toEqual([handler]);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ['D', 'duplicateItem'],
    ['C', 'copySelection'],
    ['V', 'pasteClipboard'],
    ['Z', 'undo'],
    ['Y', 'redo'],
  ] as const)('Caps Lock Ctrl+%s still fires %s', (key, handler) => {
    const { calls } = setup(false);
    press(key, { ctrlKey: true });
    expect(calls()).toEqual([handler]);
  });
});

describe('useKeyboardShortcuts — walkthrough gate (#339)', () => {
  afterEach(cleanup);

  it.each([
    ['Ctrl+D (duplicate)', 'd'],
    ['Ctrl+C (copy)', 'c'],
    ['Ctrl+V (paste)', 'v'],
  ] as const)('ignores %s while the walkthrough owns the keyboard', (_label, key) => {
    const { calls } = setup(false, false, { walkthroughActive: true });
    press(key, { ctrlKey: true });
    expect(calls()).toEqual([]);
  });

  it('keeps undo and redo available in the walkthrough', () => {
    const { calls } = setup(false, false, { walkthroughActive: true });
    press('z', { ctrlKey: true });
    press('y', { ctrlKey: true });
    expect(calls()).toEqual(['undo', 'redo']);
  });

  it('changes the time of day with [ and ] while walking (#463c)', () => {
    const { handlers } = setup(false, false, { walkthroughActive: true });
    expect(press(']').defaultPrevented).toBe(true);
    press('[');
    expect(handlers.advanceTime.mock.calls).toEqual([[1], [-1]]);
  });

  it('changes floor with PageUp and PageDown while walking (#446)', () => {
    const { handlers } = setup(false, false, { walkthroughActive: true });
    press('PageUp');
    press('PageDown');
    expect(handlers.changeFloor.mock.calls).toEqual([[1], [-1]]);
  });

  it.each([
    ['w (WiFi)', 'w'],
    ['2 (2D view)', '2'],
    ['m (measurements)', 'm'],
    ['r (rotate)', 'r'],
    ['Delete', 'Delete'],
    ['ArrowUp (nudge)', 'ArrowUp'],
  ] as const)('still ignores %s while walking', (_label, key) => {
    const { calls } = setup(false, false, { walkthroughActive: true, hasSignalItems: true });
    press(key);
    expect(calls()).toEqual([]);
  });
});

describe('useKeyboardShortcuts — EXPLORE never edits, in 2D too (#699)', () => {
  afterEach(cleanup);

  it.each([
    ['Ctrl+D (duplicate)', 'd', { ctrlKey: true }],
    ['Ctrl+C (copy)', 'c', { ctrlKey: true }],
    ['Ctrl+V (paste)', 'v', { ctrlKey: true }],
    ['Cmd+V (paste)', 'v', { metaKey: true }],
    ['Delete', 'Delete', {}],
    ['Backspace', 'Backspace', {}],
    ['R (rotate)', 'r', {}],
    ['Shift+R (fine rotate)', 'R', { shiftKey: true }],
    ['ArrowUp (nudge)', 'ArrowUp', {}],
    ['ArrowDown (nudge)', 'ArrowDown', {}],
    ['ArrowLeft (nudge)', 'ArrowLeft', {}],
    ['Shift+ArrowRight (big nudge)', 'ArrowRight', { shiftKey: true }],
  ] as const)('ignores %s on the 2D plan while exploring', (_label, key, init) => {
    const { calls } = setup(false, false, { exploring: true });
    const event = press(key, init);
    expect(calls()).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(['interior', 'exterior'] as const)('ignores Delete on a selected %s wall while exploring', (kind) => {
    const { calls } = setup(false, false, { exploring: true, selectedWall: { id: 'w', kind } });
    press('Delete');
    press('Backspace');
    expect(calls()).toEqual([]);
  });

  it('keeps undo and redo while exploring (#339)', () => {
    const { calls } = setup(false, false, { exploring: true });
    press('z', { ctrlKey: true });
    press('y', { ctrlKey: true });
    expect(calls()).toEqual(['undo', 'redo']);
  });

  it.each([
    ['f (focus)', 'f', 'focusOnSelection'],
    ['2 (2D view)', '2', 'toggle2D'],
    ['m (measurements)', 'm', 'toggleMeasurements'],
    ['g (snap)', 'g', 'toggleSnap'],
    ['w (WiFi)', 'w', 'toggleSignals'],
    ['p (panel)', 'p', 'toggleSidebar'],
    ['] (time)', ']', 'advanceTime'],
    ['PageUp (floor)', 'PageUp', 'changeFloor'],
    ['Escape (deselect)', 'Escape', 'deselect'],
  ] as const)('keeps the view key %s while exploring', (_label, key, handler) => {
    const { calls } = setup(false, false, { exploring: true, hasSignalItems: true });
    press(key);
    expect(calls()).toEqual([handler]);
  });

  it('edits again outside EXPLORE', () => {
    const { calls } = setup(false, false, { exploring: false });
    press('d', { ctrlKey: true });
    press('r');
    press('ArrowUp');
    press('Delete');
    expect(calls()).toEqual(['removeItem', 'duplicateItem', 'rotateItem', 'moveItem']);
  });
});

describe('useKeyboardShortcuts — focused form controls (#415)', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  function pressOn(el: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init }));
  }

  function focused(tag: 'select' | 'input'): HTMLElement {
    const el = document.createElement(tag);
    document.body.appendChild(el);
    el.focus();
    return el;
  }

  it('a select left focused after a pick still passes undo and redo through', () => {
    const { calls } = setup(false);
    const select = focused('select');
    pressOn(select, 'z', { ctrlKey: true });
    pressOn(select, 'Z', { metaKey: true, shiftKey: true });
    pressOn(select, 'y', { ctrlKey: true });
    expect(calls()).toEqual(['undo', 'redo']);
  });

  it.each([
    ['ArrowDown', {}],
    ['ArrowLeft', {}],
    ['r', {}],
    ['2', {}],
    ['Delete', {}],
    ['d', { ctrlKey: true }],
  ] as const)('a focused select keeps %s for itself', (key, init) => {
    const { calls } = setup(false);
    pressOn(focused('select'), key, init);
    expect(calls()).toEqual([]);
  });

  it('a text input keeps Ctrl+Z for its own text undo', () => {
    const { calls } = setup(false);
    pressOn(focused('input'), 'z', { ctrlKey: true });
    expect(calls()).toEqual([]);
  });
});

describe('useKeyboardShortcuts — Delete on a Placed Items row (#634)', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  const rowButton = (id: string): HTMLElement => {
    const row = document.createElement('div');
    row.dataset.placedItemId = id;
    const button = document.createElement('button');
    row.appendChild(button);
    document.body.appendChild(row);
    button.focus();
    return button;
  };
  const press = (el: HTMLElement, key: string) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true }));
  };

  it.each(['Delete', 'Backspace'])('%s removes the focused row, not the selection', (key) => {
    const { handlers } = setup(false);
    press(rowButton('sofa'), key);
    expect(handlers.removeRow).toHaveBeenCalledTimes(1);
    expect(handlers.removeRow).toHaveBeenCalledWith('sofa');
    // Never the selection-wide path.
    expect(handlers.removeItem).not.toHaveBeenCalled();
  });

  it('a held Delete takes one row, and its repeats touch nothing else', () => {
    const { handlers } = setup(false);
    const row = rowButton('sofa');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', cancelable: true, bubbles: true }));
    const repeat = new KeyboardEvent('keydown', { key: 'Delete', repeat: true, cancelable: true, bubbles: true });
    rowButton('tv').dispatchEvent(repeat);
    expect(handlers.removeRow).toHaveBeenCalledTimes(1);
    expect(handlers.removeItem).not.toHaveBeenCalled();
    expect(repeat.defaultPrevented).toBe(true);
  });

  it('a held Delete that runs out of rows leaves the selection alone', () => {
    const { handlers } = setup(false);
    const repeat = new KeyboardEvent('keydown', { key: 'Delete', repeat: true, cancelable: true, bubbles: true });
    document.body.dispatchEvent(repeat);
    expect(handlers.removeItem).not.toHaveBeenCalled();
    expect(repeat.defaultPrevented).toBe(true);
    // A fresh press still acts on the selection.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', cancelable: true, bubbles: true }));
    expect(handlers.removeItem).toHaveBeenCalledTimes(1);
  });

  it('another key on a row still acts on the selection', () => {
    const { handlers } = setup(false);
    press(rowButton('sofa'), 'r');
    expect(handlers.rotateItem).toHaveBeenCalledWith('chair');
  });

  it('is off in EXPLORE, like any other removal', () => {
    const { handlers } = setup(false, false, { exploring: true });
    press(rowButton('sofa'), 'Delete');
    expect(handlers.removeRow).not.toHaveBeenCalled();
    expect(handlers.removeItem).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts — locked items (#635)', () => {
  afterEach(cleanup);

  const renderWith = (locked: boolean, options: { exploring?: boolean; dragging?: boolean } = {}) => {
    const handlers = makeHandlers();
    const selectedItem = makeItem({ id: 'a', locked, position: { x: 1, z: 1 } });
    renderHook(() =>
      useKeyboardShortcuts({
        selectedItem,
        selectedWall: null,
        hasSignalItems: false,
        exploring: options.exploring ?? false,
        isDragActive: () => options.dragging ?? false,
        handlers: handlers as unknown as KeyboardShortcutHandlers,
      })
    );
    return handlers;
  };

  it('says why an arrow nudge did nothing, once per press', () => {
    const handlers = renderWith(true);
    const first = press('ArrowLeft');
    press('ArrowLeft', { repeat: true });
    expect(first.defaultPrevented).toBe(true);
    expect(handlers.refuseLocked).toHaveBeenCalledTimes(1);
    expect(handlers.refuseLocked).toHaveBeenCalledWith('a');
    expect(handlers.moveItem).not.toHaveBeenCalled();
  });

  it('nudges an unlocked item with no refusal', () => {
    const handlers = renderWith(false);
    press('ArrowLeft');
    expect(handlers.moveItem).toHaveBeenCalledTimes(1);
    expect(handlers.refuseLocked).not.toHaveBeenCalled();
  });

  it('U toggles the lock, in either case', () => {
    const handlers = renderWith(true);
    press('u');
    press('U');
    expect(handlers.toggleLock).toHaveBeenCalledTimes(2);
  });

  it('U does nothing in EXPLORE or mid-drag', () => {
    const exploring = renderWith(true, { exploring: true });
    press('u');
    press('ArrowLeft');
    expect(exploring.toggleLock).not.toHaveBeenCalled();
    expect(exploring.refuseLocked).not.toHaveBeenCalled();
    cleanup();
    const dragging = renderWith(false, { dragging: true });
    press('u');
    expect(dragging.toggleLock).not.toHaveBeenCalled();
  });
});
