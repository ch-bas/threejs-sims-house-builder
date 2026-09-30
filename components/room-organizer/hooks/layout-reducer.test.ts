import { describe, expect, it } from 'vitest';
import { makeCatalogItem, makeFloor, makeItem, makeLayout, makeUnplacedItem } from '../lib/__testfixtures__/fixtures';
import { MAX_FLOORS, MAX_ROOM_DIMENSION } from '../lib/constants';
import { ENTRANCE_DOOR_ID } from '../lib/street';
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

  it('duplicateItem clamps the copy inside the room footprint (#116)', () => {
    const state = layoutReducer(stateWith([makeItem({ id: 'a', position: { x: 3.4, z: 3.4 } })]), {
      type: 'duplicateItem',
      sourceId: 'a',
      newId: 'a-copy',
    });
    // 8×8 room, 1×1 item: centre can reach at most ±3.5.
    expect(activeItems(state)[1]!.position).toEqual({ x: 3.5, z: 3.5 });
  });

  it('duplicateItem re-snaps a door onto its wall instead of stranding it mid-room (#116)', () => {
    const door = makeItem({ id: 'd', type: 'door', width: 0.9, depth: 0.12, position: { x: 0, z: -4 }, rotation: 0 });
    const state = layoutReducer(stateWith([door]), { type: 'duplicateItem', sourceId: 'd', newId: 'd-copy' });
    const copy = activeItems(state)[1]!;
    // The +0.5 offset slides the copy along the north wall, not into the room.
    expect(copy.position).toEqual({ x: 0.5, z: -4 });
    expect(copy.rotation).toBe(0);
  });

  it('duplicateItem keeps the raw offset for outdoor items (they belong outside)', () => {
    const tree = makeItem({ id: 't', type: 'tree', category: 'outdoor', position: { x: 7, z: 0 } });
    const state = layoutReducer(stateWith([tree]), { type: 'duplicateItem', sourceId: 't', newId: 't-copy' });
    expect(activeItems(state)[1]!.position).toEqual({ x: 7.5, z: 0.5 });
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

  it('setInteriorWallColor paints only the matching interior wall (#122)', () => {
    const floor = makeFloor({
      interiorWalls: [
        { id: 'w1', x1: 0, z1: 0, x2: 1, z2: 0 },
        { id: 'w2', x1: 1, z1: 0, x2: 1, z2: 1 },
      ],
    });
    const state = layoutReducer(
      { layout: makeLayout({ floors: [floor] }), activeFloorIndex: 0 },
      { type: 'setInteriorWallColor', id: 'w1', color: '#123456' }
    );
    const walls = state.layout.floors[0]!.interiorWalls!;
    expect(walls.find((w) => w.id === 'w1')!.color).toBe('#123456');
    expect(walls.find((w) => w.id === 'w2')!.color).toBeUndefined();
  });

  it('bulkSetPositions never moves locked items (#115)', () => {
    const state = layoutReducer(
      stateWith([
        makeItem({ id: 'a', position: { x: 0, z: 0 } }),
        makeItem({ id: 'b', position: { x: 1, z: 1 }, locked: true }),
      ]),
      {
        type: 'bulkSetPositions',
        positions: new Map([
          ['a', { x: 5, z: 5 }],
          ['b', { x: 5, z: 5 }],
        ]),
      }
    );
    const items = activeItems(state);
    expect(items.find((i) => i.id === 'a')!.position).toEqual({ x: 5, z: 5 });
    expect(items.find((i) => i.id === 'b')!.position).toEqual({ x: 1, z: 1 });
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
    const before = stateWith([makeUnplacedItem({ id: 'p', rotation: 0 })]);
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
      makeUnplacedItem({ id: 'p', rotation: 0 }),
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

describe('layoutReducer — storey height (#202)', () => {
  it('sets, clamps and resets the active floor only', () => {
    let state = stateWith([], 2, 1);
    state = layoutReducer(state, { type: 'setStoreyHeight', height: 2.5 });
    expect(state.layout.floors[1]!.height).toBe(2.5);
    expect(state.layout.floors[0]!.height).toBeUndefined();
    state = layoutReducer(state, { type: 'setStoreyHeight', height: 50 });
    expect(state.layout.floors[1]!.height).toBe(6);
    state = layoutReducer(state, { type: 'setStoreyHeight', height: Number.NaN });
    expect(state.layout.floors[1]!.height).toBe(3);
    state = layoutReducer(state, { type: 'setStoreyHeight', height: null });
    expect('height' in state.layout.floors[1]!).toBe(false);
  });

  it('keeps state identity for no-op changes so undo history stays clean', () => {
    const state = stateWith([]);
    expect(layoutReducer(state, { type: 'setStoreyHeight', height: null })).toBe(state);
    const set = layoutReducer(state, { type: 'setStoreyHeight', height: 2.5 });
    expect(layoutReducer(set, { type: 'setStoreyHeight', height: 2.5 })).toBe(set);
    // Typing the 3 m default into a default floor stores nothing (#279).
    expect(layoutReducer(state, { type: 'setStoreyHeight', height: 3 })).toBe(state);
  });

  it('duplicating a floor keeps its storey height', () => {
    let state = layoutReducer(stateWith([]), { type: 'setStoreyHeight', height: 2.4 });
    state = layoutReducer(state, { type: 'duplicateFloor', sourceIndex: 0, newId: 'copy', idSuffix: 'x' });
    expect(state.layout.floors[1]!.height).toBe(2.4);
  });

  it('applyLayout clamps a storey height and leaves legacy floors without one', () => {
    const state: LayoutState = { layout: makeLayout(), activeFloorIndex: 0 };
    const applied = layoutReducer(state, {
      type: 'applyLayout',
      layout: makeLayout({ floors: [makeFloor({ id: 'a' }), makeFloor({ id: 'b', height: 0.2 })] }),
    });
    expect('height' in applied.layout.floors[0]!).toBe(false);
    expect(applied.layout.floors[1]!.height).toBe(1);
  });
});

describe('layoutReducer — entrance, frontage, sills (#204)', () => {
  const entranceWall = (state: LayoutState, floor: number) =>
    state.layout.floors[floor]!.interiorWalls?.find((w) => w.id === 'entrance-back');
  const entranceDoor = (state: LayoutState, floor: number) =>
    state.layout.floors[floor]!.items.find((i) => i.id === 'entrance-door');

  it('adds the recess with a back wall and a door on it, and follows resizes', () => {
    let state = stateWith([], 2);
    state = layoutReducer(state, { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } });
    expect(state.layout.entrance).toEqual({ width: 1.4, depth: 1.2 });
    const wall = entranceWall(state, 0)!;
    expect(wall.z1).toBeCloseTo(-state.layout.height / 2 + 1.2);
    expect(entranceDoor(state, 0)!.position).toEqual({ x: 0, z: wall.z1 });

    state = layoutReducer(state, { type: 'setEntrance', entrance: { width: 1.4, depth: 1.5, offset: 1 } });
    expect(entranceWall(state, 0)!.z1).toBeCloseTo(-state.layout.height / 2 + 1.5);
    expect(entranceDoor(state, 0)!.position!.x).toBeCloseTo(1);
    expect(state.layout.floors[0]!.interiorWalls!.filter((w) => w.id === 'entrance-back')).toHaveLength(1);

    state = layoutReducer(state, { type: 'setHeight', height: 12 });
    expect(entranceWall(state, 0)!.z1).toBeCloseTo(-6 + 1.5);
  });

  it('moves up to the street storey on a hill, and keeps a deleted door deleted', () => {
    let state = stateWith([], 2);
    state = layoutReducer(state, { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } });
    state = layoutReducer(state, { type: 'setTerrain', terrain: { frontY: 3, backY: 0 } });
    expect(entranceWall(state, 0)).toBeUndefined();
    expect(entranceWall(state, 1)).toBeDefined();
    expect(entranceDoor(state, 1)).toBeDefined();
    state = { ...state, activeFloorIndex: 1 };
    state = layoutReducer(state, { type: 'removeItem', id: 'entrance-door' });
    state = layoutReducer(state, { type: 'setEntrance', entrance: { width: 2, depth: 1.2 } });
    expect(entranceDoor(state, 1)).toBeUndefined();
  });

  it('removes the recess, its wall and its door together', () => {
    let state = layoutReducer(stateWith([], 1), { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } });
    state = layoutReducer(state, { type: 'setEntrance', entrance: null });
    expect('entrance' in state.layout).toBe(false);
    expect(entranceWall(state, 0)).toBeUndefined();
    expect(entranceDoor(state, 0)).toBeUndefined();
    expect(layoutReducer(state, { type: 'setEntrance', entrance: null })).toBe(state);
  });

  it('brings the door back once a momentarily unbuildable recess is buildable again (#273)', () => {
    let state = layoutReducer(stateWith([], 1), { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } });
    // Typing "1.5" into Storey height passes through 1, where no porch fits.
    state = layoutReducer(state, { type: 'setStoreyHeight', height: 1 });
    expect(entranceWall(state, 0)).toBeUndefined();
    expect(entranceDoor(state, 0)).toBeUndefined();
    expect(state.layout.entrance?.door).toBeUndefined();
    state = layoutReducer(state, { type: 'setStoreyHeight', height: 3 });
    expect(entranceWall(state, 0)).toBeDefined();
    expect(entranceDoor(state, 0)).toMatchObject({ type: 'door', locked: true, rotation: 0 });
  });

  it('keeps the door when the street storey is removed from under it (#273)', () => {
    let state = layoutReducer(stateWith([], 2), { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } });
    state = layoutReducer(state, { type: 'setColor', id: 'entrance-door', color: '#123456' });
    state = layoutReducer(state, { type: 'removeFloor', index: 0 });
    expect(state.layout.floors).toHaveLength(1);
    expect(entranceWall(state, 0)).toBeDefined();
    expect(entranceDoor(state, 0)?.color).toBe('#123456');
  });

  it('records a deleted door as intent, so re-fits leave it deleted (#273)', () => {
    let state = layoutReducer(stateWith([], 1), { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } });
    state = layoutReducer(state, { type: 'removeItem', id: 'entrance-door' });
    expect(state.layout.entrance?.door).toBe(false);
    state = layoutReducer(state, { type: 'setHeight', height: 12 });
    state = layoutReducer(state, { type: 'setEntrance', entrance: { width: 2, depth: 1.2 } });
    expect(entranceDoor(state, 0)).toBeUndefined();
    expect(entranceWall(state, 0)).toBeDefined();
    // Deleting any other item is not about the door.
    const withChair = layoutReducer(layoutReducer(stateWith([], 1), { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } }), {
      type: 'addCatalogItem',
      catalogItem: makeCatalogItem(),
      id: 'chair-1',
    });
    expect(layoutReducer(withChair, { type: 'removeItem', id: 'chair-1' }).layout.entrance?.door).toBeUndefined();
    // Turning the entrance off and on again starts afresh, door included.
    state = layoutReducer(state, { type: 'setEntrance', entrance: null });
    state = layoutReducer(state, { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } });
    expect(entranceDoor(state, 0)).toBeDefined();
  });

  it('carries the back wall’s painted colour across re-fits (#273)', () => {
    let state = layoutReducer(stateWith([], 1), { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } });
    state = layoutReducer(state, { type: 'setInteriorWallColor', id: 'entrance-back', color: '#abcdef' });
    state = layoutReducer(state, { type: 'setWidth', width: 10 });
    state = layoutReducer(state, { type: 'setEntrance', entrance: { width: 2, depth: 1.5 } });
    expect(entranceWall(state, 0)).toMatchObject({ color: '#abcdef', x1: -1, x2: 1 });
  });

  it('duplicating the street storey clones neither the back wall nor the door (#273)', () => {
    let state = layoutReducer(stateWith([makeItem({ id: 'sofa' })], 1), { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } });
    state = layoutReducer(state, { type: 'duplicateFloor', sourceIndex: 0, newId: 'copy', idSuffix: 'x' });
    const copy = state.layout.floors[1]!;
    expect(copy.items.map((i) => i.type)).toEqual(['chair']);
    expect(copy.interiorWalls ?? []).toHaveLength(0);
    expect(entranceDoor(state, 0)).toBeDefined();
    expect(entranceWall(state, 0)).toBeDefined();
  });

  it('keeps state identity for no-op edits, and other floors’ identity for real ones (#279)', () => {
    let state = layoutReducer(stateWith([], 2), { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } });
    expect(layoutReducer(state, { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } })).toBe(state);
    state = layoutReducer(state, { type: 'setTerrain', terrain: { frontY: 0.1, backY: 0 } });
    expect(layoutReducer(state, { type: 'setTerrain', terrain: { frontY: 0.1, backY: 0 } })).toBe(state);
    expect(layoutReducer(state, { type: 'setWidth', width: state.layout.width })).toBe(state);
    const upper = state.layout.floors[1];
    const moved = layoutReducer(state, { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2, offset: 1 } });
    expect(moved).not.toBe(state);
    expect(moved.layout.floors[1]).toBe(upper);
  });

  it('clamps the porch height to the street storey (#275)', () => {
    let state = stateWith([], 2);
    state = layoutReducer(state, { type: 'setStoreyHeight', height: 2.5 });
    state = layoutReducer(state, { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2, height: 4 } });
    expect(state.layout.entrance?.height).toBe(2.5);
    // A save with a taller porch is clamped on the first re-fit.
    const imported: LayoutState = {
      layout: makeLayout({ floors: [makeFloor({ id: 'a' }), makeFloor({ id: 'b' })], entrance: { width: 1.4, depth: 1.2, height: 4 } }),
      activeFloorIndex: 0,
    };
    expect(layoutReducer(imported, { type: 'setWidth', width: 9 }).layout.entrance?.height).toBe(3);
  });

  it('switches frontage and drops the default', () => {
    let state = layoutReducer(stateWith([]), { type: 'setFrontage', frontage: 'pavement' });
    expect(state.layout.frontage).toBe('pavement');
    state = layoutReducer(state, { type: 'setFrontage', frontage: 'garden' });
    expect('frontage' in state.layout).toBe(false);
  });

  it('sets a clamped window sill, refuses locked or non-window items, and resets', () => {
    const window = makeItem({ id: 'w', type: 'window', locked: false });
    let state = stateWith([window, makeItem({ id: 'c', type: 'chair', locked: false }), makeItem({ id: 'l', type: 'window', locked: true })]);
    state = layoutReducer(state, { type: 'setSillHeight', id: 'w', sillHeight: 9 });
    expect(activeItems(state)[0]!.sillHeight).toBe(2.5);
    for (const id of ['c', 'l']) {
      expect(layoutReducer(state, { type: 'setSillHeight', id, sillHeight: 0.4 })).toBe(state);
    }
    state = layoutReducer(state, { type: 'setSillHeight', id: 'w', sillHeight: null });
    expect(activeItems(state)[0]!.sillHeight).toBeUndefined();
  });
});

