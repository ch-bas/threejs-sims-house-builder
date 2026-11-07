// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem } from '../lib/__testfixtures__/fixtures';
import { liftContactPatches } from '../three/contact-shadow';
import { useItemDrag } from './use-item-drag';
import type { LayoutActions } from './use-layout-state';

vi.mock('../three/contact-shadow', () => ({ liftContactPatches: vi.fn() }));

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
        keepOut: [],
        frontGap: null,
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

describe('useItemDrag: the floor patches come back on every drop (#754)', () => {
  afterEach(cleanup);

  it('paints a moved drop where the items landed, even when the reducer changes nothing', () => {
    const lift = vi.mocked(liftContactPatches);
    lift.mockClear();
    const actions = {
      moveItem: vi.fn(),
      bulkSetPositions: vi.fn(),
      setLocked: vi.fn(),
      updateItem: vi.fn(),
    } as unknown as LayoutActions;
    const { result } = renderHook(() =>
      useItemDrag({
        activeFloor: makeFloor({ items: [makeItem({ id: 'a', position: { x: 0, z: 0 } })] }),
        activeFloorIndex: 0,
        roomWidth: 10,
        roomDepth: 10,
        keepOut: [],
        frontGap: null,
        actions,
        allSelectedIds: new Set(['a']),
      })
    );
    result.current.sceneBoxRef.current = { current: new THREE.Scene() };
    result.current.handleDragStart('a');
    result.current.handleDrag('a', 2, 3);
    result.current.handleDragEnd('a');
    expect(lift).toHaveBeenCalledTimes(2);
    const [, , lifted, moves] = lift.mock.calls[1]!;
    expect(lifted.size).toBe(0);
    expect(moves?.get('a')).toEqual({ x: 2, z: 3 });
  });
});

describe('useItemDrag — pointercancel restores the group drag (#292)', () => {
  afterEach(cleanup);

  it('puts every member back at its origin and commits nothing', () => {
    const actions = {
      moveItem: vi.fn(),
      bulkSetPositions: vi.fn(),
      setLocked: vi.fn(),
      updateItem: vi.fn(),
    } as unknown as LayoutActions;
    const floor = makeFloor({
      items: [
        makeItem({ id: 'a', position: { x: 0, z: 0 } }),
        makeItem({ id: 'b', position: { x: 2, z: 1 } }),
      ],
    });
    const scene = new THREE.Scene();
    for (const item of floor.items) {
      const group = new THREE.Group();
      group.userData = { type: 'furniture', id: item.id, floorIndex: 0 };
      group.position.set(item.position!.x, 0, item.position!.z);
      scene.add(group);
    }
    const group = (id: string) => scene.children.find((obj) => obj.userData.id === id)!;
    const { result } = renderHook(() =>
      useItemDrag({
        activeFloor: floor,
        activeFloorIndex: 0,
        roomWidth: 10,
        roomDepth: 10,
        keepOut: [],
        frontGap: null,
        actions,
        allSelectedIds: new Set(['a', 'b']),
      })
    );
    const invalidate = vi.fn();
    result.current.sceneBoxRef.current = { current: scene };
    result.current.invalidateBoxRef.current = invalidate;

    result.current.handleDragStart('a');
    // The canvas handler moves the primary itself; the hook moves the rest.
    group('a').position.set(1, 0, 1);
    result.current.handleDrag('a', 1, 1);
    expect(group('b').position.x).toBe(3);

    result.current.handleDragCancel('a', { restore: true });
    expect(group('a').position.x).toBe(0);
    expect(group('a').position.z).toBe(0);
    expect(group('b').position.x).toBe(2);
    expect(group('b').position.z).toBe(1);
    expect(invalidate).toHaveBeenCalled();
    expect(result.current.isDragActive()).toBe(false);
    result.current.handleDragEnd('a');
    expect(actions.bulkSetPositions).not.toHaveBeenCalled();
    expect(actions.setLocked).not.toHaveBeenCalled();
  });
});

