import { describe, expect, it } from 'vitest';
import { makeFloor, makeLayout } from './__testfixtures__/fixtures';
import { floorArea } from './blueprint';

describe('floorArea (#285)', () => {
  it('is the footprint less the entrance porch on the storey it opens onto', () => {
    const ground = makeFloor({ id: 'ground' });
    const upper = makeFloor({ id: 'upper' });
    const plain = makeLayout({ floors: [ground, upper] });
    expect(floorArea(plain, 0)).toBe(64);
    const porch = makeLayout({ floors: [ground, upper], entrance: { width: 1.4, depth: 1.2 } });
    expect(floorArea(porch, 0)).toBeCloseTo(64 - 1.4 * 1.2);
    expect(floorArea(porch, 1)).toBe(64);
    // A recess that doesn't fit the house is fitted first, like the 3D build.
    const shallow = makeLayout({ height: 2, floors: [ground], entrance: { width: 1.4, depth: 3 } });
    expect(floorArea(shallow, 0)).toBeCloseTo(16 - 1.4 * 1);
  });
});