describe('layoutReducer — stairs shape (#205)', () => {
  it('switches to a winder with a clamped lead-in and back to straight', () => {
    let state = stateWith([makeItem({ id: 's', type: 'stairs', locked: false })]);
    state = layoutReducer(state, { type: 'setStairsShape', id: 's', shape: 'winder', leadIn: 99 });
    expect(activeItems(state)[0]).toMatchObject({ stairsShape: 'winder', stairsLeadIn: 6 });
    state = layoutReducer(state, { type: 'setStairsShape', id: 's', shape: 'winder', leadIn: 0 });
    expect(activeItems(state)[0]!.stairsLeadIn).toBeUndefined();
    expect(layoutReducer(state, { type: 'setStairsShape', id: 's', shape: 'winder', leadIn: 0 })).toBe(state);
    state = layoutReducer(state, { type: 'setStairsShape', id: 's', shape: 'straight' });
    expect(activeItems(state)[0]!.stairsShape).toBeUndefined();
  });

  it('refuses locked stairs and non-stairs', () => {
    const state = stateWith([
      makeItem({ id: 'l', type: 'stairs', locked: true }),
      makeItem({ id: 'c', type: 'chair', locked: false }),
    ]);
    for (const id of ['l', 'c']) {
      expect(layoutReducer(state, { type: 'setStairsShape', id, shape: 'winder' })).toBe(state);
    }
  });
});

