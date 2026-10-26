import { describe, expect, it } from 'vitest';
import { makeCatalogItem, makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { parseStoredLayout } from '../lib/schema';
import { layoutReducer, type LayoutAction, type LayoutState } from './layout-reducer';
import type { FurnitureItem } from '../lib/types';

function stateWith(items: FurnitureItem[]): LayoutState {
  return { layout: makeLayout({ floors: [makeFloor({ items })] }), activeFloorIndex: 0 };
}

function reduce(state: LayoutState, ...actions: LayoutAction[]): LayoutState {
  return actions.reduce(layoutReducer, state);
}

function items(state: LayoutState): FurnitureItem[] {
  return state.layout.floors[state.activeFloorIndex]!.items;
}

/** What the next mount would read back from the autosave. */
function reloads(state: LayoutState): boolean {
  return parseStoredLayout(JSON.parse(JSON.stringify(state.layout))) !== null;
}

describe('layoutReducer: incoming items need a finite placement (#593)', () => {
  const nan = { x: Number.NaN, z: 1 };
  const inf = { x: 1, z: Number.POSITIVE_INFINITY };

  it.each([nan, inf])('addCatalogItem refuses the position %o', (position) => {
    const state = stateWith([]);
    const next = reduce(state, { type: 'addCatalogItem', catalogItem: makeCatalogItem(), id: 'c1', position });
    expect(next).toBe(state);
    expect(reloads(next)).toBe(true);
  });

  it.each([nan, inf])('addItems refuses a batch holding the position %o', (position) => {
    const state = stateWith([]);
    const next = reduce(state, {
      type: 'addItems',
      items: [makeItem({ id: 'ok', position: { x: 1, z: 1 } }), makeItem({ id: 'bad', position })],
    });
    expect(next).toBe(state);
  });

  it.each([nan, inf])('replaceItems refuses a list holding the position %o', (position) => {
    const state = stateWith([makeItem({ id: 'old' })]);
    const next = reduce(state, { type: 'replaceItems', items: [makeItem({ id: 'bad', position })] });
    expect(next).toBe(state);
  });

  it('addItems and replaceItems refuse a non-finite rotation too', () => {
    const state = stateWith([]);
    const bad = makeItem({ id: 'bad', rotation: Number.NaN });
    expect(reduce(state, { type: 'addItems', items: [bad] })).toBe(state);
    expect(reduce(state, { type: 'replaceItems', items: [bad] })).toBe(state);
  });

  it('still adds finite items, and the result reloads', () => {
    const state = stateWith([]);
    const next = reduce(
      state,
      { type: 'addCatalogItem', catalogItem: makeCatalogItem(), id: 'c1', position: { x: 1, z: 2 } },
      { type: 'addItems', items: [makeItem({ id: 'a', position: { x: -1, z: 0 } })] }
    );
    expect(items(next).map((item) => item.id)).toEqual(['c1', 'a']);
    expect(reloads(next)).toBe(true);
  });
});

describe('layoutReducer: rotateSelection keeps identity when nothing moves (#598)', () => {
  it('a zero rotation is a no-op', () => {
    const state = stateWith([
      makeItem({ id: 'a', position: { x: 1, z: 0 } }),
      makeItem({ id: 'b', position: { x: -1, z: 0 } }),
    ]);
    expect(reduce(state, { type: 'rotateSelection', ids: new Set(['a', 'b']), radians: 0 })).toBe(state);
  });

  it('a window on its wall stays put, so rotating it alone is a no-op', () => {
    const state = stateWith([
      makeItem({ id: 'w', type: 'window', width: 1, depth: 0.2, position: { x: 1, z: -4 }, rotation: 0 }),
    ]);
    expect(reduce(state, { type: 'rotateSelection', ids: new Set(['w']), radians: Math.PI / 2 })).toBe(state);
  });
});

describe('layoutReducer: rotating a selection never stacks openings (#583)', () => {
  const windows = (): FurnitureItem[] => [
    makeItem({ id: 'w1', type: 'window', width: 1, depth: 0.2, position: { x: -1, z: -4 }, rotation: 0 }),
    makeItem({ id: 'w2', type: 'window', width: 1, depth: 0.2, position: { x: 1, z: -4 }, rotation: 0 }),
  ];

  it('two windows on one wall stay where they were', () => {
    const state = stateWith(windows());
    const next = reduce(state, { type: 'rotateSelection', ids: new Set(['w1', 'w2']), radians: Math.PI / 2 });
    const [w1, w2] = items(next);
    expect(w1!.position).toEqual({ x: -1, z: -4 });
    expect(w2!.position).toEqual({ x: 1, z: -4 });
  });

  it('a room selection turns its furniture about the furniture, and leaves the openings on their walls', () => {
    const state = stateWith([
      ...windows(),
      makeItem({ id: 'chair', position: { x: 1, z: 0 } }),
      makeItem({ id: 'table', position: { x: -1, z: 0 } }),
    ]);
    const next = reduce(state, {
      type: 'rotateSelection',
      ids: new Set(['w1', 'w2', 'chair', 'table']),
      radians: Math.PI / 2,
    });
    const byId = new Map(items(next).map((item) => [item.id, item]));
    expect(byId.get('w1')).toBe(items(state)[0]);
    expect(byId.get('w2')).toBe(items(state)[1]);
    // The furniture's own centroid is the origin: (1, 0) orbits to (0, -1).
    expect(byId.get('chair')!.position!.x).toBeCloseTo(0);
    expect(byId.get('chair')!.position!.z).toBeCloseTo(-1);
    expect(byId.get('table')!.position!.z).toBeCloseTo(1);
  });
});
