// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeCatalogItem } from '../lib/__testfixtures__/fixtures';
import { INITIAL_LAYOUT } from './layout-reducer';
import { layoutStore, useActiveFloor, useLayoutStore } from './use-layout-store';

// React-facing tests for the Zustand store hooks. The wiring smoke tests in
// use-layout-store.test.ts only exercise `getState().actions`; these cover the
// hook layer itself: Zustand v5 requires selectors to return referentially
// stable snapshots (or useSyncExternalStore loops), and atomic selectors must
// re-render subscribers only when their own slice changes.

// React's act() warns unless the environment opts in.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function reset(): void {
  layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 });
}

describe('use-layout-store — React hook layer', () => {
  beforeEach(reset);

  it('useActiveFloor returns a referentially stable floor across an unrelated dispatch', () => {
    const { result } = renderHook(() => useActiveFloor());
    const before = result.current;

    act(() => {
      layoutStore.getState().actions.setName('Renamed Villa');
    });

    // setName replaces layout but not the floors array, so the active floor
    // snapshot must keep its identity — Zustand v5 loops otherwise.
    expect(result.current).toBe(before);
  });

  it('a layout.name subscriber re-renders on setName but not on moveItem', () => {
    const itemId = layoutStore.getState().actions.addCatalogItem(makeCatalogItem(), { x: 0, z: 0 });

    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useLayoutStore((s) => s.layout.name);
    });
    const rendersAfterMount = renders;

    act(() => {
      layoutStore.getState().actions.setName('Atomic House');
    });
    expect(result.current).toBe('Atomic House');
    expect(renders).toBe(rendersAfterMount + 1);

    act(() => {
      layoutStore.getState().actions.moveItem(itemId, 3, 4);
    });
    // The move really happened…
    const moved = layoutStore.getState().layout.floors[0]!.items.find((i) => i.id === itemId);
    expect(moved?.position).toEqual({ x: 3, z: 4 });
    // …but the name subscriber did not re-render for it.
    expect(renders).toBe(rendersAfterMount + 1);
  });
});
