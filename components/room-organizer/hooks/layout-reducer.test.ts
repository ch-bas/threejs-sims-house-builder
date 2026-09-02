import { describe, expect, it } from 'vitest';
import { makeCatalogItem, makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { MAX_FLOORS, MAX_ROOM_DIMENSION } from '../lib/constants';
import { INITIAL_GROUND_FLOOR, layoutReducer, type LayoutState } from './layout-reducer';
import type { FurnitureItem } from '../lib/types';

function stateWith(items: FurnitureItem[], floorCount = 1, activeFloorIndex = 0): LayoutState {
  const floors = Array.from({ length: floorCount }, (_, i) =>
    makeFloor({ id: `floor-${i}`, name: `Floor ${i}`, items: i === activeFloorIndex ? items : [] })
  );
  return { layout: makeLayout({ floors }), activeFloorIndex };
}

function activeItems(state: LayoutState): FurnitureItem[] {
  return state.layout.floors[state.activeFloorIndex]!.items;
}

describe('layoutReducer — building properties', () => {
  it('setName / setWidth / setHeight update the layout', () => {
    let state = stateWith([]);
    state = layoutReducer(state, { type: 'setName', name: 'Villa' });
    state = layoutReducer(state, { type: 'setWidth', width: 12 });
    state = layoutReducer(state, { type: 'setHeight', height: 14 });
    expect(state.layout.name).toBe('Villa');
    expect(state.layout.width).toBe(12);
    expect(state.layout.height).toBe(14);
  });

  it('setWidth / setHeight clamp out-of-range values so the save stays schema-valid (#113)', () => {
    let state = stateWith([]);
    state = layoutReducer(state, { type: 'setWidth', width: MAX_ROOM_DIMENSION + 100 });
    expect(state.layout.width).toBe(MAX_ROOM_DIMENSION);
    state = layoutReducer(state, { type: 'setWidth', width: -3 });
    expect(state.layout.width).toBeGreaterThan(0);
    state = layoutReducer(state, { type: 'setHeight', height: Number.POSITIVE_INFINITY });
    expect(state.layout.height).toBeLessThanOrEqual(MAX_ROOM_DIMENSION);
    state = layoutReducer(state, { type: 'setHeight', height: Number.NaN });
    expect(Number.isFinite(state.layout.height)).toBe(true);
    expect(state.layout.height).toBeGreaterThan(0);
  });
});

describe('layoutReducer — item CRUD', () => {
  it('addCatalogItem adds an item to the active floor, locked, at given position', () => {
    const state = layoutReducer(stateWith([]), {
      type: 'addCatalogItem',
      catalogItem: makeCatalogItem(),
      id: 'new-1',
      position: { x: 2, z: 3 },
    });
    const items = activeItems(state);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'new-1', locked: true, rotation: 0, position: { x: 2, z: 3 } });
  });

  it('addCatalogItem defaults position to origin and adds sofaShape for sofas', () => {
    const state = layoutReducer(stateWith([]), {
      type: 'addCatalogItem',
      catalogItem: makeCatalogItem({ type: 'sofa' }),
      id: 'sofa-1',
    });
    expect(activeItems(state)[0]).toMatchObject({ position: { x: 0, z: 0 }, sofaShape: 'standard' });
  });

  it('removeItem removes only the matching item', () => {
    const state = layoutReducer(stateWith([makeItem({ id: 'a' }), makeItem({ id: 'b' })]), {
      type: 'removeItem',
      id: 'a',
    });
    expect(activeItems(state).map((i) => i.id)).toEqual(['b']);
  });

  it('updateItem merges the patch into the matching item', () => {
    const state = layoutReducer(stateWith([makeItem({ id: 'a', color: '#000' })]), {
      type: 'updateItem',
      id: 'a',
      patch: { color: '#fff', name: 'Renamed' },
    });
    expect(activeItems(state)[0]).toMatchObject({ color: '#fff', name: 'Renamed' });
  });

  it('duplicateItem clones with new id offset by +0.5,+0.5', () => {
    const state = layoutReducer(stateWith([makeItem({ id: 'a', position: { x: 1, z: 2 } })]), {
      type: 'duplicateItem',
      sourceId: 'a',
      newId: 'a-copy',
    });
    const items = activeItems(state);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ id: 'a-copy', position: { x: 1.5, z: 2.5 } });
  });

  it('duplicateItem is a no-op when the source is missing', () => {
    const before = stateWith([makeItem({ id: 'a' })]);
    const after = layoutReducer(before, { type: 'duplicateItem', sourceId: 'zzz', newId: 'x' });
    expect(after).toBe(before);
  });

  it('rotateItem advances rotation by 90° and wraps at 2π', () => {
    let state = stateWith([makeItem({ id: 'a', rotation: (3 * Math.PI) / 2 })]);
    state = layoutReducer(state, { type: 'rotateItem', id: 'a' });
    // (3π/2 + π/2) % 2π === 0
    expect(activeItems(state)[0]!.rotation).toBeCloseTo(0, 10);
  });

  it('moveItem sets an absolute position', () => {
    const state = layoutReducer(stateWith([makeItem({ id: 'a' })]), {
      type: 'moveItem',
      id: 'a',
      x: 5,
      z: -3,
    });
    expect(activeItems(state)[0]!.position).toEqual({ x: 5, z: -3 });
  });

  it('resizeItem clamps to a 0.1 minimum', () => {
    const state = layoutReducer(stateWith([makeItem({ id: 'a', width: 2 })]), {
      type: 'resizeItem',
      id: 'a',
      dimension: 'width',
      value: -5,
    });
    expect(activeItems(state)[0]!.width).toBe(0.1);
  });

  it('toggleMirror flips the mirrored flag', () => {
    let state = stateWith([makeItem({ id: 'a' })]);
    state = layoutReducer(state, { type: 'toggleMirror', id: 'a' });
    expect(activeItems(state)[0]!.mirrored).toBe(true);
    state = layoutReducer(state, { type: 'toggleMirror', id: 'a' });
    expect(activeItems(state)[0]!.mirrored).toBe(false);
  });

  it('setRotation / setColor / setLocked / setSofaShape / setSignalRange patch fields', () => {
    let state = stateWith([makeItem({ id: 'a', type: 'sofa' })]);
    state = layoutReducer(state, { type: 'setRotation', id: 'a', rotation: 1.23 });
    state = layoutReducer(state, { type: 'setColor', id: 'a', color: '#abc' });
    state = layoutReducer(state, { type: 'setLocked', id: 'a', locked: true });
    state = layoutReducer(state, { type: 'setSofaShape', id: 'a', shape: 'L-shape' });
    state = layoutReducer(state, { type: 'setSignalRange', id: 'a', range: 4 });
    expect(activeItems(state)[0]).toMatchObject({
      rotation: 1.23,
      color: '#abc',
      locked: true,
      sofaShape: 'L-shape',
      signalRange: 4,
    });
  });
});