describe('useItemDrag — an aborted drag leaves no tint on a kept group (#404)', () => {
  afterEach(cleanup);

  it('clears the drag collision tint and re-places the groups from state', () => {
    const actions = {
      moveItem: vi.fn(),
      bulkSetPositions: vi.fn(),
      setLocked: vi.fn(),
      updateItem: vi.fn(),
    } as unknown as LayoutActions;
    const a = makeItem({ id: 'a', width: 1, depth: 1, position: { x: 0, z: 0 } });
    const c = makeItem({ id: 'c', width: 1, depth: 1, position: { x: 3, z: 0 } });
    const scene = new THREE.Scene();
    const material = new THREE.MeshStandardMaterial({ emissive: 0x123456 });
    for (const item of [a, c]) {
      const group = new THREE.Group();
      group.userData = { type: 'furniture', id: item.id, floorIndex: 0 };
      group.position.set(item.position!.x, 0, item.position!.z);
      if (item.id === 'a') group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
      scene.add(group);
    }
    const group = (id: string) => scene.children.find((obj) => obj.userData.id === id)!;
    const params = (floor: ReturnType<typeof makeFloor>) => ({
      activeFloor: floor,
      activeFloorIndex: 0,
      roomWidth: 10,
      roomDepth: 10,
      keepOut: [],
      frontGap: null,
      actions,
      allSelectedIds: new Set(['a']),
    });
    const { result, rerender } = renderHook((props: ReturnType<typeof params>) => useItemDrag(props), {
      initialProps: params(makeFloor({ items: [a, c] })),
    });
    result.current.sceneBoxRef.current = { current: scene };

    result.current.handleDragStart('a');
    group('a').position.set(3, 0, 0);
    result.current.handleDrag('a', 3, 0);
    expect(material.emissive.getHex()).toBe(0x7f1d1d);

    // Another tab's version is adopted mid-drag: 'a' now sits at (-2, 1).
    rerender(params(makeFloor({ items: [{ ...a, position: { x: -2, z: 1 } }, c] })));
    result.current.handleDragCancel('a', { restore: false });
    expect(material.emissive.getHex()).toBe(0x123456);
    expect(material.userData.dragTint).toBeUndefined();
    expect(group('a').position.x).toBe(-2);
    expect(group('a').position.z).toBe(1);
    expect(actions.bulkSetPositions).not.toHaveBeenCalled();
  });
});

