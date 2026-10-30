// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoAnswerConfirms } from '../lib/__testfixtures__/confirm';
import { makeCatalogItem, makeFloor, makeItem } from '../lib/__testfixtures__/fixtures';
import { DEFAULT_BUDGET } from '../lib/constants';
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

  it('turns a free-standing item by the rotation it was placed with (the ghost’s R)', () => {
    const { result } = mount();
    const id = result.current.placeCatalogItem(makeCatalogItem(), { x: 1, z: 1 }, Math.PI / 2);
    expect(activeItem(id).position).toEqual({ x: 1, z: 1 });
    expect(activeItem(id).rotation).toBeCloseTo(Math.PI / 2, 10);
    expect(activeItem(id).locked).toBe(true);
  });

  it('refuses a purchase over what a hard budget leaves, without asking', () => {
    const { layout, activeFloorIndex, actions } = layoutStore.getState();
    const { result } = renderHook(() =>
      useItemPlacement({
        activeFloor: layout.floors[activeFloorIndex]!,
        activeFloorY: 0,
        roomWidth: layout.width,
        roomDepth: layout.height,
        buildingCost: 0,
        actions,
        view: { snapToGrid: false, snapToWall: false, snapToItems: false },
        refusePurchase: (price) => price > 50,
      })
    );
    const before = layoutStore.getState().layout;
    expect(result.current.placeCatalogItem(makeCatalogItem({ price: 100 }), { x: 0, z: 0 })).toBe('');
    expect(layoutStore.getState().layout).toBe(before);
    expect(result.current.placeCatalogItem(makeCatalogItem({ price: 40 }), { x: 0, z: 0 })).not.toBe('');
  });

  describe('over the soft budget (#136), asked in the app (#649)', () => {
    const mountOver = (onPlacedAfterConfirm: (id: string) => void) => {
      const { layout, activeFloorIndex, actions } = layoutStore.getState();
      return renderHook(() =>
        useItemPlacement({
          activeFloor: layout.floors[activeFloorIndex]!,
          activeFloorY: 0,
          roomWidth: layout.width,
          roomDepth: layout.height,
          buildingCost: DEFAULT_BUDGET - 10,
          actions,
          view: { snapToGrid: false, snapToWall: false, snapToItems: false },
          onPlacedAfterConfirm,
        })
      );
    };

    it('asks without the native confirm and adds nothing until the answer', async () => {
      const native = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const placed = vi.fn<(id: string) => void>();
      const { result } = mountOver(placed);
      const before = layoutStore.getState().layout;
      let pending = '';
      let asked: string[] = [];
      await act(async () => {
        const auto = autoAnswerConfirms(true);
        pending = result.current.placeCatalogItem(makeCatalogItem({ name: 'Pricey', price: 100 }), { x: 0, z: 0 });
        // Nothing yet: the place call returned before the answer.
        expect(layoutStore.getState().layout).toBe(before);
        await Promise.resolve();
        asked = auto.asked.map((question) => question.title);
        auto.stop();
      });
      expect(pending).toBe('');
      expect(native).not.toHaveBeenCalled();
      expect(asked).toEqual([expect.stringMatching(/puts you over the .* budget\. Place it anyway\?/) as unknown]);
      expect(placed).toHaveBeenCalledOnce();
      const id = placed.mock.calls[0]![0];
      expect(activeItem(id).name).toBe('Pricey');
      native.mockRestore();
    });

    it('a no adds nothing', async () => {
      const placed = vi.fn<(id: string) => void>();
      const { result } = mountOver(placed);
      const before = layoutStore.getState().layout;
      await act(async () => {
        const auto = autoAnswerConfirms(false);
        result.current.placeCatalogItem(makeCatalogItem({ price: 100 }), { x: 0, z: 0 });
        await Promise.resolve();
        auto.stop();
      });
      expect(placed).not.toHaveBeenCalled();
      expect(layoutStore.getState().layout).toBe(before);
    });
  });

  it('previews a catalogue door on its wall, facing the room (#463 d)', () => {
    const { result } = mount();
    const { width, height } = layoutStore.getState().layout;
    const door = makeCatalogItem({ type: 'door', width: 0.9, depth: 0.12, height: 2.1 });
    const drop = { x: width / 2 - 0.4, z: 0.3 };
    const expected = snapOpeningToWall({ position: drop, itemWidth: door.width, roomWidth: width, roomDepth: height, interiorWalls: [] });
    const preview = result.current.snapCatalogPlacement(door, drop.x, drop.z, 0);
    expect(preview.position).toEqual(expected.position);
    expect(preview.rotation).toBeCloseTo(expected.rotation, 10);
  });

  it('previews a free-standing item through the grid snap, keeping its turn', () => {
    const { layout, activeFloorIndex, actions } = layoutStore.getState();
    const { result } = renderHook(() =>
      useItemPlacement({
        activeFloor: layout.floors[activeFloorIndex]!,
        activeFloorY: 0,
        roomWidth: layout.width,
        roomDepth: layout.height,
        buildingCost: 0,
        actions,
        view: { snapToGrid: true, snapToWall: false, snapToItems: false },
      })
    );
    const preview = result.current.snapCatalogPlacement(makeCatalogItem(), 1.13, -0.91, Math.PI);
    expect(preview.rotation).toBe(Math.PI);
    expect(preview.position.x).not.toBe(1.13);
    expect(preview.position.z).not.toBe(-0.91);
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
