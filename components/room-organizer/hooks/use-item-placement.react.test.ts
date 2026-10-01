// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeCatalogItem, makeFloor, makeItem } from '../lib/__testfixtures__/fixtures';
import { snapOpeningToWall, snapWallMountedItem } from '../lib/opening-snap';
import { INITIAL_LAYOUT } from './layout-reducer';
import { useItemPlacement } from './use-item-placement';
import { layoutStore } from './use-layout-store';

function activeItem(id: string) {
  const { layout, activeFloorIndex } = layoutStore.getState();
  return layout.floors[activeFloorIndex]!.items.find((item) => item.id === id)!;
}

describe('useItemPlacement — wall-aligned catalog placement', () => {
  beforeEach(() => {
    layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 });
  });
  afterEach(cleanup);

  const mount = () => {
    const { layout, activeFloorIndex, actions } = layoutStore.getState();
    return renderHook(() =>
      useItemPlacement({
        activeFloor: layout.floors[activeFloorIndex]!,
        activeFloorY: 0,
        roomWidth: layout.width,
        roomDepth: layout.height,
        buildingCost: 0,
        actions,
        view: { snapToGrid: false, snapToWall: false, snapToItems: false },
      })
    );
  };

  // Catalog items are born locked (#11); the wall-aligned rotation must still
  // land even though the reducer refuses setRotation on locked items (#209).
  it('rotates a door placed on a side wall to face along that wall', () => {
    const { result } = mount();
    const { width, height } = layoutStore.getState().layout;
    const door = makeCatalogItem({ type: 'door', width: 0.9, depth: 0.12, height: 2.1 });
    const drop = { x: width / 2, z: 0 };
    const expected = snapOpeningToWall({
      position: drop,
      itemWidth: door.width,
      roomWidth: width,
      roomDepth: height,
      interiorWalls: [],
    });
    expect(expected.rotation).not.toBe(0);

    const id = result.current.placeCatalogItem(door, drop);

    expect(activeItem(id).locked).toBe(true);
    expect(activeItem(id).rotation).toBeCloseTo(expected.rotation, 10);
  });

  it('keeps a placed camera’s rotation and recorded wall yaw in sync', () => {
    const { result } = mount();
    const { width, height } = layoutStore.getState().layout;
    const camera = makeCatalogItem({ type: 'security-camera', width: 0.3, depth: 0.2, height: 0.25 });
    const drop = { x: width / 2, z: 0 };
    const expected = snapWallMountedItem({
      position: drop,
      itemWidth: camera.width,
      itemDepth: camera.depth,
      roomWidth: width,
      roomDepth: height,
      interiorWalls: [],
    });
    expect(expected.rotation).not.toBe(0);

    const id = result.current.placeCatalogItem(camera, drop);

    expect(activeItem(id).rotation).toBeCloseTo(expected.rotation, 10);
    expect(activeItem(id).wallRotation).toBeCloseTo(expected.rotation, 10);
  });
});

describe('useItemPlacement — snapPosition', () => {
  afterEach(cleanup);

  const a = makeItem({ id: 'a', position: { x: 0, z: 0 } });
  const b = makeItem({ id: 'b', position: { x: 1.05, z: 3 } });
  const pinned = makeItem({ id: 'p', position: { x: 1.05, z: -3 }, locked: true });
  const windowItem = makeItem({ id: 'w', type: 'window', width: 1, depth: 0.1, position: { x: 3, z: -4 } });

  const mount = (extra: { allSelectedIds?: ReadonlySet<string>; frontGap?: { x0: number; x1: number } } = {}) =>
    renderHook(() =>
      useItemPlacement({
        activeFloor: makeFloor({ items: [a, b, windowItem] }),
        activeFloorY: 0,
        roomWidth: 8,
        roomDepth: 8,
        buildingCost: 0,
        actions: layoutStore.getState().actions,
        view: { snapToGrid: false, snapToWall: false, snapToItems: true },
        ...extra,
      })
    );

  it('does not snap a group drag to its own members’ stale positions (#380)', () => {
    // Alone, a snaps its right edge to b's left edge.
    expect(mount().result.current.snapPosition('a', 0.1, 0).x).toBeCloseTo(0.05, 10);
    // Dragged together with b, it doesn't.
    expect(mount({ allSelectedIds: new Set(['a', 'b']) }).result.current.snapPosition('a', 0.1, 0)).toEqual({ x: 0.1, z: 0 });
  });

  it('still snaps to a locked co-selected item, which stays put', () => {
    const { result } = renderHook(() =>
      useItemPlacement({
        activeFloor: makeFloor({ items: [a, pinned] }),
        activeFloorY: 0,
        roomWidth: 8,
        roomDepth: 8,
        buildingCost: 0,
        actions: layoutStore.getState().actions,
        view: { snapToGrid: false, snapToWall: false, snapToItems: true },
        allSelectedIds: new Set(['a', 'p']),
      })
    );
    expect(result.current.snapPosition('a', 0.1, 0).x).toBeCloseTo(0.05, 10);
  });

  it('keeps a dragged window out of the porch recess span (#394)', () => {
    const { result } = mount({ frontGap: { x0: -0.7, x1: 0.7 } });
    expect(result.current.snapPosition('w', 0.2, -4)).toEqual({ x: 1.2, z: -4 });
  });
});
