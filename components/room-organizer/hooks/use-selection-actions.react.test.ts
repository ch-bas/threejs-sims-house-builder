// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem } from '../lib/__testfixtures__/fixtures';
import { useSelectionActions, type UseSelectionActionsOptions } from './use-selection-actions';
import type { FloorLayout } from '../lib/types';

const wall = { id: 'w1', x1: 0, z1: 0, x2: 2, z2: 0 };

function setup(floor: FloorLayout, activeFloorIndex = 0) {
  const actions = {
    setGroup: vi.fn((_ids: ReadonlySet<string>) => 'g-new'),
    clearGroup: vi.fn((_ids: ReadonlySet<string>) => {}),
  };
  const playCue = vi.fn();
  const props = (next: FloorLayout, index = activeFloorIndex): UseSelectionActionsOptions => ({
    activeFloor: next,
    activeFloorIndex: index,
    actions,
    playCue,
  });
  const hook = renderHook((p: UseSelectionActionsOptions) => useSelectionActions(p), { initialProps: props(floor) });
  return { ...hook, actions, props };
}

const ids = (set: ReadonlySet<string>) => [...set].sort();

describe('useSelectionActions: the ghost-selection guards (#117, #224)', () => {
  it('a vanished primary promotes the first surviving extra', () => {
    const items = ['a', 'b', 'c'].map((id) => makeItem({ id }));
    const { result, rerender, props } = setup(makeFloor({ items }));
    act(() => result.current.handleSelect('a', 'replace'));
    act(() => result.current.handleSelect('b', 'toggle'));
    act(() => result.current.handleSelect('c', 'toggle'));
    expect(result.current.selectedItemId).toBe('a');
    expect(ids(result.current.extraSelectedIds)).toEqual(['b', 'c']);

    rerender(props(makeFloor({ items: items.slice(1) })));
    expect(result.current.selectedItemId).toBe('b');
    expect(ids(result.current.extraSelectedIds)).toEqual(['c']);
    expect(ids(result.current.allSelectedIds)).toEqual(['b', 'c']);
  });

  it('a vanished extra is dropped and the primary kept', () => {
    const items = ['a', 'b', 'c'].map((id) => makeItem({ id }));
    const { result, rerender, props } = setup(makeFloor({ items }));
    act(() => result.current.handleSelect('a', 'replace'));
    act(() => result.current.handleSelect('b', 'toggle'));
    rerender(props(makeFloor({ items: [items[0]!, items[2]!] })));
    expect(result.current.selectedItemId).toBe('a');
    expect(ids(result.current.extraSelectedIds)).toEqual([]);
  });

  it('a lone primary that vanishes clears the selection', () => {
    const items = [makeItem({ id: 'a' })];
    const { result, rerender, props } = setup(makeFloor({ items }));
    act(() => result.current.selectOnly('a'));
    expect(result.current.selectedItem?.id).toBe('a');
    rerender(props(makeFloor({ items: [] })));
    expect(result.current.selectedItemId).toBeNull();
    expect(result.current.selectedItem).toBeNull();
  });

  it('a selected interior wall that vanishes is let go; an exterior one is kept', () => {
    const { result, rerender, props } = setup(makeFloor({ interiorWalls: [wall] }));
    act(() => result.current.handleInteriorWallSelect('w1', 'b'));
    expect(result.current.selectedWall).toEqual({ id: 'w1', kind: 'interior', side: 'b' });
    rerender(props(makeFloor({ interiorWalls: [] })));
    expect(result.current.selectedWall).toBeNull();

    act(() => result.current.setSelectedWall({ id: 'front', kind: 'exterior' }));
    rerender(props(makeFloor({ interiorWalls: [] })));
    expect(result.current.selectedWall).toEqual({ id: 'front', kind: 'exterior' });
  });

  it('a floor switch drops the selection, also when only the floor id changes', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
    const floor = makeFloor({ items, interiorWalls: [wall] });
    const { result, rerender, props } = setup(floor);
    act(() => result.current.handleSelect('a', 'replace'));
    act(() => result.current.handleSelect('b', 'toggle'));
    act(() => result.current.handleInteriorWallSelect('w1'));
    // Floor 0 removed: a different floor is active at the same index.
    rerender(props({ ...floor, id: 'upper' }));
    expect(result.current.selectedItemId).toBeNull();
    expect(result.current.extraSelectedIds.size).toBe(0);
    expect(result.current.selectedWall).toBeNull();
  });
});

