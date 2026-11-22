import { describe, expect, it } from 'vitest';
import { makeFloor, makeLayout } from './__testfixtures__/fixtures';
import { MAX_DIMENSIONS_PER_FLOOR } from './plan-dimensions';
import { MAX_COORDINATE, parseStoredLayout } from './schema';
import type { PinnedDimension, RoomLayout } from './types';

const pin = (id: string, ax = 0, bx = 1): PinnedDimension => ({ id, a: { x: ax, z: 0 }, b: { x: bx, z: 0 } });
const withPins = (dimensions: unknown): RoomLayout => makeLayout({ floors: [{ ...makeFloor(), dimensions } as unknown as RoomLayout['floors'][number]] });

describe('pinned dimensions in a stored house (#921)', () => {
  it('loads a house with pins as it was saved', () => {
    const layout = withPins([pin('a'), { ...pin('b', -2, 3), offset: 0.5 }]);
    expect(parseStoredLayout(layout)).toBe(layout);
  });

  it('loads an old save with no pins unchanged', () => {
    const layout = makeLayout();
    expect(parseStoredLayout(layout)).toBe(layout);
  });

  it('drops a bad pin, never the house', () => {
    const parsed = parseStoredLayout(withPins([pin('a'), { id: 'b', a: { x: 'x', z: 0 }, b: { x: 1, z: 0 } }, pin('a', 2, 3), { id: 'c', a: { x: 1, z: 1 }, b: { x: 1, z: 1 } }]));
    expect(parsed?.floors[0]!.dimensions).toEqual([pin('a')]);
  });

  it('drops the key when nothing usable is left, or it is not a list', () => {
    expect(parseStoredLayout(withPins('lots'))?.floors[0]).not.toHaveProperty('dimensions');
    expect(parseStoredLayout(withPins([{ nope: true }]))?.floors[0]).not.toHaveProperty('dimensions');
  });

  it('strips unknown keys, brings numbers into range and caps the count', () => {
    const parsed = parseStoredLayout(withPins([{ ...pin('a', 0, 1e9), offset: 40, extra: 'x' }]));
    expect(parsed?.floors[0]!.dimensions).toEqual([{ id: 'a', a: { x: 0, z: 0 }, b: { x: MAX_COORDINATE, z: 0 }, offset: 5 }]);
    const many = Array.from({ length: MAX_DIMENSIONS_PER_FLOOR + 5 }, (_, index) => pin(`p${index}`));
    expect(parseStoredLayout(withPins(many))?.floors[0]!.dimensions).toHaveLength(MAX_DIMENSIONS_PER_FLOOR);
  });
});