describe('layoutReducer — dormers (#203)', () => {
  const dormer = { id: 'd1', side: 'south' as const, width: 2, window: true };

  it('adds clamped dormers up to the cap, updates and removes them', () => {
    let state = stateWith([]);
    state = layoutReducer(state, { type: 'addDormer', dormer: { ...dormer, width: 99 } });
    expect(state.layout.roof?.dormers).toEqual([{ ...dormer, width: 8 }]);
    state = layoutReducer(state, { type: 'updateDormer', id: 'd1', patch: { width: 3, window: undefined, balcony: true } });
    expect(state.layout.roof?.dormers).toEqual([{ id: 'd1', side: 'south', width: 3, balcony: true }]);
    for (let i = 2; i <= 7; i++) {
      state = layoutReducer(state, { type: 'addDormer', dormer: { ...dormer, id: `d${i}` } });
    }
    expect(state.layout.roof?.dormers).toHaveLength(6);
    for (let i = 1; i <= 6; i++) state = layoutReducer(state, { type: 'removeDormer', id: `d${i}` });
    expect('dormers' in state.layout.roof!).toBe(false);
  });

  it('keeps state identity for unknown ids', () => {
    const state = layoutReducer(stateWith([]), { type: 'addDormer', dormer });
    expect(layoutReducer(state, { type: 'updateDormer', id: 'nope', patch: { width: 3 } })).toBe(state);
    expect(layoutReducer(state, { type: 'removeDormer', id: 'nope' })).toBe(state);
  });
});

