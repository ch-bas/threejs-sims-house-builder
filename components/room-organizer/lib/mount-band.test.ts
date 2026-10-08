import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { WINDOW_SILL_HEIGHT } from './constants';
import { isCeilingHung, isWallHung, mountBand, pendantBulbY } from './mount-band';

describe('isWallHung (#376, #470)', () => {
  it('covers the hung decor family and the ceiling pendant only', () => {
    for (const type of ['painting', 'mirror', 'wall-shelf', 'wall-clock', 'curtains', 'pendant-light']) expect(isWallHung(type)).toBe(true);
    for (const type of ['sofa', 'window', 'door', 'security-camera', 'lamp', 'rug']) expect(isWallHung(type)).toBe(false);
  });
});

describe('mountBand (#376)', () => {
  it('matches the hanging heights the mesh builders use', () => {
    expect(mountBand(makeItem({ type: 'painting', height: 0.6 }))).toEqual({ bottom: 0.8, top: 1.4 });
    expect(mountBand(makeItem({ type: 'mirror', height: 1.2 }))).toEqual({ bottom: 0.4, top: 1.6 });
    const clock = mountBand(makeItem({ type: 'wall-clock', height: 0.5 }));
    expect(clock.bottom).toBeCloseTo(1.25);
    expect(clock.top).toBeCloseTo(1.75);
    const shelf = mountBand(makeItem({ type: 'wall-shelf', height: 0.06 }));
    expect(shelf.bottom).toBeCloseTo(0.99);
    expect(shelf.top).toBeCloseTo(1.38);
    const curtains = mountBand(makeItem({ type: 'curtains', height: 2.4 }));
    expect(curtains.bottom).toBeCloseTo(0.06);
    expect(curtains.top).toBeCloseTo(2.4);
  });

  it('hangs a pendant light down from the ceiling (#470)', () => {
    expect(mountBand(makeItem({ type: 'pendant-light', height: 1 }))).toEqual({ bottom: 2, top: 3 });
    expect(mountBand(makeItem({ type: 'pendant-light', height: 1 }), 2.5)).toEqual({ bottom: 1.5, top: 2.5 });
    expect(mountBand(makeItem({ type: 'pendant-light', height: 2 }), 1.5)).toEqual({ bottom: 0, top: 1.5 });
  });

  it('puts the pendant bulb inside the shade at the bottom of the drop (#470)', () => {
    const pendant = makeItem({ type: 'pendant-light', height: 1 });
    for (const ceiling of [2.4, 3, 4.5]) {
      const band = mountBand(pendant, ceiling);
      const y = pendantBulbY(pendant, ceiling);
      expect(y).toBeGreaterThan(band.bottom);
      expect(y).toBeLessThan(band.bottom + 0.18);
      expect(y).toBeCloseTo(ceiling - 1 + 0.18 * 0.55, 6);
    }
    expect(isCeilingHung('pendant-light')).toBe(true);
    expect(isCeilingHung('painting')).toBe(false);
  });

  it('starts a window at its sill', () => {
    expect(mountBand(makeItem({ type: 'window', height: 1.2 }))).toEqual({
      bottom: WINDOW_SILL_HEIGHT,
      top: WINDOW_SILL_HEIGHT + 1.2,
    });
    expect(mountBand(makeItem({ type: 'window', height: 1, sillHeight: 0.5 }))).toEqual({ bottom: 0.5, top: 1.5 });
  });

  it('stands everything else on the floor', () => {
    expect(mountBand(makeItem({ type: 'sofa', height: 0.8 }))).toEqual({ bottom: 0, top: 0.8 });
  });
});