describe('useSelectionActions: clicks and groups (#154)', () => {
  const grouped = [
    makeItem({ id: 'a', groupId: 'g1' }),
    makeItem({ id: 'b', groupId: 'g1' }),
    makeItem({ id: 'c' }),
  ];

  it('replace selects the whole group with the clicked member as primary', () => {
    const { result } = setup(makeFloor({ items: grouped }));
    act(() => result.current.handleSelect('b', 'replace'));
    expect(result.current.selectedItemId).toBe('b');
    expect(ids(result.current.extraSelectedIds)).toEqual(['a']);
    expect(result.current.selectionIsGroup).toBe(true);
    expect(result.current.selectionHasGroups).toBe(true);
  });

  it('single picks one member on its own', () => {
    const { result } = setup(makeFloor({ items: grouped }));
    act(() => result.current.handleSelect('b', 'single'));
    expect(ids(result.current.allSelectedIds)).toEqual(['b']);
  });

  it('toggle adds and removes the whole group, promoting a survivor', () => {
    const { result } = setup(makeFloor({ items: grouped }));
    act(() => result.current.handleSelect('c', 'replace'));
    act(() => result.current.handleSelect('a', 'toggle'));
    expect(ids(result.current.allSelectedIds)).toEqual(['a', 'b', 'c']);
    act(() => result.current.handleSelect('c', 'toggle'));
    expect(ids(result.current.allSelectedIds)).toEqual(['a', 'b']);
    expect(['a', 'b']).toContain(result.current.selectedItemId);
    act(() => result.current.handleSelect('b', 'toggle'));
    expect(result.current.selectedItemId).toBeNull();
    expect(result.current.extraSelectedIds.size).toBe(0);
  });

  it('selectOnly and the keyboard pick leave no stale extras or wall', () => {
    const { result } = setup(makeFloor({ items: grouped, interiorWalls: [wall] }));
    act(() => result.current.handleSelect('a', 'replace'));
    act(() => result.current.selectOnly('c'));
    expect(ids(result.current.allSelectedIds)).toEqual(['c']);
    act(() => result.current.handleInteriorWallSelect('w1'));
    act(() => result.current.selectFromKeyboard('c'));
    expect(result.current.selectedWall).toBeNull();
    act(() => result.current.deselectAll());
    expect(result.current.allSelectedIds.size).toBe(0);
  });

  it('group and ungroup act on the whole selection; one item is no group', () => {
    const { result, actions } = setup(makeFloor({ items: grouped }));
    act(() => result.current.selectOnly('c'));
    act(() => result.current.groupSelection());
    expect(actions.setGroup).not.toHaveBeenCalled();
    act(() => result.current.handleSelect('a', 'toggle'));
    act(() => result.current.groupSelection());
    expect(ids(actions.setGroup.mock.calls[0]![0])).toEqual(['a', 'b', 'c']);
    act(() => result.current.ungroupSelection());
    expect(ids(actions.clearGroup.mock.calls[0]![0])).toEqual(['a', 'b', 'c']);
  });

  it('a set needs two items and a name', () => {
    const { result } = setup(makeFloor({ items: grouped }));
    act(() => result.current.selectOnly('c'));
    expect(result.current.saveSelectionAsSet('Corner')).toBe(false);
    act(() => result.current.handleSelect('a', 'toggle'));
    expect(result.current.saveSelectionAsSet('   ')).toBe(false);
  });
});