describe('layoutReducer — site (#202)', () => {
  it('sets a clamped slope and returns to flat ground', () => {
    let state = stateWith([]);
    state = layoutReducer(state, { type: 'setTerrain', terrain: { frontY: 2.5, backY: -99 } });
    expect(state.layout.terrain).toEqual({ frontY: 2.5, backY: -3 });
    state = layoutReducer(state, { type: 'setTerrain', terrain: null });
    expect('terrain' in state.layout).toBe(false);
    expect(layoutReducer(state, { type: 'setTerrain', terrain: null })).toBe(state);
  });

  it('toggles neighbours per side and drops the field when none are left', () => {
    let state = stateWith([]);
    state = layoutReducer(state, { type: 'setNeighbour', side: 'east', present: true });
    state = layoutReducer(state, { type: 'setNeighbour', side: 'west', present: true });
    expect(state.layout.neighbours).toEqual({ east: true, west: true });
    expect(layoutReducer(state, { type: 'setNeighbour', side: 'east', present: true })).toBe(state);
    state = layoutReducer(state, { type: 'setNeighbour', side: 'east', present: false });
    expect(state.layout.neighbours).toEqual({ west: true });
    state = layoutReducer(state, { type: 'setNeighbour', side: 'west', present: false });
    expect('neighbours' in state.layout).toBe(false);
  });

  it('toggles the street rows and re-rolls the seed, keeping identity on no-ops (#310)', () => {
    let state = stateWith([]);
    state = layoutReducer(state, { type: 'setNeighbour', side: 'street', present: true });
    state = layoutReducer(state, { type: 'setNeighbour', side: 'across', present: true });
    expect(state.layout.neighbours).toEqual({ street: true, across: true });
    expect(layoutReducer(state, { type: 'setNeighbour', side: 'across', present: true })).toBe(state);

    state = layoutReducer(state, { type: 'shuffleStreet', seed: 42 });
    expect(state.layout.neighbours).toEqual({ street: true, across: true, seed: 42 });
    expect(layoutReducer(state, { type: 'shuffleStreet', seed: 42 })).toBe(state);
    // A seed the schema would reject never lands in the layout.
    expect(layoutReducer(state, { type: 'shuffleStreet', seed: -1 })).toBe(state);
    expect(layoutReducer(state, { type: 'shuffleStreet', seed: 1.5 })).toBe(state);

    // Switching the rows off keeps the seed, so the same street comes back.
    state = layoutReducer(state, { type: 'setNeighbour', side: 'street', present: false });
    state = layoutReducer(state, { type: 'setNeighbour', side: 'across', present: false });
    expect(state.layout.neighbours).toEqual({ seed: 42 });
  });

  it('applyLayout clamps an imported slope', () => {
    const state: LayoutState = { layout: makeLayout(), activeFloorIndex: 0 };
    const applied = layoutReducer(state, {
      type: 'applyLayout',
      layout: makeLayout({ terrain: { frontY: 40, backY: 0 } }),
    });
    expect(applied.layout.terrain).toEqual({ frontY: 6, backY: 0 });
    expect('terrain' in layoutReducer(state, { type: 'applyLayout', layout: makeLayout() }).layout).toBe(false);
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

describe('layoutReducer — lock enforcement in the reducer (#209)', () => {
  const locked = () => makeItem({ id: 'a', locked: true, position: { x: 1, z: 1 }, rotation: 0 });

  it.each([
    ['rotateItem', { type: 'rotateItem', id: 'a' }],
    ['moveItem', { type: 'moveItem', id: 'a', x: 3, z: 3 }],
    ['setRotation', { type: 'setRotation', id: 'a', rotation: 1.5 }],
    ['resizeItem', { type: 'resizeItem', id: 'a', dimension: 'width', value: 2 }],
  ] as const)('%s refuses a locked item and preserves state identity', (_label, action) => {
    const state = stateWith([locked()]);
    // Identity, not just equality: a refused mutation must not register as
    // an edit in snapshot-based undo history or trigger an autosave.
    expect(layoutReducer(state, action as Parameters<typeof layoutReducer>[1])).toBe(state);
  });

  it('rotateSelection leaves locked members in place while the rest orbit', () => {
    const state = stateWith([
      makeItem({ id: 'a', locked: true, position: { x: 1, z: 0 }, rotation: 0 }),
      makeItem({ id: 'b', position: { x: -1, z: 0 }, rotation: 0 }),
    ]);
    const next = layoutReducer(state, {
      type: 'rotateSelection',
      ids: new Set(['a', 'b']),
      radians: Math.PI / 2,
    });
    const [a, b] = activeItems(next);
    expect(a!.position).toEqual({ x: 1, z: 0 });
    expect(a!.rotation).toBe(0);
    expect(b!.rotation).toBeCloseTo(Math.PI / 2, 10);
  });

  it('resizeItem clamps to MAX_ITEM_DIMENSION and refuses non-finite values (#113 pattern)', () => {
    let state = stateWith([makeItem({ id: 'a', width: 1 })]);
    state = layoutReducer(state, { type: 'resizeItem', id: 'a', dimension: 'width', value: 1e6 });
    expect(activeItems(state)[0]!.width).toBeLessThanOrEqual(50);
    const before = state;
    state = layoutReducer(state, { type: 'resizeItem', id: 'a', dimension: 'width', value: Number.NaN });
    expect(state).toBe(before);
  });
});

describe('layoutReducer — wall settle rule enforced in the reducer (#210)', () => {
  const door = (over: Partial<FurnitureItem> = {}) =>
    makeItem({ id: 'door-1', type: 'door', width: 0.9, depth: 0.12, height: 2.1, position: { x: 0, z: -4 }, rotation: 0, ...over });

  it('moveItem re-snaps a door onto the wall instead of parking it mid-room', () => {
    const state = stateWith([door()]);
    const next = layoutReducer(state, { type: 'moveItem', id: 'door-1', x: 1, z: -3 });
    const moved = activeItems(next)[0]!;
    // Slides along the wall; never leaves its plane (room is 8×8 → z = −4).
    expect(moved.position!.z).toBe(-4);
    expect(moved.position!.x).toBeCloseTo(1, 10);
  });

  it('moveItem keeps ordinary furniture exactly where the caller put it', () => {
    const state = stateWith([makeItem({ id: 'a', position: { x: 0, z: 0 } })]);
    const next = layoutReducer(state, { type: 'moveItem', id: 'a', x: 2.4, z: -1.2 });
    expect(activeItems(next)[0]!.position).toEqual({ x: 2.4, z: -1.2 });
  });

  it('bulkSetPositions settles wall-mounted items (align/distribute path)', () => {
    const state = stateWith([door(), makeItem({ id: 'b', position: { x: 2, z: 2 } })]);
    const next = layoutReducer(state, {
      type: 'bulkSetPositions',
      positions: new Map([
        ['door-1', { x: 2, z: 0 }],
        ['b', { x: 2, z: 2.5 }],
      ]),
    });
    const [movedDoor, movedB] = activeItems(next);
    // The door was aligned to x=2 but pulled to its nearest wall plane…
    expect(Math.max(Math.abs(movedDoor!.position!.x), Math.abs(movedDoor!.position!.z))).toBeCloseTo(4, 10);
    // …while the free-standing item lands exactly on the alignment line.
    expect(movedB!.position).toEqual({ x: 2, z: 2.5 });
  });

  it('rotateSelection re-snaps a swept door to a wall with a wall-aligned rotation', () => {
    const state = stateWith([door(), makeItem({ id: 'b', position: { x: 0, z: 0 } })]);
    const next = layoutReducer(state, {
      type: 'rotateSelection',
      ids: new Set(['door-1', 'b']),
      radians: Math.PI / 2,
    });
    const movedDoor = activeItems(next)[0]!;
    // The orbit alone would drop the door at (−2, −2) — an interior point.
    expect(Math.max(Math.abs(movedDoor.position!.x), Math.abs(movedDoor.position!.z))).toBeCloseTo(4, 10);
    // Rotation must lie on the owning wall's axis (a multiple of π/2 that
    // matches the wall the settle picked).
    const quarter = ((movedDoor.rotation ?? 0) / (Math.PI / 2)) % 1;
    expect(Math.min(quarter, 1 - quarter)).toBeCloseTo(0, 10);
  });

  it('rotateItem flips a flush camera along its wall axis and reseats it', () => {
    const state = stateWith([
      makeItem({ id: 'cam', type: 'security-camera', width: 0.3, depth: 0.2, height: 0.25, position: { x: 0, z: -3.9 }, rotation: 0 }),
    ]);
    const next = layoutReducer(state, { type: 'rotateItem', id: 'cam' });
    const cam = activeItems(next)[0]!;
    // Flush cameras step π (in ↔ out), not the generic quarter turn.
    expect(cam.rotation).toBeCloseTo(Math.PI, 10);
    // Reseated on the exterior side of the north wall, wall yaw recorded.
    expect(cam.position!.z).toBeLessThan(-4);
    expect(cam.wallRotation).toBeDefined();
  });
});

describe('layoutReducer — the entrance door is structure (#273)', () => {
  const withEntrance = () => {
    let state = stateWith([makeItem({ id: 'a', position: { x: 1, z: 1 } })]);
    state = layoutReducer(state, { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2, height: 2.4, offset: 0 } });
    expect(activeItems(state).some((item) => item.id === ENTRANCE_DOOR_ID)).toBe(true);
    return state;
  };

  it('clearItems wipes the furniture but keeps the entrance door and records no deletion', () => {
    const next = layoutReducer(withEntrance(), { type: 'clearItems' });
    expect(activeItems(next).map((item) => item.id)).toEqual([ENTRANCE_DOOR_ID]);
    expect(next.layout.entrance?.door).toBeUndefined();
  });

  it('a deliberate delete of the door is remembered until the entrance is removed', () => {
    let state = layoutReducer(withEntrance(), { type: 'removeItem', id: ENTRANCE_DOOR_ID });
    expect(state.layout.entrance?.door).toBe(false);
    state = layoutReducer(state, { type: 'setWidth', width: 9 });
    expect(activeItems(state).some((item) => item.id === ENTRANCE_DOOR_ID)).toBe(false);
  });
});

describe('layoutReducer — persistent groups (#154)', () => {
  const trio = () =>
    stateWith([
      makeItem({ id: 'a', position: { x: 0, z: 0 } }),
      makeItem({ id: 'b', position: { x: 1, z: 0 } }),
      makeItem({ id: 'c', position: { x: 2, z: 0 } }),
    ]);

  it('setGroup stamps the ids with the group and leaves the rest alone', () => {
    const next = layoutReducer(trio(), { type: 'setGroup', ids: new Set(['a', 'b']), groupId: 'g1' });
    expect(activeItems(next).map((item) => item.groupId)).toEqual(['g1', 'g1', undefined]);
  });

  it('setGroup is an identity no-op when the members already share that group', () => {
    const grouped = layoutReducer(trio(), { type: 'setGroup', ids: new Set(['a', 'b']), groupId: 'g1' });
    expect(layoutReducer(grouped, { type: 'setGroup', ids: new Set(['a', 'b']), groupId: 'g1' })).toBe(grouped);
  });

  it('setGroup refuses a lone member, an empty group id, and unknown ids', () => {
    const state = trio();
    expect(layoutReducer(state, { type: 'setGroup', ids: new Set(['a']), groupId: 'g1' })).toBe(state);
    expect(layoutReducer(state, { type: 'setGroup', ids: new Set(['a', 'b']), groupId: '' })).toBe(state);
    expect(layoutReducer(state, { type: 'setGroup', ids: new Set(['x', 'y']), groupId: 'g1' })).toBe(state);
  });

  it('setGroup merges members of other groups into the new one', () => {
    let state = layoutReducer(trio(), { type: 'setGroup', ids: new Set(['a', 'b']), groupId: 'g1' });
    state = layoutReducer(state, { type: 'setGroup', ids: new Set(['b', 'c']), groupId: 'g2' });
    expect(activeItems(state).map((item) => item.groupId)).toEqual(['g1', 'g2', 'g2']);
  });

  it('clearGroup drops the key entirely and is an identity no-op on ungrouped items', () => {
    const grouped = layoutReducer(trio(), { type: 'setGroup', ids: new Set(['a', 'b']), groupId: 'g1' });
    const cleared = layoutReducer(grouped, { type: 'clearGroup', ids: new Set(['a', 'b', 'c']) });
    for (const item of activeItems(cleared)) expect('groupId' in item).toBe(false);
    expect(layoutReducer(cleared, { type: 'clearGroup', ids: new Set(['a', 'b', 'c']) })).toBe(cleared);
  });

  it('clearGroup on part of a group leaves the rest grouped', () => {
    const grouped = layoutReducer(trio(), { type: 'setGroup', ids: new Set(['a', 'b', 'c']), groupId: 'g1' });
    const next = layoutReducer(grouped, { type: 'clearGroup', ids: new Set(['a']) });
    expect(activeItems(next).map((item) => item.groupId)).toEqual([undefined, 'g1', 'g1']);
  });

  it('grouping a locked member is allowed — grouping is metadata, not geometry', () => {
    const state = stateWith([
      makeItem({ id: 'a', locked: true }),
      makeItem({ id: 'b', position: { x: 1, z: 0 } }),
    ]);
    const next = layoutReducer(state, { type: 'setGroup', ids: new Set(['a', 'b']), groupId: 'g1' });
    expect(activeItems(next)[0]).toMatchObject({ locked: true, groupId: 'g1' });
  });

  it('duplicateItem gives the copy no group', () => {
    const grouped = layoutReducer(trio(), { type: 'setGroup', ids: new Set(['a', 'b']), groupId: 'g1' });
    const next = layoutReducer(grouped, { type: 'duplicateItem', sourceId: 'a', newId: 'a2' });
    const copy = activeItems(next).find((item) => item.id === 'a2')!;
    expect('groupId' in copy).toBe(false);
    expect(activeItems(next).find((item) => item.id === 'a')!.groupId).toBe('g1');
  });

  it('groups only touch the active floor', () => {
    const state = stateWith(
      [makeItem({ id: 'a' }), makeItem({ id: 'b', position: { x: 1, z: 0 } })],
      2,
      1
    );
    const next = layoutReducer(state, { type: 'setGroup', ids: new Set(['a', 'b']), groupId: 'g1' });
    expect(next.layout.floors[0]).toBe(state.layout.floors[0]);
    expect(next.layout.floors[1]!.items.every((item) => item.groupId === 'g1')).toBe(true);
  });
});

describe('layoutReducer — room zones (#155)', () => {
  const bedroom = { id: 'z1', name: 'Bedroom', color: '#3b82f6', x: -4, z: -4, w: 3, d: 2.5 };
  const withZone = () => layoutReducer(stateWith([]), { type: 'addZone', zone: bedroom });
  const activeZones = (state: LayoutState) => state.layout.floors[state.activeFloorIndex]!.zones;

  it('addZone appends to the active floor only', () => {
    const state = layoutReducer(stateWith([], 2, 1), { type: 'addZone', zone: bedroom });
    expect(state.layout.floors[1]!.zones).toEqual([bedroom]);
    expect(state.layout.floors[0]!.zones).toBeUndefined();
  });

  it('addZone rounds and clamps the rectangle to the footprint, and refuses one that clamps away', () => {
    // The fixture room is 8 × 8: the left edge clamps to −4, the right edge
    // (−9.04 + 12 = 2.96) rounds to 3.
    const state = layoutReducer(stateWith([]), {
      type: 'addZone',
      zone: { ...bedroom, x: -9.04, z: 1, w: 12, d: 1.26 },
    });
    expect(activeZones(state)).toEqual([{ ...bedroom, x: -4, z: 1, w: 7, d: 1.3 }]);
    const initial = stateWith([]);
    const outside = layoutReducer(initial, { type: 'addZone', zone: { ...bedroom, x: 6, w: 2 } });
    expect(outside).toBe(initial);
  });

  it('addZone is a no-op (same identity) for a duplicate id or a corrupt rectangle', () => {
    const state = withZone();
    expect(layoutReducer(state, { type: 'addZone', zone: { ...bedroom, name: 'Again' } })).toBe(state);
    expect(layoutReducer(state, { type: 'addZone', zone: { ...bedroom, id: 'z2', w: Number.NaN } })).toBe(state);
  });

  it('updateZone renames / recolours / re-fits, keeping identity when nothing changes', () => {
    const state = withZone();
    const renamed = layoutReducer(state, { type: 'updateZone', id: 'z1', patch: { name: 'Study', color: '#f59e0b' } });
    expect(activeZones(renamed)).toEqual([{ ...bedroom, name: 'Study', color: '#f59e0b' }]);
    expect(layoutReducer(renamed, { type: 'updateZone', id: 'z1', patch: { name: 'Study' } })).toBe(renamed);
    // The rectangle is normalised like on add.
    const moved = layoutReducer(renamed, { type: 'updateZone', id: 'z1', patch: { x: -20, w: 40 } });
    expect(activeZones(moved)![0]).toMatchObject({ x: -4, w: 8 });
    // Unknown id and a rectangle that would vanish are both refused.
    expect(layoutReducer(renamed, { type: 'updateZone', id: 'nope', patch: { name: 'X' } })).toBe(renamed);
    expect(layoutReducer(renamed, { type: 'updateZone', id: 'z1', patch: { w: 0 } })).toBe(renamed);
  });

  it('removeZone drops the zone, the field once empty, and is a no-op for an unknown id', () => {
    const state = withZone();
    const removed = layoutReducer(state, { type: 'removeZone', id: 'z1' });
    expect(activeZones(removed)).toBeUndefined();
    expect(layoutReducer(state, { type: 'removeZone', id: 'nope' })).toBe(state);
    expect(layoutReducer(removed, { type: 'removeZone', id: 'z1' })).toBe(removed);
  });
});
