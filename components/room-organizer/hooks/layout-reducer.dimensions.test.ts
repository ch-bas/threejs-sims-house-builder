import { describe, expect, it } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { MAX_DIMENSIONS_PER_FLOOR } from '../lib/plan-dimensions';
import { layoutReducer, type LayoutState } from './layout-reducer';
import type { PinnedDimension } from '../lib/types';

const pin = (id: string, ax: number, bx: number, z = 0): PinnedDimension => ({ id, a: { x: ax, z }, b: { x: bx, z } });

function state(dimensions?: PinnedDimension[]): LayoutState {
  return {
    layout: makeLayout({ width: 10, height: 8, roof: { style: 'flat', color: '#555555' }, floors: [makeFloor({ ...(dimensions ? { dimensions } : {}) }), makeFloor({ id: 'upper', name: 'Upper' })] }),
    activeFloorIndex: 0,
  };
}

describe('pinned dimensions in the reducer (#921)', () => {
  it('pins on the active floor only, and unpins', () => {
    const pinned = layoutReducer(state(), { type: 'addDimension', dimension: pin('d1', -5, -2) });
    expect(pinned.layout.floors[0]!.dimensions).toEqual([pin('d1', -5, -2)]);
    expect(pinned.layout.floors[1]!.dimensions).toBeUndefined();
    const upstairs = layoutReducer({ ...pinned, activeFloorIndex: 1 }, { type: 'addDimension', dimension: pin('d2', 0, 1) });
    expect(upstairs.layout.floors[1]!.dimensions).toEqual([pin('d2', 0, 1)]);
    const unpinned = layoutReducer(pinned, { type: 'removeDimension', id: 'd1' });
    expect('dimensions' in unpinned.layout.floors[0]!).toBe(false);
  });

  it.each([
    ['a zero-length pin', pin('d9', 1, 1)],
    ['a NaN end', pin('d9', Number.NaN, 1)],
    ['an id already pinned', pin('d1', 0, 3)],
  ])('returns the same state for %s', (_name, dimension) => {
    const before = state([pin('d1', -5, -2)]);
    expect(layoutReducer(before, { type: 'addDimension', dimension })).toBe(before);
  });

  it('returns the same state for an unknown unpin and past the cap', () => {
    const before = state([pin('d1', -5, -2)]);
    expect(layoutReducer(before, { type: 'removeDimension', id: 'nope' })).toBe(before);
    const full = state(Array.from({ length: MAX_DIMENSIONS_PER_FLOOR }, (_, index) => pin(`d${index}`, 0, 1, index / 100)));
    expect(layoutReducer(full, { type: 'addDimension', dimension: pin('extra', 0, 2) })).toBe(full);
  });

  it('keeps a pin in range: a coordinate out past the lot is brought in', () => {
    const after = layoutReducer(state(), { type: 'addDimension', dimension: pin('d1', 0, 1e9) });
    expect(after.layout.floors[0]!.dimensions![0]!.b.x).toBeLessThan(1e9);
  });

  it('moves pins with the walls in the same step as a resize or a corner cut', () => {
    const before = state([pin('d1', -5, -2), { id: 'd2', a: { x: 4, z: -3.5 }, b: { x: -4, z: -3.5 } }]);
    const wider = layoutReducer(before, { type: 'setWidth', width: 12 });
    expect(wider.layout.floors[0]!.dimensions![0]).toEqual(pin('d1', -6, -2));
    const cut = layoutReducer(before, { type: 'setCutout', cutout: { corner: 'ne', width: 4, depth: 3 } });
    expect(cut.layout.cutout).toBeDefined();
    const moved = cut.layout.floors[0]!.dimensions![1]!;
    expect(moved.a).toEqual({ x: 4, z: -1 });
    // A resize that changes nothing for the pins keeps them as they were.
    const deeper = layoutReducer(before, { type: 'setHeight', height: 9 });
    expect(deeper.layout.floors[0]!.dimensions).toBe(before.layout.floors[0]!.dimensions);
  });

  it('a copied floor gets its pins under fresh ids, without those out to the garden', () => {
    const before = state([pin('d1', -5, -2), pin('garden', 3, 9)]);
    const after = layoutReducer(before, { type: 'duplicateFloor', sourceIndex: 0, newId: 'copy', idSuffix: 'x' });
    const copy = after.layout.floors.find((floor) => floor.id === 'copy')!;
    expect(copy.dimensions).toEqual([{ ...pin('d1', -5, -2), id: 'dim-x-0' }]);
    expect(after.layout.floors[0]!.dimensions).toBe(before.layout.floors[0]!.dimensions);
  });
});