describe('layoutReducer — bulk item operations', () => {
  it('replaceItems swaps the active floor items wholesale', () => {
    const replacement = [makeItem({ id: 'x' })];
    const state = layoutReducer(stateWith([makeItem({ id: 'a' })]), {
      type: 'replaceItems',
      items: replacement,
    });
    expect(activeItems(state).map((i) => i.id)).toEqual(['x']);
  });

  it('addItems appends to existing items', () => {
    const state = layoutReducer(stateWith([makeItem({ id: 'a' })]), {
      type: 'addItems',
      items: [makeItem({ id: 'b' }), makeItem({ id: 'c' })],
    });
    expect(activeItems(state).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('clearItems empties the active floor', () => {
    const state = layoutReducer(stateWith([makeItem({ id: 'a' })]), { type: 'clearItems' });
    expect(activeItems(state)).toEqual([]);
  });

  it('setLockAll locks/unlocks every item', () => {
    let state = stateWith([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);
    state = layoutReducer(state, { type: 'setLockAll', locked: true });
    expect(activeItems(state).every((i) => i.locked === true)).toBe(true);
    state = layoutReducer(state, { type: 'setLockAll', locked: false });
    expect(activeItems(state).every((i) => i.locked === false)).toBe(true);
  });

  it('bulkSetPositions moves only listed items and leaves others untouched', () => {
    const state = layoutReducer(
      stateWith([makeItem({ id: 'a', position: { x: 0, z: 0 } }), makeItem({ id: 'b', position: { x: 1, z: 1 } })]),
      { type: 'bulkSetPositions', positions: new Map([['a', { x: 9, z: 9 }]]) }
    );
    const items = activeItems(state);
    expect(items.find((i) => i.id === 'a')!.position).toEqual({ x: 9, z: 9 });
    expect(items.find((i) => i.id === 'b')!.position).toEqual({ x: 1, z: 1 });
  });
});

describe('layoutReducer — rotateSelection (rigid rotation about centroid)', () => {
  it('preserves the centroid and each item distance to it', () => {
    const items = [
      makeItem({ id: 'a', position: { x: 0, z: 0 }, rotation: 0 }),
      makeItem({ id: 'b', position: { x: 2, z: 0 }, rotation: 0 }),
      makeItem({ id: 'c', position: { x: 2, z: 2 }, rotation: 0 }),
      makeItem({ id: 'd', position: { x: 0, z: 2 }, rotation: 0 }),
    ];
    const state = layoutReducer(stateWith(items), {
      type: 'rotateSelection',
      ids: new Set(['a', 'b', 'c', 'd']),
      radians: Math.PI / 3,
    });
    const rotated = activeItems(state);
    const cx = rotated.reduce((s, i) => s + i.position!.x, 0) / 4;
    const cz = rotated.reduce((s, i) => s + i.position!.z, 0) / 4;
    // Centroid fixed at (1, 1).
    expect(cx).toBeCloseTo(1, 10);
    expect(cz).toBeCloseTo(1, 10);
    // Each distance to centroid preserved (rigid rotation).
    for (const original of items) {
      const now = rotated.find((r) => r.id === original.id)!;
      const dOld = Math.hypot(original.position!.x - 1, original.position!.z - 1);
      const dNew = Math.hypot(now.position!.x - 1, now.position!.z - 1);
      expect(dNew).toBeCloseTo(dOld, 10);
      // Each item's own rotation advanced by the same angle.
      expect(now.rotation).toBeCloseTo(Math.PI / 3, 10);
    }
  });

  it('preserves pairwise distances between items (arrangement rigid)', () => {
    const items = [
      makeItem({ id: 'a', position: { x: -1, z: 0 } }),
      makeItem({ id: 'b', position: { x: 3, z: 1 } }),
    ];
    const state = layoutReducer(stateWith(items), {
      type: 'rotateSelection',
      ids: new Set(['a', 'b']),
      radians: 1.1,
    });
    const [a, b] = activeItems(state);
    const dOld = Math.hypot(-1 - 3, 0 - 1);
    const dNew = Math.hypot(a!.position!.x - b!.position!.x, a!.position!.z - b!.position!.z);
    expect(dNew).toBeCloseTo(dOld, 10);
  });

  it('is a no-op when the only selected item has no position (centroid undefined)', () => {
    // The centroid is computed from positioned items only; a selection of
    // positionless items produces an empty `selected` set and returns the floor
    // unchanged.
    const before = stateWith([makeItem({ id: 'p', position: undefined, rotation: 0 })]);
    const after = layoutReducer(before, {
      type: 'rotateSelection',
      ids: new Set(['p']),
      radians: Math.PI / 2,
    });
    expect(after).toBe(before);
  });

  it('rotates a positionless item in place when a positioned item is also selected', () => {
    const items = [
      makeItem({ id: 'anchor', position: { x: 0, z: 0 }, rotation: 0 }),
      makeItem({ id: 'p', position: undefined, rotation: 0 }),
    ];
    const state = layoutReducer(stateWith(items), {
      type: 'rotateSelection',
      ids: new Set(['anchor', 'p']),
      radians: Math.PI / 2,
    });
    const positionless = activeItems(state).find((i) => i.id === 'p')!;
    expect(positionless.position).toBeUndefined();
    expect(positionless.rotation).toBeCloseTo(Math.PI / 2, 10);
  });

  it('leaves unselected items untouched and is a no-op with no positioned selection', () => {
    const before = stateWith([makeItem({ id: 'a', position: { x: 5, z: 5 } })]);
    const after = layoutReducer(before, {
      type: 'rotateSelection',
      ids: new Set(['zzz']),
      radians: 1,
    });
    expect(after).toBe(before);
  });
});

describe('layoutReducer — floor-scoped finishes', () => {
  it('setFloorColor / setFloorPattern / setWallPattern update the active floor', () => {
    let state = stateWith([]);
    state = layoutReducer(state, { type: 'setFloorColor', color: '#123456' });
    state = layoutReducer(state, { type: 'setFloorPattern', pattern: 'tile' });
    state = layoutReducer(state, { type: 'setWallPattern', pattern: 'brick' });
    const floor = state.layout.floors[0]!;
    expect(floor).toMatchObject({ floorColor: '#123456', floorPattern: 'tile', wallPattern: 'brick' });
  });

  it('setWallColor sets and clears (null) a wall color', () => {
    let state = stateWith([]);
    state = layoutReducer(state, { type: 'setWallColor', wall: 'north', color: '#aaa' });
    expect(state.layout.floors[0]!.wallColors).toEqual({ north: '#aaa' });
    state = layoutReducer(state, { type: 'setWallColor', wall: 'north', color: null });
    expect(state.layout.floors[0]!.wallColors).toEqual({});
  });

  it('toggleExteriorWall hides then unhides a wall', () => {
    let state = stateWith([]);
    state = layoutReducer(state, { type: 'toggleExteriorWall', wallId: 'east' });
    expect(state.layout.floors[0]!.hiddenWalls).toEqual(['east']);
    state = layoutReducer(state, { type: 'toggleExteriorWall', wallId: 'east' });
    expect(state.layout.floors[0]!.hiddenWalls).toEqual([]);
  });

  it('addInteriorWall / removeInteriorWall / clearInteriorWalls', () => {
    let state = stateWith([]);
    state = layoutReducer(state, {
      type: 'addInteriorWall',
      wall: { id: 'w1', x1: 0, z1: 0, x2: 1, z2: 0 },
    });
    expect(state.layout.floors[0]!.interiorWalls).toHaveLength(1);
    state = layoutReducer(state, {
      type: 'addInteriorWall',
      wall: { id: 'w2', x1: 0, z1: 0, x2: 0, z2: 1 },
    });
    state = layoutReducer(state, { type: 'removeInteriorWall', id: 'w1' });
    expect(state.layout.floors[0]!.interiorWalls!.map((w) => w.id)).toEqual(['w2']);
    state = layoutReducer(state, { type: 'clearInteriorWalls' });
    expect(state.layout.floors[0]!.interiorWalls).toEqual([]);
  });

  it('addInteriorWalls appends a batch in one dispatch (single undo entry)', () => {
    let state = stateWith([]);
    state = layoutReducer(state, {
      type: 'addInteriorWall',
      wall: { id: 'w0', x1: 0, z1: 0, x2: 1, z2: 0 },
    });
    const before = state;
    state = layoutReducer(state, {
      type: 'addInteriorWalls',
      walls: [
        { id: 'w1', x1: 1, z1: 0, x2: 1, z2: 1 },
        { id: 'w2', x1: 1, z1: 1, x2: 0, z2: 1 },
        { id: 'w3', x1: 0, z1: 1, x2: 0, z2: 0 },
      ],
    });
    // One dispatch added all three segments (plus the pre-existing one).
    expect(state.layout.floors[0]!.interiorWalls!.map((w) => w.id)).toEqual([
      'w0',
      'w1',
      'w2',
      'w3',
    ]);
    // Producing a new state object (so history captures one step).
    expect(state).not.toBe(before);
  });

  it('addInteriorWalls with an empty batch is a no-op (returns the same state)', () => {
    const state = stateWith([]);
    const next = layoutReducer(state, { type: 'addInteriorWalls', walls: [] });
    expect(next).toBe(state);
  });
});

describe('layoutReducer — roof + floor plan', () => {
  it('setRoofStyle / setRoofColor update the roof', () => {
    let state = stateWith([]);
    state = layoutReducer(state, { type: 'setRoofStyle', style: 'hipped' });
    state = layoutReducer(state, { type: 'setRoofColor', color: '#111' });
    expect(state.layout.roof).toMatchObject({ style: 'hipped', color: '#111' });
  });

  it('setFloorPlan sets and clears the image', () => {
    let state = stateWith([]);
    state = layoutReducer(state, { type: 'setFloorPlan', image: 'data:img' });
    expect(state.layout.floorPlanImage).toBe('data:img');
    state = layoutReducer(state, { type: 'setFloorPlan', image: null });
    expect(state.layout.floorPlanImage).toBeUndefined();
  });

  it('setFloorPlanOpacity / setFloorPlanFitMode update the layout', () => {
    let state = stateWith([]);
    state = layoutReducer(state, { type: 'setFloorPlanOpacity', opacity: 0.25 });
    state = layoutReducer(state, { type: 'setFloorPlanFitMode', mode: 'cover' });
    expect(state.layout.floorPlanOpacity).toBe(0.25);
    expect(state.layout.floorPlanFitMode).toBe('cover');
  });
});

describe('layoutReducer — floor / building operations', () => {
  it('setActiveFloorIndex clamps into range', () => {
    const state = stateWith([], 3);
    expect(layoutReducer(state, { type: 'setActiveFloorIndex', index: 2 }).activeFloorIndex).toBe(2);
    expect(layoutReducer(state, { type: 'setActiveFloorIndex', index: 99 }).activeFloorIndex).toBe(2);
    expect(layoutReducer(state, { type: 'setActiveFloorIndex', index: -5 }).activeFloorIndex).toBe(0);
  });

  it('addFloor appends and makes the new floor active', () => {
    const state = layoutReducer(stateWith([], 1), {
      type: 'addFloor',
      floor: { id: 'f2', floorColor: '#fff', items: [] },
    });
    expect(state.layout.floors).toHaveLength(2);
    expect(state.activeFloorIndex).toBe(1);
    expect(state.layout.floors[1]!.name).toBe('First Floor');
  });

  it('addFloor is a no-op at MAX_FLOORS', () => {
    const before = stateWith([], MAX_FLOORS);
    const after = layoutReducer(before, {
      type: 'addFloor',
      floor: { id: 'over', floorColor: '#fff', items: [] },
    });
    expect(after).toBe(before);
  });

  it('duplicateFloor clones items with fresh ids and activates the copy', () => {
    const base = stateWith([makeItem({ id: 'orig', type: 'chair' })], 1);
    const state = layoutReducer(base, {
      type: 'duplicateFloor',
      sourceIndex: 0,
      newId: 'copy',
      idSuffix: 'aaaa',
    });
    expect(state.layout.floors).toHaveLength(2);
    expect(state.activeFloorIndex).toBe(1);
    const copy = state.layout.floors[1]!;
    expect(copy.name).toBe('Floor 0 copy');
    expect(copy.items).toHaveLength(1);
    expect(copy.items[0]!.id).not.toBe('orig');
  });

  it('duplicateFloor keys cloned ids on the per-duplication idSuffix so same-millisecond copies never collide', () => {
    const base = stateWith([makeItem({ id: 'orig', type: 'chair' })], 1);
    const first = layoutReducer(base, {
      type: 'duplicateFloor',
      sourceIndex: 0,
      newId: 'copy-a',
      idSuffix: 'aaaa',
    });
    const second = layoutReducer(first, {
      type: 'duplicateFloor',
      sourceIndex: 0,
      newId: 'copy-b',
      idSuffix: 'bbbb',
    });
    const idsA = first.layout.floors[1]!.items.map((item) => item.id);
    const idsB = second.layout.floors[2]!.items.map((item) => item.id);
    expect(idsA[0]).toContain('aaaa');
    expect(idsB[0]).toContain('bbbb');
    // Even when both duplications land on the same Date.now() stamp, the
    // suffix keeps every cloned id unique.
    expect(new Set([...idsA, ...idsB]).size).toBe(idsA.length + idsB.length);
  });

  it('renameFloor renames the target floor without changing the active one', () => {
    const state = stateWith([], 2, 1);
    const next = layoutReducer(state, { type: 'renameFloor', index: 0, name: 'Basement' });
    expect(next.layout.floors[0]!.name).toBe('Basement');
    expect(next.activeFloorIndex).toBe(1);
  });

  describe('removeFloor — activeFloorIndex correctness (fixed bug)', () => {
    it('removing a floor below the active one shifts active down', () => {
      // floors [0,1,2], active = 2; remove index 0 → active should follow to 1.
      const state = stateWith([], 3, 2);
      const next = layoutReducer(state, { type: 'removeFloor', index: 0 });
      expect(next.layout.floors).toHaveLength(2);
      expect(next.activeFloorIndex).toBe(1);
    });

    it('removing a floor above the active one keeps active unchanged', () => {
      const state = stateWith([], 3, 0);
      const next = layoutReducer(state, { type: 'removeFloor', index: 2 });
      expect(next.activeFloorIndex).toBe(0);
    });

    it('removing the active floor keeps index in range (clamped)', () => {
      const state = stateWith([], 3, 2);
      const next = layoutReducer(state, { type: 'removeFloor', index: 2 });
      // active was 2, index 2 is not < 2 so it stays 2, then clamped to len-1 = 1.
      expect(next.activeFloorIndex).toBe(1);
    });

    it('is a no-op when only one floor remains', () => {
      const before = stateWith([], 1, 0);
      const after = layoutReducer(before, { type: 'removeFloor', index: 0 });
      expect(after).toBe(before);
    });
  });

  describe('reorderFloor — activeFloorIndex tracking', () => {
    it('moving the active floor makes active follow to its new slot', () => {
      const state = stateWith([], 3, 0);
      const next = layoutReducer(state, { type: 'reorderFloor', from: 0, to: 2 });
      expect(next.activeFloorIndex).toBe(2);
    });

    it('moving a floor from below the active up past it shifts active down', () => {
      // active = 2; move floor 0 → 2. Item at 0 removed (active→1), inserted at 2 (2<=1? no) → 1.
      const state = stateWith([], 3, 2);
      const next = layoutReducer(state, { type: 'reorderFloor', from: 0, to: 2 });
      expect(next.activeFloorIndex).toBe(1);
    });

    it('moving a floor from above the active down past it shifts active up', () => {
      // active = 0; move floor 2 → 0. from(2) not < active(0); to(0) <= active(0) → active += 1 = 1.
      const state = stateWith([], 3, 0);
      const next = layoutReducer(state, { type: 'reorderFloor', from: 2, to: 0 });
      expect(next.activeFloorIndex).toBe(1);
    });

    it('is a no-op for from === to or out-of-range indices', () => {
      const before = stateWith([], 3, 1);
      expect(layoutReducer(before, { type: 'reorderFloor', from: 1, to: 1 })).toBe(before);
      expect(layoutReducer(before, { type: 'reorderFloor', from: 0, to: 9 })).toBe(before);
      expect(layoutReducer(before, { type: 'reorderFloor', from: -1, to: 0 })).toBe(before);
    });

    it('actually reorders the floors array', () => {
      const state = stateWith([], 3, 0);
      const next = layoutReducer(state, { type: 'reorderFloor', from: 0, to: 2 });
      expect(next.layout.floors.map((f) => f.id)).toEqual(['floor-1', 'floor-2', 'floor-0']);
    });
  });
});

describe('layoutReducer — applyLayout', () => {
  it('clamps non-positive width/height to 1 and huge dims to MAX_ROOM_DIMENSION', () => {
    const state: LayoutState = { layout: makeLayout(), activeFloorIndex: 0 };
    const applied = layoutReducer(state, {
      type: 'applyLayout',
      layout: makeLayout({ width: -3, height: 9999 }),
    });
    expect(applied.layout.width).toBe(1);
    expect(applied.layout.height).toBe(MAX_ROOM_DIMENSION);
  });

  it('clamps a non-finite width to 1', () => {
    const state: LayoutState = { layout: makeLayout(), activeFloorIndex: 0 };
    const applied = layoutReducer(state, {
      type: 'applyLayout',
      layout: makeLayout({ width: Number.NaN }),
    });
    expect(applied.layout.width).toBe(1);
  });

  it('truncates floors beyond MAX_FLOORS and backfills empty floorColor', () => {
    const floors = Array.from({ length: MAX_FLOORS + 2 }, (_, i) =>
      makeFloor({ id: `f${i}`, name: `F${i}`, floorColor: i === 0 ? '' : '#abc' })
    );
    const state: LayoutState = { layout: makeLayout(), activeFloorIndex: 0 };
    const applied = layoutReducer(state, { type: 'applyLayout', layout: makeLayout({ floors }) });
    expect(applied.layout.floors).toHaveLength(MAX_FLOORS);
    expect(applied.layout.floors[0]!.floorColor).toBe('#c9a57d');
  });

  it('replaces an empty floors array with a default ground floor', () => {
    const state: LayoutState = { layout: makeLayout(), activeFloorIndex: 0 };
    const applied = layoutReducer(state, { type: 'applyLayout', layout: makeLayout({ floors: [] }) });
    expect(applied.layout.floors).toEqual([INITIAL_GROUND_FLOOR]);
  });

  it('clamps activeFloorIndex to the incoming floor count', () => {
    const state: LayoutState = { layout: makeLayout(), activeFloorIndex: 3 };
    const applied = layoutReducer(state, {
      type: 'applyLayout',
      layout: makeLayout({ floors: [makeFloor({ id: 'only' })] }),
    });
    expect(applied.activeFloorIndex).toBe(0);
  });
});
