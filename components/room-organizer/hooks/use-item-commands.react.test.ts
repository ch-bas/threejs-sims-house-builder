// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { ENTRANCE_WALL_ID } from '../lib/street';
import { useItemCommands, type UseItemCommandsOptions } from './use-item-commands';
import type { LayoutActions } from './use-layout-state';
import type { FloorLayout } from '../lib/types';

function setup(floor: FloorLayout, selected: readonly string[]) {
  const actions = {
    sellItems: vi.fn(),
    setLocked: vi.fn(),
    setRotation: vi.fn(),
    rotateSelection: vi.fn(),
    removeInteriorWall: vi.fn(),
  } as unknown as LayoutActions;
  const selection = {
    allSelectedIds: new Set(selected),
    selectOnly: vi.fn(),
    setSelectedItemId: vi.fn(),
    setExtraSelectedIds: vi.fn(),
    setSelectedWall: vi.fn(),
  };
  const options: UseItemCommandsOptions = {
    layout: makeLayout({ floors: [floor] }),
    activeFloor: floor,
    activeFloorIndex: 0,
    frontGap: null,
    actions,
    commitHistoryNow: vi.fn(),
    undoHistory: vi.fn(),
    playCue: vi.fn(),
    exploring: false,
    selection,
  };
  const { result } = renderHook(() => useItemCommands(options));
  return { result, actions, selection, options };
}

describe('useItemCommands', () => {
  const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })];

  it('Delete on a member of a multi-select sells the whole selection as one step', () => {
    const { result, actions, selection, options } = setup(makeFloor({ items }), ['a', 'b']);
    act(() => result.current.removeItemOrSelection('a'));
    expect(options.commitHistoryNow).toHaveBeenCalledTimes(1);
    expect(actions.sellItems).toHaveBeenCalledWith(['a', 'b']);
    expect(options.playCue).toHaveBeenCalledWith('remove');
    expect(selection.setSelectedItemId).toHaveBeenCalledWith(null);
  });

  it('Delete on a lone item sells only that item', () => {
    const { result, actions } = setup(makeFloor({ items }), ['c']);
    act(() => result.current.removeItemOrSelection('c'));
    expect(actions.sellItems).toHaveBeenCalledWith(['c']);
  });

  it('Lock follows the primary item across the selection', () => {
    const { result, actions } = setup(makeFloor({ items }), ['a', 'b']);
    act(() => result.current.toggleLock('a'));
    expect(vi.mocked(actions.setLocked).mock.calls).toEqual([
      ['a', true],
      ['b', true],
    ]);
  });

  it("the porch's back wall is refused, with the refused cue", () => {
    const { result, actions, selection, options } = setup(makeFloor({ items }), []);
    act(() => result.current.removeInteriorWall(ENTRANCE_WALL_ID));
    expect(actions.removeInteriorWall).not.toHaveBeenCalled();
    expect(options.playCue).toHaveBeenCalledWith('refused');
    act(() => result.current.removeInteriorWall('w1'));
    expect(actions.removeInteriorWall).toHaveBeenCalledWith('w1');
    expect(selection.setSelectedWall).toHaveBeenCalledWith(null);
  });

  it('a twist is offered only outside EXPLORE', () => {
    const { result } = setup(makeFloor({ items }), ['a']);
    expect(result.current.canTwistItem('a')).toBe(true);
    const explore = renderHook(() => useItemCommands({ ...setup(makeFloor({ items }), ['a']).options, exploring: true }));
    expect(explore.result.current.canTwistItem('a')).toBe(false);
  });
});
