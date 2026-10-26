import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { FURNITURE_CATALOG, WINDOW_SILL_HEIGHT } from './constants';
import {
  fitHungDecor,
  HUNG_CEILING_CLEARANCE,
  isCeilingHung,
  isWallHung,
  mountBand,
  PAINTING_MOUNT_Y,
  pendantBulbY,
} from './mount-band';

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

describe('mountBand on a low storey (#610)', () => {
  const decor = FURNITURE_CATALOG.filter((entry) => isWallHung(entry.type) && !isCeilingHung(entry.type));

  it('keeps every hung decor item under the ceiling of a 1.2 m loft', () => {
    expect(decor.map((entry) => entry.type).sort()).toEqual(['curtains', 'mirror', 'painting', 'wall-clock', 'wall-shelf']);
    for (const entry of decor) {
      for (const storey of [1, 1.2, 1.6, 2]) {
        const band = mountBand(makeItem({ ...entry }), storey);
        expect(band.top, `${entry.type} @ ${storey}`).toBeLessThanOrEqual(storey - HUNG_CEILING_CLEARANCE + 1e-9);
        expect(band.bottom, `${entry.type} @ ${storey}`).toBeGreaterThanOrEqual(0);
        expect(band.top).toBeGreaterThan(band.bottom);
      }
    }
  });

  it('lowers the mount point first, then shortens the item', () => {
    // Painting 0.6 m: drops from 0.8 to 0.55 and keeps its height.
    const painting = fitHungDecor(makeItem({ type: 'painting', height: 0.6 }), 1.2);
    expect(painting.mount).toBeCloseTo(0.55);
    expect(painting.height).toBe(0.6);
    const clock = mountBand(makeItem({ type: 'wall-clock', height: 0.5 }), 1.2);
    expect(clock.bottom).toBeCloseTo(0.65);
    expect(clock.top).toBeCloseTo(1.15);
    // Mirror 1.2 m: down to the floor, then cut to the room left.
    const mirror = fitHungDecor(makeItem({ type: 'mirror', height: 1.2 }), 1.2);
    expect(mirror.mount).toBe(0);
    expect(mirror.height).toBeCloseTo(1.15);
    // Curtains hang from the rod at their top, so they only get shorter.
    expect(mountBand(makeItem({ type: 'curtains', height: 2.4 }), 1.2).top).toBeCloseTo(1.15);
    // The shelf keeps its ornaments below the ceiling.
    expect(mountBand(makeItem({ type: 'wall-shelf', height: 0.06 }), 1.2).top).toBeCloseTo(1.15);
  });

  it('changes nothing on a classic 3 m storey', () => {
    for (const entry of decor) {
      const item = makeItem({ ...entry });
      expect(mountBand(item, 3)).toEqual(mountBand(item));
      expect(fitHungDecor(item, 3).height).toBe(entry.height);
    }
    expect(fitHungDecor(makeItem({ type: 'painting', height: 0.6 }), 3)).toEqual({ mount: PAINTING_MOUNT_Y, height: 0.6 });
  });
});