describe('useItemDrag: turning the device mid-drag cancels it (#677)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const setup = () => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 664);
    const actions = {
      moveItem: vi.fn(),
      bulkSetPositions: vi.fn(),
      setLocked: vi.fn(),
      updateItem: vi.fn(),
    } as unknown as LayoutActions;
    const floor = makeFloor({ items: [makeItem({ id: 'a', position: { x: 0, z: 0 } })] });
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.userData = { type: 'furniture', id: 'a', floorIndex: 0 };
    scene.add(group);
    const { result } = renderHook(() =>
      useItemDrag({
        activeFloor: floor,
        activeFloorIndex: 0,
        roomWidth: 10,
        roomDepth: 10,
        keepOut: [],
        frontGap: null,
        actions,
        allSelectedIds: new Set(['a']),
      })
    );
    result.current.sceneBoxRef.current = { current: scene };
    const rotate = () => {
      vi.stubGlobal('innerWidth', 750);
      vi.stubGlobal('innerHeight', 342);
    };
    return { actions, result, group, rotate };
  };

  it('a release after the viewport turned commits nothing and puts the item back', () => {
    const { actions, result, group, rotate } = setup();
    result.current.handleDragStart('a');
    result.current.handleDrag('a', 1, 1);
    rotate();
    // The front end keeps moving the primary group under the finger.
    group.position.set(-7.9, 0, 0.2);
    result.current.handleDrag('a', -7.9, 0.2);
    result.current.handleDragEnd('a');
    expect(actions.bulkSetPositions).not.toHaveBeenCalled();
    expect(actions.setLocked).not.toHaveBeenCalled();
    expect(actions.moveItem).not.toHaveBeenCalled();
    expect(group.position.x).toBe(0);
    expect(group.position.z).toBe(0);
    expect(result.current.isDragActive()).toBe(false);
  });

  it('repaints the floor patches once as the drag turns void, not on every later move (#754)', () => {
    const lift = vi.mocked(liftContactPatches);
    lift.mockClear();
    const { result, group, rotate } = setup();
    result.current.handleDragStart('a');
    expect(lift).toHaveBeenCalledTimes(1);
    expect([...lift.mock.calls[0]![2]]).toEqual(['a']);
    result.current.handleDrag('a', 1, 1);
    rotate();
    for (let i = 0; i < 10; i += 1) {
      group.position.set(i, 0, 0);
      result.current.handleDrag('a', i, 0);
    }
    expect(lift).toHaveBeenCalledTimes(2);
    expect(lift.mock.calls[1]![2].size).toBe(0);
    result.current.handleDragEnd('a');
    expect(lift).toHaveBeenCalledTimes(2);
  });

  it('a release with no move after the turn is cancelled too', () => {
    const { actions, result, rotate } = setup();
    result.current.handleDragStart('a');
    result.current.handleDrag('a', 1, 1);
    rotate();
    result.current.handleDragEnd('a');
    expect(actions.bulkSetPositions).not.toHaveBeenCalled();
  });

  it('the URL bar changing only the height does not cancel', () => {
    const { actions, result } = setup();
    result.current.handleDragStart('a');
    vi.stubGlobal('innerHeight', 720);
    result.current.handleDrag('a', 1, 1);
    result.current.handleDragEnd('a');
    expect(actions.bulkSetPositions).toHaveBeenCalledTimes(1);
  });
});

describe('useItemDrag: a garden item rides a sloped site (#665)', () => {
  afterEach(cleanup);

  it('stands the dragged and the co-dragged groups on the ground under them, and back on a cancel', () => {
    const actions = { moveItem: vi.fn(), bulkSetPositions: vi.fn(), setLocked: vi.fn(), updateItem: vi.fn() } as unknown as LayoutActions;
    const floor = makeFloor({
      items: [
        makeItem({ id: 'tree', category: 'outdoor', position: { x: -2, z: -7 } }),
        makeItem({ id: 'bench', category: 'outdoor', position: { x: 2, z: -6 } }),
      ],
    });
    const scene = new THREE.Scene();
    for (const item of floor.items) {
      const group = new THREE.Group();
      group.userData = { type: 'furniture', id: item.id, floorIndex: 0 };
      group.position.set(item.position!.x, -3, item.position!.z);
      scene.add(group);
    }
    const group = (id: string) => scene.children.find((obj) => obj.userData.id === id)!;
    const { result } = renderHook(() =>
      useItemDrag({
        activeFloor: floor,
        activeFloorIndex: 0,
        roomWidth: 8,
        roomDepth: 8,
        keepOut: [],
        frontGap: null,
        terrain: { frontY: -3, backY: 1 },
        actions,
        allSelectedIds: new Set(['tree', 'bench']),
      })
    );
    result.current.sceneBoxRef.current = { current: scene };
    result.current.handleDragStart('tree');
    // Round the side of the house, half way down its depth: the slope's middle.
    group('tree').position.set(-6, -3, -1);
    result.current.handleDrag('tree', -6, -1);
    expect(group('tree').position.y).toBeCloseTo(-3 + 4 * (3 / 8));
    // The same move carries the bench into the house: back on the floor.
    expect(group('bench').position.y).toBe(0);
    result.current.handleDragCancel('tree', { restore: true });
    expect(group('tree').position.y).toBeCloseTo(-3);
    expect(group('bench').position.y).toBeCloseTo(-3);
  });
});
