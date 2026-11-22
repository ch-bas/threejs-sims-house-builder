// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { INITIAL_LAYOUT } from './layout-reducer';
import { useItemCommands, type UseItemCommandsOptions } from './use-item-commands';
import { layoutStore } from './use-layout-store';
import type { LayoutActions } from './use-layout-state';

describe('the placement cue for a garden surface (#924)', () => {
  afterEach(() => layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 }));

  it('chimes for a laid surface and plays the refusal for one the reducer turned down', () => {
    const floor = makeFloor();
    const options: UseItemCommandsOptions = {
      layout: makeLayout({ floors: [floor] }),
      activeFloor: floor,
      activeFloorIndex: 0,
      frontGap: null,
      actions: {} as unknown as LayoutActions,
      commitHistoryNow: vi.fn(),
      undoHistory: vi.fn(),
      playCue: vi.fn(),
      exploring: false,
      selection: { allSelectedIds: new Set(), selectOnly: vi.fn(), setSelectedItemId: vi.fn(), setExtraSelectedIds: vi.fn(), setSelectedWall: vi.fn() },
    };
    const { result } = renderHook(() => useItemCommands(options));
    layoutStore.setState({ layout: makeLayout({ grounds: [{ id: 'g1', kind: 'deck', x: 5, z: 0, w: 2, d: 2 }] }), activeFloorIndex: 0 });
    expect(result.current.chimePlacement('g1')).toBe('g1');
    expect(options.playCue).toHaveBeenLastCalledWith('place');
    expect(result.current.chimePlacement('g2')).toBe('');
    expect(options.playCue).toHaveBeenLastCalledWith('refused');
  });
});
