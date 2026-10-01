import { describe, expect, it } from 'vitest';
import { makeCatalogItem, makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { MAX_FLOORS } from '../lib/constants';
import {
  MAX_COORDINATE,
  MAX_INTERIOR_WALLS_PER_FLOOR,
  MAX_ITEMS_PER_FLOOR,
  MAX_NAME_LENGTH,
  parseStoredLayout,
} from '../lib/schema';
import { layoutReducer, type LayoutAction, type LayoutState } from './layout-reducer';
import type { FurnitureItem, RoomLayout } from '../lib/types';

/*
 * The schema repairs what breaks its caps, but the reducer must never
 * produce such a house in the first place: whatever the editor does, the
 * autosave has to read back exactly as it was written.
 */

/** What the next mount reads back from the autosave. */
function reload(layout: RoomLayout): RoomLayout | null {
  return parseStoredLayout(JSON.parse(JSON.stringify(layout)));
}

function expectReloadsUnchanged(state: LayoutState): void {
  const saved = JSON.parse(JSON.stringify(state.layout)) as RoomLayout;
  expect(reload(state.layout)).toEqual(saved);
}

/** Deterministic PRNG (mulberry32), so a failure replays. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HUGE = [1e300, -1e300, 1e7, -5_000, 250, -306, MAX_COORDINATE + 0.5, Number.MAX_VALUE];
const LONG = 'L'.repeat(10_000);

function start(): LayoutState {
  return { layout: makeLayout({ width: 100, height: 100, floors: [makeFloor()] }), activeFloorIndex: 0 };
}

describe('reducer output always reloads unchanged (#332, #350)', () => {
  it('survives a long random run of extreme edits', () => {
    const random = rng(1234);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
    const coordinate = () => (random() < 0.5 ? pick(HUGE) : (random() - 0.5) * 20);
    let nextId = 0;
    const id = (prefix: string) => `${prefix}-${nextId++}`;
    const floorItems = (state: LayoutState) => state.layout.floors[state.activeFloorIndex]!.items;
    const anyItemId = (state: LayoutState) => {
      const items = floorItems(state);
      return items.length > 0 ? pick(items).id : 'none';
    };

    const steps: ((state: LayoutState) => LayoutAction)[] = [
      () => ({ type: 'setName', name: pick([LONG, 'x'.repeat(MAX_NAME_LENGTH + 1), 'Home']) }),
      () => ({ type: 'addCatalogItem', catalogItem: makeCatalogItem(), id: id('cat'), position: { x: coordinate(), z: coordinate() } }),
      () => ({
        type: 'addItems',
        items: Array.from({ length: Math.floor(random() * 400) }, () =>
          makeItem({ id: id('item'), name: random() < 0.2 ? LONG : 'Chair', position: { x: coordinate(), z: coordinate() } })
        ),
      }),
      (state) => ({ type: 'moveItem', id: anyItemId(state), x: coordinate(), z: coordinate() }),
      (state) => ({
        type: 'bulkSetPositions',
        positions: new Map(floorItems(state).slice(0, 50).map((item) => [item.id, { x: coordinate(), z: coordinate() }])),
      }),
      (state) => ({
        type: 'updateItem',
        id: anyItemId(state),
        patch: { name: LONG, price: -50, position: { x: coordinate(), z: coordinate() } },
      }),
      (state) => ({ type: 'duplicateItem', sourceId: anyItemId(state), newId: id('dup') }),
      (state) => ({ type: 'rotateSelection', ids: new Set(floorItems(state).map((item) => item.id)), radians: random() * 6 }),
      () => ({ type: 'addInteriorWall', wall: { id: id('wall'), x1: coordinate(), z1: coordinate(), x2: coordinate(), z2: coordinate() } }),
      () => ({
        type: 'addInteriorWalls',
        walls: Array.from({ length: 200 }, () => ({ id: id('wall'), x1: coordinate(), z1: coordinate(), x2: coordinate(), z2: 1 })),
      }),
      (state) => ({ type: 'duplicateFloor', sourceIndex: state.activeFloorIndex, newId: id('floor'), idSuffix: id('s') }),
      (state) => ({ type: 'renameFloor', index: state.activeFloorIndex, name: LONG }),
      () => ({ type: 'addFloor', floor: { id: id('floor'), name: LONG, floorColor: '#ffffff', items: [] } }),
      (state) => ({ type: 'setActiveFloorIndex', index: Math.floor(random() * state.layout.floors.length) }),
      () => ({ type: 'addZone', zone: { id: id('zone'), name: LONG, color: '#abcdef', x: -2, z: -2, w: 4, d: 4 } }),
      (state) => {
        const zones = state.layout.floors[state.activeFloorIndex]!.zones ?? [];
        return { type: 'updateZone', id: zones[0]?.id ?? 'none', patch: { name: `${LONG}!` } };
      },
      (state) => ({ type: 'setLockAll', locked: random() < 0.2 && floorItems(state).length > 0 }),
    ];

    let state = start();
    for (let step = 0; step < 300; step++) {
      state = layoutReducer(state, pick(steps)(state));
      if (step % 10 === 0) expectReloadsUnchanged(state);
    }
    expectReloadsUnchanged(state);
    for (const floor of state.layout.floors) {
      expect(floor.items.length).toBeLessThanOrEqual(MAX_ITEMS_PER_FLOOR);
      expect((floor.interiorWalls ?? []).length).toBeLessThanOrEqual(MAX_INTERIOR_WALLS_PER_FLOOR);
    }
  });

  it('clamps a drag far past the lot instead of writing an unreadable position', () => {
    let state: LayoutState = { layout: makeLayout({ floors: [makeFloor({ items: [makeItem({ id: 'a' })] })] }), activeFloorIndex: 0 };
    state = layoutReducer(state, { type: 'moveItem', id: 'a', x: 1e9, z: -250 });
    expect(state.layout.floors[0]!.items[0]!.position).toEqual({ x: MAX_COORDINATE, z: -250 });
    state = layoutReducer(state, { type: 'bulkSetPositions', positions: new Map([['a', { x: -1e9, z: 1e9 }]]) });
    expect(state.layout.floors[0]!.items[0]!.position).toEqual({ x: -MAX_COORDINATE, z: MAX_COORDINATE });
    expectReloadsUnchanged(state);
  });

  it('caps names from every free-text entry point', () => {
    let state = start();
    state = layoutReducer(state, { type: 'setName', name: LONG });
    state = layoutReducer(state, { type: 'renameFloor', index: 0, name: LONG });
    expect(state.layout.name).toHaveLength(MAX_NAME_LENGTH);
    expect(state.layout.floors[0]!.name).toHaveLength(MAX_NAME_LENGTH);
    // Re-typing past the cap changes nothing, so it adds no undo entry.
    expect(layoutReducer(state, { type: 'setName', name: `${LONG}more` })).toBe(state);
    for (let i = 1; i < MAX_FLOORS; i++) {
      state = layoutReducer(state, { type: 'duplicateFloor', sourceIndex: i - 1, newId: `f${i}`, idSuffix: `s${i}` });
    }
    expect(state.layout.floors).toHaveLength(MAX_FLOORS);
    for (const floor of state.layout.floors) expect(floor.name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expectReloadsUnchanged(state);
  });

  it('refuses items and walls past the per-floor caps, keeping state identity', () => {
    const items = (count: number, prefix: string): FurnitureItem[] =>
      Array.from({ length: count }, (_, i) => makeItem({ id: `${prefix}${i}` }));
    let state = start();
    expect(layoutReducer(state, { type: 'addItems', items: items(MAX_ITEMS_PER_FLOOR + 1, 'a') })).toBe(state);
    expect(layoutReducer(state, { type: 'replaceItems', items: items(MAX_ITEMS_PER_FLOOR + 1, 'a') })).toBe(state);
    state = layoutReducer(state, { type: 'addItems', items: items(MAX_ITEMS_PER_FLOOR - 1, 'a') });
    expect(state.layout.floors[0]!.items).toHaveLength(MAX_ITEMS_PER_FLOOR - 1);
    expect(layoutReducer(state, { type: 'addCatalogItem', catalogItem: makeCatalogItem(), id: 'one-more' })).toBe(state);
    expect(layoutReducer(state, { type: 'duplicateItem', sourceId: 'a0', newId: 'copy' })).toBe(state);
    expect(layoutReducer(state, { type: 'addItems', items: items(1, 'b') })).toBe(state);
    // Every item that was let in survives the reload.
    expect(reload(state.layout)!.floors[0]!.items).toHaveLength(MAX_ITEMS_PER_FLOOR - 1);

    const walls = Array.from({ length: MAX_INTERIOR_WALLS_PER_FLOOR - 1 }, (_, i) => ({ id: `w${i}`, x1: 0, z1: i / 100, x2: 1, z2: i / 100 }));
    state = layoutReducer(state, { type: 'addInteriorWalls', walls });
    expect(layoutReducer(state, { type: 'addInteriorWall', wall: { id: 'extra', x1: 0, z1: 0, x2: 2, z2: 2 } })).toBe(state);
    expectReloadsUnchanged(state);
  });
});
