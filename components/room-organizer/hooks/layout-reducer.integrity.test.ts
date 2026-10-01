import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { MAX_ITEM_DIMENSION } from '../lib/constants';
import { parseStoredLayout } from '../lib/schema';
import { ENTRANCE_DOOR_ID, ENTRANCE_WALL_ID } from '../lib/street';
import { layoutReducer, type LayoutAction, type LayoutState } from './layout-reducer';
import type { FloorLayout, FurnitureItem, RoomLayout, RoomZone } from '../lib/types';

function stateWith(items: FurnitureItem[], floor: Partial<FloorLayout> = {}, layout: Partial<RoomLayout> = {}): LayoutState {
  return { layout: makeLayout({ floors: [makeFloor({ items, ...floor })], ...layout }), activeFloorIndex: 0 };
}

function item(state: LayoutState, id: string, floor = state.activeFloorIndex): FurnitureItem {
  const found = state.layout.floors[floor]!.items.find((entry) => entry.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
}

function reduce(state: LayoutState, ...actions: LayoutAction[]): LayoutState {
  return actions.reduce(layoutReducer, state);
}

/** What the next mount would read back from the autosave. */
function reloads(state: LayoutState): boolean {
  return parseStoredLayout(JSON.parse(JSON.stringify(state.layout))) !== null;
}

const zone = (overrides: Partial<RoomZone> = {}): RoomZone => ({
  id: 'z1',
  name: 'Living',
  color: '#ff0000',
  x: -4,
  z: -4,
  w: 8,
  d: 8,
  ...overrides,
});

describe('layoutReducer — no-op edits keep state identity (#416)', () => {
  const base = (): LayoutState => {
    const state = stateWith(
      [
        makeItem({ id: 'sofa', type: 'sofa', sofaShape: 'standard', signalRange: 5, color: '#111111', locked: true }),
        makeItem({ id: 'chair', position: { x: 1, z: 1 } }),
      ],
      {
        name: 'F0',
        floorColor: '#c9a57d',
        floorPattern: 'wood',
        wallPattern: 'brick',
        wallColors: { north: '#222222' },
        interiorWalls: [{ id: 'w1', x1: 0, z1: -2, x2: 0, z2: 2, color: '#333333' }],
      },
      { floorPlanOpacity: 0.5, floorPlanFitMode: 'stretch', roof: { style: 'gable', color: '#5d3a23' } }
    );
    return { ...state, layout: { ...state.layout, floors: [...state.layout.floors, makeFloor({ id: 'f1', name: 'F1' })] } };
  };

  const noOps: [string, LayoutAction][] = [
    ['setName with the same name', { type: 'setName', name: 'My Home' }],
    ['setFloorColor with the active colour', { type: 'setFloorColor', color: '#c9a57d' }],
    ['setFloorPattern with the active pattern', { type: 'setFloorPattern', pattern: 'wood' }],
    ['setWallPattern with the active pattern', { type: 'setWallPattern', pattern: 'brick' }],
    ['setWallColor with the same colour', { type: 'setWallColor', wall: 'north', color: '#222222' }],
    ['setWallColor resetting an unset wall', { type: 'setWallColor', wall: 'south', color: null }],
    ['setInteriorWallColor with an unknown id', { type: 'setInteriorWallColor', id: 'nope', color: '#000000' }],
    ['setInteriorWallColor with the same colour', { type: 'setInteriorWallColor', id: 'w1', color: '#333333' }],
    ['setFloorPlan clearing no image', { type: 'setFloorPlan', image: null }],
    ['setFloorPlanOpacity with the same value', { type: 'setFloorPlanOpacity', opacity: 0.5 }],
    ['setFloorPlanFitMode with the same mode', { type: 'setFloorPlanFitMode', mode: 'stretch' }],
    ['setRoofStyle with the same style', { type: 'setRoofStyle', style: 'gable' }],
    ['setRoofColor with the same colour', { type: 'setRoofColor', color: '#5d3a23' }],
    ['removeItem with an unknown id', { type: 'removeItem', id: 'nope' }],
    ['updateItem with unchanged fields', { type: 'updateItem', id: 'chair', patch: { position: { x: 1, z: 1 }, color: '#ffffff' } }],
    ['updateItem with an unknown id', { type: 'updateItem', id: 'nope', patch: { color: '#000000' } }],
    ['setSofaShape with the same shape', { type: 'setSofaShape', id: 'sofa', shape: 'standard' }],
    ['setSignalRange with the same range', { type: 'setSignalRange', id: 'sofa', range: 5 }],
    ['setColor with the same colour', { type: 'setColor', id: 'sofa', color: '#111111' }],
    ['setLocked on a locked item', { type: 'setLocked', id: 'sofa', locked: true }],
    ['moveItem to where the item already is', { type: 'moveItem', id: 'chair', x: 1, z: 1 }],
    ['bulkSetPositions to where the items already are', { type: 'bulkSetPositions', positions: new Map([['chair', { x: 1, z: 1 }]]) }],
    ['rotateSelection of locked items only', { type: 'rotateSelection', ids: new Set(['sofa']), radians: Math.PI / 2 }],
    ['removeInteriorWall with an unknown id', { type: 'removeInteriorWall', id: 'nope' }],
    ['renameFloor with the same name', { type: 'renameFloor', index: 0, name: 'F0' }],
    ['renameFloor with an out-of-range index', { type: 'renameFloor', index: 7, name: 'X' }],
    ['removeFloor with an out-of-range index', { type: 'removeFloor', index: 7 }],
    ['setActiveFloorIndex with the active index', { type: 'setActiveFloorIndex', index: 0 }],
  ];

  it.each(noOps)('%s', (_label, action) => {
    const state = base();
    expect(layoutReducer(state, action)).toBe(state);
  });

  it('setLockAll, clearItems and clearInteriorWalls are no-ops when there is nothing to change', () => {
    const locked = stateWith([makeItem({ id: 'a', locked: true })]);
    expect(layoutReducer(locked, { type: 'setLockAll', locked: true })).toBe(locked);
    const empty = stateWith([]);
    expect(layoutReducer(empty, { type: 'clearItems' })).toBe(empty);
    expect(layoutReducer(empty, { type: 'clearInteriorWalls' })).toBe(empty);
  });

  it('setLockAll keeps the identity of items already in that state', () => {
    const state = stateWith([makeItem({ id: 'a', locked: true }), makeItem({ id: 'b' })]);
    const next = layoutReducer(state, { type: 'setLockAll', locked: true });
    expect(item(next, 'a')).toBe(item(state, 'a'));
    expect(item(next, 'b').locked).toBe(true);
  });
});

describe('layoutReducer — the lock refuses mirroring (#408)', () => {
  it('toggleMirror refuses a locked item', () => {
    const state = stateWith([makeItem({ id: 'stairs', type: 'stairs', stairsShape: 'winder', locked: true })]);
    expect(layoutReducer(state, { type: 'toggleMirror', id: 'stairs' })).toBe(state);
    const unlocked = layoutReducer(state, { type: 'setLocked', id: 'stairs', locked: false });
    expect(item(layoutReducer(unlocked, { type: 'toggleMirror', id: 'stairs' }), 'stairs').mirrored).toBe(true);
  });
});

describe('layoutReducer — resizeItem re-seats wall-mounted items (#408)', () => {
  it('a deeper flush camera keeps its back face on the wall', () => {
    // 8×8 room: the north wall is z = −4, a flush camera sits depth/2 + 0.02 in.
    const camera = makeItem({ id: 'cam', type: 'security-camera', depth: 0.2, position: { x: 0, z: -3.88 }, rotation: 0 });
    const next = layoutReducer(stateWith([camera]), { type: 'resizeItem', id: 'cam', dimension: 'depth', value: 0.5 });
    expect(item(next, 'cam').depth).toBe(0.5);
    expect(item(next, 'cam').position!.z).toBeCloseTo(-4 + 0.25 + 0.02);
  });

  it('a door widened past the end of its interior wall slides back onto it', () => {
    const wall = { id: 'w1', x1: 0, z1: 0, x2: 2, z2: 0 };
    const door = makeItem({ id: 'door', type: 'door', width: 0.8, position: { x: 1.5, z: 0 }, rotation: 0 });
    const next = layoutReducer(stateWith([door], { interiorWalls: [wall] }), {
      type: 'resizeItem',
      id: 'door',
      dimension: 'width',
      value: 1.4,
    });
    expect(item(next, 'door').position).toEqual({ x: 1.3, z: 0 });
  });

  it('a height change never moves the item', () => {
    const camera = makeItem({ id: 'cam', type: 'security-camera', depth: 0.2, position: { x: 0, z: -3.88 }, rotation: 0 });
    const next = layoutReducer(stateWith([camera]), { type: 'resizeItem', id: 'cam', dimension: 'height', value: 0.6 });
    expect(item(next, 'cam').position).toEqual({ x: 0, z: -3.88 });
  });
});

describe('layoutReducer — values the schema rejects never reach the save (#418)', () => {
  const sensor = () =>
    stateWith([
      makeItem({ id: 'ap', signalRange: 5, visionRange: 4, visionFov: 90, position: { x: 1, z: 1 } }),
    ]);

  const refused: [string, LayoutAction][] = [
    ['updateItem width NaN', { type: 'updateItem', id: 'ap', patch: { width: Number.NaN } }],
    ['updateItem rotation Infinity', { type: 'updateItem', id: 'ap', patch: { rotation: Number.POSITIVE_INFINITY } }],
    ['updateItem visionRange 0', { type: 'updateItem', id: 'ap', patch: { visionRange: 0 } }],
    ['updateItem visionFov −10', { type: 'updateItem', id: 'ap', patch: { visionFov: -10 } }],
    ['updateItem position NaN', { type: 'updateItem', id: 'ap', patch: { position: { x: Number.NaN, z: 0 } } }],
    ['setSignalRange −1', { type: 'setSignalRange', id: 'ap', range: -1 }],
    ['setSignalRange NaN', { type: 'setSignalRange', id: 'ap', range: Number.NaN }],
    ['setRotation NaN', { type: 'setRotation', id: 'ap', rotation: Number.NaN }],
    ['moveItem x NaN', { type: 'moveItem', id: 'ap', x: Number.NaN, z: 0 }],
    ['bulkSetPositions NaN', { type: 'bulkSetPositions', positions: new Map([['ap', { x: 0, z: Number.NaN }]]) }],
    ['rotateSelection NaN', { type: 'rotateSelection', ids: new Set(['ap']), radians: Number.NaN }],
    ['setFloorPlanOpacity NaN', { type: 'setFloorPlanOpacity', opacity: Number.NaN }],
    ['addInteriorWall NaN', { type: 'addInteriorWall', wall: { id: 'w', x1: 0, z1: 0, x2: Number.NaN, z2: 1 } }],
    [
      'addInteriorWalls with one bad wall',
      {
        type: 'addInteriorWalls',
        walls: [
          { id: 'w', x1: 0, z1: 0, x2: 1, z2: 1 },
          { id: 'v', x1: 0, z1: Number.POSITIVE_INFINITY, x2: 1, z2: 1 },
        ],
      },
    ],
  ];

  it.each(refused)('%s is refused with the same state', (_label, action) => {
    const state = sensor();
    expect(layoutReducer(state, action)).toBe(state);
  });

  it('clamps sizes, the field of view and the plan opacity into range, and the result reloads', () => {
    let state = sensor();
    state = reduce(
      state,
      { type: 'updateItem', id: 'ap', patch: { width: 0, depth: MAX_ITEM_DIMENSION * 10 } },
      { type: 'updateItem', id: 'ap', patch: { visionFov: 400 } },
      { type: 'setFloorPlanOpacity', opacity: 3 }
    );
    expect(item(state, 'ap')).toMatchObject({ width: 0.1, depth: MAX_ITEM_DIMENSION, visionFov: 360 });
    expect(state.layout.floorPlanOpacity).toBe(1);
    expect(reloads(state)).toBe(true);
  });
});

describe('layoutReducer — the porch wall and door belong to the entrance (#357)', () => {
  const withEntrance = (): LayoutState =>
    reduce(stateWith([makeItem({ id: 'chair', position: { x: 1, z: 1 } })]), {
      type: 'setEntrance',
      entrance: { width: 1.4, depth: 1.2 },
    });
  const porchWall = (state: LayoutState) => state.layout.floors[0]!.interiorWalls?.find((w) => w.id === ENTRANCE_WALL_ID);

  it('removeInteriorWall refuses the back wall', () => {
    const state = withEntrance();
    expect(layoutReducer(state, { type: 'removeInteriorWall', id: ENTRANCE_WALL_ID })).toBe(state);
  });

  it('clearInteriorWalls keeps the back wall and is a no-op when it is the only wall', () => {
    const state = withEntrance();
    expect(layoutReducer(state, { type: 'clearInteriorWalls' })).toBe(state);
    const drawn = layoutReducer(state, { type: 'addInteriorWall', wall: { id: 'w1', x1: 0, z1: 0, x2: 2, z2: 0 } });
    const cleared = layoutReducer(drawn, { type: 'clearInteriorWalls' });
    expect(cleared.layout.floors[0]!.interiorWalls).toEqual([porchWall(state)]);
  });

  it('the door stays on the porch through every placement channel, locked or not', () => {
    let state = reduce(withEntrance(), { type: 'setLockAll', locked: false });
    const door = item(state, ENTRANCE_DOOR_ID);
    expect(door.locked).toBe(false);
    const placements: LayoutAction[] = [
      { type: 'moveItem', id: ENTRANCE_DOOR_ID, x: 2, z: 2 },
      { type: 'rotateItem', id: ENTRANCE_DOOR_ID },
      { type: 'setRotation', id: ENTRANCE_DOOR_ID, rotation: 1 },
      { type: 'updateItem', id: ENTRANCE_DOOR_ID, patch: { position: { x: 2, z: 4 }, rotation: Math.PI } },
      { type: 'bulkSetPositions', positions: new Map([[ENTRANCE_DOOR_ID, { x: 2, z: 2 }]]) },
      { type: 'rotateSelection', ids: new Set([ENTRANCE_DOOR_ID]), radians: Math.PI / 2 },
    ];
    for (const action of placements) expect(layoutReducer(state, action)).toBe(state);
    // Non-placement edits still apply.
    state = layoutReducer(state, { type: 'setColor', id: ENTRANCE_DOOR_ID, color: '#123456' });
    expect(item(state, ENTRANCE_DOOR_ID)).toMatchObject({ color: '#123456', position: door.position });
    // A group move takes the chair and leaves the door.
    state = layoutReducer(state, {
      type: 'bulkSetPositions',
      positions: new Map([
        ['chair', { x: 2, z: 2 }],
        [ENTRANCE_DOOR_ID, { x: 3, z: 3 }],
      ]),
    });
    expect(item(state, 'chair').position).toEqual({ x: 2, z: 2 });
    expect(item(state, ENTRANCE_DOOR_ID).position).toEqual(door.position);
  });

  it('the porch door is priced as structure (#382)', () => {
    expect(item(withEntrance(), ENTRANCE_DOOR_ID).price).toBe(0);
  });
});

describe('layoutReducer — a room resize re-fits openings and zones (#431)', () => {
  // 8×6 room: south wall z = 3, west wall x = −4.
  const room = (): LayoutState => {
    const state = stateWith(
      [
        makeItem({ id: 'door', type: 'door', width: 0.9, position: { x: 0, z: 3 }, rotation: Math.PI }),
        makeItem({ id: 'window', type: 'window', width: 1.2, position: { x: -4, z: 0 }, rotation: Math.PI / 2 }),
        makeItem({ id: 'sofa', type: 'sofa', position: { x: 1, z: -1 } }),
      ],
      { zones: [zone(), zone({ id: 'z2', x: 3, z: -3, w: 1, d: 1 })] },
      { width: 8, height: 6 }
    );
    return {
      ...state,
      layout: {
        ...state.layout,
        floors: [
          ...state.layout.floors,
          makeFloor({
            id: 'up',
            items: [makeItem({ id: 'up-window', type: 'window', width: 1, position: { x: 3, z: -3 }, rotation: 0 })],
          }),
        ],
      },
    };
  };

  it('shrinking moves doors and windows onto the new walls, on every floor', () => {
    const state = reduce(room(), { type: 'setWidth', width: 4 }, { type: 'setHeight', height: 4 });
    expect(item(state, 'door').position).toEqual({ x: 0, z: 2 });
    expect(item(state, 'window').position).toEqual({ x: -2, z: 0 });
    // Same wall, clamped along it so the opening still fits.
    expect(item(state, 'up-window', 1).position).toEqual({ x: 1.5, z: -2 });
    // Free-standing furniture is left where it was.
    expect(item(state, 'sofa').position).toEqual({ x: 1, z: -1 });
  });

  it('growing carries an opening out with its wall instead of stranding it mid-room', () => {
    const state = layoutReducer(room(), { type: 'setHeight', height: 12 });
    expect(item(state, 'door').position).toEqual({ x: 0, z: 6 });
    expect(item(state, 'up-window', 1).position).toEqual({ x: 3, z: -6 });
    expect(item(state, 'window').position).toEqual({ x: -4, z: 0 });
  });

  it('a flush camera follows its wall and keeps its inset', () => {
    const camera = makeItem({ id: 'cam', type: 'security-camera', depth: 0.2, position: { x: 0, z: 2.88 }, rotation: Math.PI });
    const state = layoutReducer(stateWith([camera], {}, { width: 8, height: 6 }), { type: 'setHeight', height: 10 });
    expect(item(state, 'cam').position!.z).toBeCloseTo(4.88);
  });

  it('clamps zones to the new footprint and drops the ones left outside', () => {
    const state = reduce(room(), { type: 'setWidth', width: 4 }, { type: 'setHeight', height: 4 });
    expect(state.layout.floors[0]!.zones).toEqual([zone({ x: -2, z: -2, w: 4, d: 4 })]);
    const gone = layoutReducer(
      stateWith([], { zones: [zone({ x: 3, z: 3, w: 1, d: 1 })] }),
      { type: 'setWidth', width: 4 }
    );
    expect('zones' in gone.layout.floors[0]!).toBe(false);
  });

  it('keeps the identity of floors with nothing to re-fit', () => {
    const state = stateWith([makeItem({ id: 'sofa', position: { x: 1, z: 1 } })]);
    const next = layoutReducer(state, { type: 'setWidth', width: 10 });
    expect(next.layout.width).toBe(10);
    expect(next.layout.floors).toBe(state.layout.floors);
  });
});

describe('layoutReducer — duplicates (#345, #353, #422)', () => {
  it('cloning a floor leaves the garden on the ground', () => {
    const state = stateWith([
      makeItem({ id: 'sofa', type: 'sofa' }),
      makeItem({ id: 'tree', type: 'tree', category: 'outdoor', position: { x: 0, z: 6 } }),
    ]);
    const next = layoutReducer(state, { type: 'duplicateFloor', sourceIndex: 0, newId: 'copy', idSuffix: 'x' });
    expect(next.layout.floors[1]!.items.map((i) => i.type)).toEqual(['sofa']);
  });

  it('cloning a floor gives its zones and groups fresh ids', () => {
    const state = stateWith(
      [makeItem({ id: 'a', groupId: 'g1' }), makeItem({ id: 'b', groupId: 'g1' }), makeItem({ id: 'c' })],
      { zones: [zone()] }
    );
    const next = layoutReducer(state, { type: 'duplicateFloor', sourceIndex: 0, newId: 'copy', idSuffix: 'x' });
    const copy = next.layout.floors[1]!;
    expect(copy.zones!.map((z) => z.id)).toEqual(['zone-x-0']);
    const groups = copy.items.map((i) => i.groupId);
    expect(groups[0]).toBeDefined();
    expect(groups[0]).not.toBe('g1');
    expect(groups[1]).toBe(groups[0]);
    expect(groups[2]).toBeUndefined();
    expect(reloads(next)).toBe(true);
  });

  it('duplicating a locked item yields an unlocked copy', () => {
    const state = stateWith([makeItem({ id: 'sofa', locked: true })]);
    const next = layoutReducer(state, { type: 'duplicateItem', sourceId: 'sofa', newId: 'sofa-2' });
    expect(item(next, 'sofa').locked).toBe(true);
    expect('locked' in item(next, 'sofa-2')).toBe(false);
    expect(layoutReducer(next, { type: 'moveItem', id: 'sofa-2', x: 2, z: 2 })).not.toBe(next);
  });
});

describe('layoutReducer — a roof-less house stays roof-less (#428)', () => {
  it('setRoofColor records the colour without adding a roof', () => {
    const state = stateWith([]);
    const { roof: _none, ...roofless } = state.layout;
    const next = layoutReducer({ ...state, layout: roofless }, { type: 'setRoofColor', color: '#abcdef' });
    expect(next.layout.roof).toEqual({ style: 'none', color: '#abcdef' });
  });

  it('setRoofStyle "none" on a roof-less house is a no-op', () => {
    const state = stateWith([]);
    const { roof: _none, ...roofless } = state.layout;
    const before = { ...state, layout: roofless };
    expect(layoutReducer(before, { type: 'setRoofStyle', style: 'none' })).toBe(before);
  });
});
