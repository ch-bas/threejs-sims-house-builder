// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem } from '../lib/__testfixtures__/fixtures';
import { useItemDrag } from './use-item-drag';
import type { LayoutActions } from './use-layout-state';

describe('useItemDrag — cancelled gestures commit nothing (#207 follow-up)', () => {
  afterEach(cleanup);

  const setup = () => {
    const actions = {
      moveItem: vi.fn(),
      bulkSetPositions: vi.fn(),
      setLocked: vi.fn(),
      updateItem: vi.fn(),
    } as unknown as LayoutActions;
    const floor = makeFloor({
      items: [makeItem({ id: 'a', position: { x: 0, z: 0 } })],
    });
    const { result } = renderHook(() =>
      useItemDrag({
        activeFloor: floor,
        activeFloorIndex: 0,
        roomWidth: 10,
        roomDepth: 10,
        actions,
        allSelectedIds: new Set(['a']),
      })
    );
    return { actions, result };
  };

  it('a completed drag commits once and reports active in between', () => {
    const { actions, result } = setup();
    expect(result.current.isDragActive()).toBe(false);
    result.current.handleDragStart('a');
    expect(result.current.isDragActive()).toBe(true);
    result.current.handleDrag('a', 2, 3);
    result.current.handleDragEnd('a');
    expect(result.current.isDragActive()).toBe(false);
    expect(actions.bulkSetPositions).toHaveBeenCalledTimes(1);
    expect(actions.setLocked).toHaveBeenCalledWith('a', true);
  });

  it('a cancelled drag discards the session — the release commits and locks nothing', () => {
    const { actions, result } = setup();
    result.current.handleDragStart('a');
    result.current.handleDrag('a', 2, 3);
    // The canvas handler aborted: its captured group was rebuilt away
    // (cross-tab adopt, library load) mid-gesture.
    result.current.handleDragCancel('a');
    expect(result.current.isDragActive()).toBe(false);
    // A stray pointerup after the abort must be a complete no-op.
    result.current.handleDragEnd('a');
    expect(actions.bulkSetPositions).not.toHaveBeenCalled();
    expect(actions.setLocked).not.toHaveBeenCalled();
    expect(actions.updateItem).not.toHaveBeenCalled();
  });
});
