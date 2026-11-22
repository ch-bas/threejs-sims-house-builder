import { describe, expect, it } from 'vitest';
import { makeFloor } from './__testfixtures__/fixtures';
import { DEFAULT_PIN_OFFSET, clampDimension, defaultPinOffset, dimensionOutsideWalls, dimensionsAfterFootprint, isPinnedDimension, withDimensions } from './plan-dimensions';
import type { PinnedDimension } from './types';

const pin = (a: [number, number], b: [number, number], extra: Partial<PinnedDimension> = {}): PinnedDimension => ({
  id: 'p1',
  a: { x: a[0], z: a[1] },
  b: { x: b[0], z: b[1] },
  ...extra,
});

describe('isPinnedDimension (#921)', () => {
  it('takes an id and two finite points far enough apart', () => {
    expect(isPinnedDimension(pin([0, 0], [1, 0]))).toBe(true);
    expect(isPinnedDimension(pin([0, 0], [1, 0], { offset: -0.5 }))).toBe(true);
  });

  it.each([
    ['no id', { a: { x: 0, z: 0 }, b: { x: 1, z: 0 } }],
    ['an empty id', { id: '', a: { x: 0, z: 0 }, b: { x: 1, z: 0 } }],
    ['a NaN point', { id: 'p', a: { x: Number.NaN, z: 0 }, b: { x: 1, z: 0 } }],
    ['a missing point', { id: 'p', a: { x: 0, z: 0 } }],
    ['a zero length', { id: 'p', a: { x: 1, z: 1 }, b: { x: 1, z: 1 } }],
    ['a string offset', { id: 'p', a: { x: 0, z: 0 }, b: { x: 1, z: 0 }, offset: '1' }],
    ['null', null],
  ])('refuses %s', (_name, value) => {
    expect(isPinnedDimension(value)).toBe(false);
  });
});

describe('clampDimension', () => {
  const clamp = (value: number) => Math.max(-100, Math.min(100, value));

  it('returns the pin itself when it is in range', () => {
    const p = pin([0, 0], [1, 0], { offset: 0.4 });
    expect(clampDimension(p, clamp)).toBe(p);
  });

  it('brings points and the offset into range, and drops a zero offset', () => {
    expect(clampDimension(pin([0, 0], [500, 0], { offset: 9 }), clamp)).toEqual(pin([0, 0], [100, 0], { offset: 5 }));
    expect(clampDimension(pin([0, 0], [1, 0], { offset: 0 }), clamp)).toEqual(pin([0, 0], [1, 0]));
  });
});

describe('dimensionsAfterFootprint (#921)', () => {
  const from = { width: 10, height: 8 };

  it('moves an end on an outer wall with that wall, and keeps ends inside and in the garden', () => {
    // From the west wall to a sofa, and from the east wall out to a tree.
    const dims = [pin([-5, 1], [-2, 1]), pin([5, 0], [8, 0], { id: 'p2' })];
    const after = dimensionsAfterFootprint(dims, from, { width: 12, height: 8 });
    expect(after).toEqual([pin([-6, 1], [-2, 1]), pin([6, 0], [8, 0], { id: 'p2' })]);
  });

  it('keeps an end that stood inside the house inside the smaller one', () => {
    const after = dimensionsAfterFootprint([pin([-4.5, 0], [0, 0])], from, { width: 6, height: 8 });
    expect(after).toEqual([pin([-3, 0], [0, 0])]);
  });

  it('keeps ends out of a corner cut into the house', () => {
    const cut = { ...from, cutout: { corner: 'ne' as const, width: 4, depth: 3 } };
    const [moved] = dimensionsAfterFootprint([pin([0, 0], [4, -3.5])], from, cut);
    expect(moved?.b.x === 1 || moved?.b.z === -1).toBe(true);
  });

  it('moves an end on an L’s notch wall with it when the house is resized', () => {
    const l = { width: 10, height: 8, cutout: { corner: 'ne' as const, width: 4, depth: 3 } };
    // From the notch's west wall (x = 1) and its south wall (z = -1) to the room.
    const dims = [pin([1, -2.5], [-3, -2.5]), pin([2.5, -1], [2.5, 2], { id: 'p2' })];
    const after = dimensionsAfterFootprint(dims, l, { ...l, width: 12, height: 10 });
    expect(after[0]!.a).toEqual({ x: 2, z: -2.5 });
    expect(after[1]!.a).toEqual({ x: 2.5, z: -2 });
  });

  it('drops a pin squeezed to nothing, and returns the list itself when nothing moves', () => {
    expect(dimensionsAfterFootprint([pin([4, 0], [5, 0])], from, { width: 6, height: 8 })).toEqual([]);
    const dims = [pin([-1, 0], [1, 0])];
    expect(dimensionsAfterFootprint(dims, from, { width: 12, height: 9 })).toBe(dims);
  });
});

describe('withDimensions', () => {
  it('drops the key when no pin is left', () => {
    expect('dimensions' in withDimensions(makeFloor({ dimensions: [pin([0, 0], [1, 0])] }), [])).toBe(false);
    expect(withDimensions(makeFloor(), [pin([0, 0], [1, 0])]).dimensions).toHaveLength(1);
  });
});

describe('defaultPinOffset and dimensionOutsideWalls', () => {
  it('stands a new pin off towards the top of the sheet, or its left', () => {
    const line = (offset: number, a: [number, number], b: [number, number]) => ({ offset, a, b });
    for (const { offset, a, b } of [line(-DEFAULT_PIN_OFFSET, [0, 0], [1, 0]), line(DEFAULT_PIN_OFFSET, [1, 0], [0, 0]), line(-DEFAULT_PIN_OFFSET, [0, 1], [0, 0])]) {
      expect(defaultPinOffset({ x: a[0], z: a[1] }, { x: b[0], z: b[1] })).toBe(offset);
    }
  });

  it('measures how far the furthest end sits outside the walls', () => {
    expect(dimensionOutsideWalls({ width: 10, height: 8 }, pin([0, 0], [8, 0]), 0.05)).toBe(3);
    expect(dimensionOutsideWalls({ width: 10, height: 8 }, pin([0, 0], [5.03, 0]), 0.05)).toBe(0);
  });
});
