// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCatalogItem } from '../lib/__testfixtures__/fixtures';
import { INITIAL_LAYOUT } from './layout-reducer';
import { useHistory } from './use-history';
import { armKeyboardPlacement, nextTileIndex, useKeyboardPlacement } from './use-keyboard-placement';
import { useLayoutState } from './use-layout-state';
import { layoutStore } from './use-layout-store';

const HISTORY_DEBOUNCE_MS = 600;

function activeItems() {
  const { layout, activeFloorIndex } = layoutStore.getState();
  return layout.floors[activeFloorIndex]!.items;
}

// Mirrors the orchestrator: the store-backed layout/actions, the real
// snapshot history, a selection the HUD's onAdd sets right after the
// (wrapped) placement, and the real reducer.
function mount() {
  return renderHook(() => {
    const { layout, actions } = useLayoutState();
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const history = useHistory(layout, actions.applyLayout);
    const placement = useKeyboardPlacement({
      layout,
      selectedItemId,
      actions,
      history,
      selectOnly: setSelectedItemId,
      placeCatalogItem: (catalogItem, position) => actions.addCatalogItem(catalogItem, position),
    });
    const add = (armed: boolean): string => {
      if (armed) armKeyboardPlacement();
      const id = placement.placeCatalogItem(makeCatalogItem());
      if (id) setSelectedItemId(id);
      return id;
    };
    return { ...placement, add, selectedItemId, setSelectedItemId, actions, history, layout };
  });
}

describe('useKeyboardPlacement (#168)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const settleHistory = () => {
    act(() => {
      vi.advanceTimersByTime(HISTORY_DEBOUNCE_MS + 50);
    });
  };

  it('a plain (mouse) add stays locked and starts no session', () => {
    const { result } = mount();
    let id = '';
    act(() => {
      id = result.current.add(false);
    });
    expect(activeItems().find((item) => item.id === id)?.locked).toBe(true);
    expect(result.current.placingId).toBeNull();
  });

  it('an armed add places the item unlocked, selected, and pending', () => {
    const { result } = mount();
    let id = '';
    act(() => {
      id = result.current.add(true);
    });
    expect(activeItems().find((item) => item.id === id)?.locked).toBe(false);
    expect(result.current.selectedItemId).toBe(id);
    expect(result.current.placingId).toBe(id);
  });

  it('the arm flag is one-shot: it never leaks into the next add', async () => {
    const { result } = mount();
    // A tile whose add never reaches the wrapper (declined placement); the
    // browser drains microtasks before the next event can fire.
    armKeyboardPlacement();
    await Promise.resolve();
    let id = '';
    act(() => {
      id = result.current.add(false);
    });
    expect(activeItems().find((item) => item.id === id)?.locked).toBe(true);
    expect(result.current.placingId).toBeNull();
  });

  it('confirm locks the item in place (like drag release) and keeps it selected', () => {
    const { result } = mount();
    let id = '';
    act(() => {
      id = result.current.add(true);
    });
    act(() => {
      result.current.actions.moveItem(id, 1.5, -0.5);
    });
    act(() => {
      result.current.confirmPlacement();
    });
    const item = activeItems().find((entry) => entry.id === id);
    expect(item?.locked).toBe(true);
    expect(item?.position).toEqual({ x: 1.5, z: -0.5 });
    expect(result.current.placingId).toBeNull();
    expect(result.current.selectedItemId).toBe(id);
  });

  it('cancel is one undo: a quick place-nudge-cancel leaves nothing to undo', () => {
    const { result } = mount();
    const before = layoutStore.getState().layout;
    act(() => {
      result.current.add(true);
    });
    act(() => {
      result.current.actions.moveItem(result.current.placingId!, 2, 2);
      result.current.actions.setRotation(result.current.placingId!, Math.PI / 2);
    });
    act(() => {
      result.current.cancelPlacement();
    });
    expect(layoutStore.getState().layout).toStrictEqual(before);
    expect(result.current.placingId).toBeNull();
    expect(result.current.selectedItemId).toBeNull();
    // The whole session was one pending edit, moved onto the redo stack.
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.history.canRedo).toBe(true);
  });

  it('cancel still removes the item when later nudges committed as their own entries', () => {
    const { result } = mount();
    const countBefore = activeItems().length;
    let id = '';
    act(() => {
      id = result.current.add(true);
    });
    settleHistory();
    act(() => {
      result.current.actions.moveItem(id, 2, 2);
    });
    settleHistory();
    // An unrelated edit made mid-session must survive the cancel.
    act(() => {
      result.current.actions.setFloorColor('#123456');
    });
    act(() => {
      result.current.cancelPlacement();
    });
    const { layout, activeFloorIndex } = layoutStore.getState();
    expect(activeItems().length).toBe(countBefore);
    expect(activeItems().some((item) => item.id === id)).toBe(false);
    expect(layout.floors[activeFloorIndex]!.floorColor).toBe('#123456');
    expect(result.current.placingId).toBeNull();
    expect(result.current.selectedItemId).toBeNull();
  });

  it('ends the session when the pending item stops being the selection', () => {
    const { result } = mount();
    act(() => {
      result.current.add(true);
    });
    act(() => {
      result.current.setSelectedItemId(null);
    });
    expect(result.current.placingId).toBeNull();
  });

  it('ends the session when the pending item disappears from the layout', () => {
    const { result } = mount();
    let id = '';
    act(() => {
      id = result.current.add(true);
    });
    act(() => {
      result.current.actions.removeItem(id);
    });
    expect(result.current.placingId).toBeNull();
    // Nothing left to take out: cancel is a no-op rather than a stale restore.
    act(() => {
      result.current.cancelPlacement();
    });
    expect(activeItems().length).toBe(INITIAL_LAYOUT.floors[0]!.items.length);
  });
});

describe('nextTileIndex — roving focus across a tile grid (#168)', () => {
  it('moves along rows and columns and clamps at the edges', () => {
    expect(nextTileIndex('ArrowRight', 0, 8, 4)).toBe(1);
    expect(nextTileIndex('ArrowRight', 7, 8, 4)).toBe(7);
    expect(nextTileIndex('ArrowLeft', 0, 8, 4)).toBe(0);
    expect(nextTileIndex('ArrowDown', 1, 8, 4)).toBe(5);
    expect(nextTileIndex('ArrowDown', 5, 8, 4)).toBe(7);
    expect(nextTileIndex('ArrowUp', 5, 8, 4)).toBe(1);
    expect(nextTileIndex('ArrowUp', 1, 8, 4)).toBe(0);
    expect(nextTileIndex('Home', 6, 8, 4)).toBe(0);
    expect(nextTileIndex('End', 0, 8, 4)).toBe(7);
  });

  it('leaves every other key alone', () => {
    expect(nextTileIndex('Enter', 2, 8, 4)).toBeNull();
    expect(nextTileIndex('r', 2, 8, 4)).toBeNull();
    expect(nextTileIndex('Tab', 2, 8, 4)).toBeNull();
  });
});
