// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import * as npcPath from '../lib/npc-path';
import { type LayoutAction, type LayoutState, layoutReducer } from './layout-reducer';
import { useFloorKeepOut } from './use-floor-keep-out';
import { useNpcs } from './use-npcs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/npc-path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/npc-path')>();
  return { ...actual, buildNpcNav: vi.fn(actual.buildNpcNav) };
});

describe('walker nav rebuilds (#452 review)', () => {
  it('rebuilds only when what the walkers walk around changes', () => {
    const builds = vi.mocked(npcPath.buildNpcNav);
    let state: LayoutState = {
      layout: makeLayout({
        floors: [makeFloor({ id: 'f0', items: [makeItem({ id: 'a', position: { x: 1, z: 1 } })] }), makeFloor({ id: 'f1' })],
      }),
      activeFloorIndex: 0,
    };
    const threeModuleRef = { current: null };
    const sceneRef = { current: null };
    const { rerender } = renderHook(
      ({ s }: { s: LayoutState }) => {
        const keepOut = useFloorKeepOut(s.layout, s.activeFloorIndex);
        const floor = s.layout.floors[s.activeFloorIndex]!;
        useNpcs({
          enabled: true, threeModuleRef, sceneRef, roomWidth: s.layout.width, roomDepth: s.layout.height,
          items: floor.items, interiorWalls: floor.interiorWalls, keepOut, floorY: 0,
        });
      },
      { initialProps: { s: state } }
    );
    const rebuildsAfter = (action: LayoutAction): number => {
      const before = builds.mock.calls.length;
      state = layoutReducer(state, action);
      rerender({ s: state });
      return builds.mock.calls.length - before;
    };

    expect(builds).toHaveBeenCalledTimes(1);
    expect(rebuildsAfter({ type: 'setName', name: 'X' })).toBe(0);
    expect(rebuildsAfter({ type: 'setFloorColor', color: '#123456' })).toBe(0);
    expect(rebuildsAfter({ type: 'setColor', id: 'a', color: '#00ff00' })).toBe(0);
    expect(rebuildsAfter({ type: 'setLocked', id: 'a', locked: true })).toBe(0);
    expect(rebuildsAfter({ type: 'setFloorPlanOpacity', opacity: 0.3 })).toBe(0);
    expect(rebuildsAfter({ type: 'setLocked', id: 'a', locked: false })).toBe(0);
    // Moving the item does change the walkers' floor.
    expect(rebuildsAfter({ type: 'moveItem', id: 'a', x: -1, z: -1 })).toBe(1);
  });
});
