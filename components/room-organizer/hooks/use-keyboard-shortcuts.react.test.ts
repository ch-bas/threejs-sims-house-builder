// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { useKeyboardShortcuts, type KeyboardShortcutHandlers } from './use-keyboard-shortcuts';

function makeHandlers(): { [K in keyof KeyboardShortcutHandlers]: ReturnType<typeof vi.fn> } {
  return {
    removeItem: vi.fn(),
    removeInteriorWall: vi.fn(),
    toggleExteriorWall: vi.fn(),
    duplicateItem: vi.fn(),
    copySelection: vi.fn(() => true),
    pasteClipboard: vi.fn(() => true),
    rotateItem: vi.fn(),
    rotateItemBy: vi.fn(),
    moveItem: vi.fn(),
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

const setup = (dragging: boolean, placing = false) => {
  const handlers = {
    ...makeHandlers(),
    ...(placing ? { confirmPlacement: vi.fn(), cancelPlacement: vi.fn() } : {}),
  };
  renderHook(() =>
    useKeyboardShortcuts({
      selectedItem: makeItem({ id: 'chair', position: { x: 0, z: 0 }, locked: false }),
      selectedWall: null,
      hasSignalItems: false,
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
