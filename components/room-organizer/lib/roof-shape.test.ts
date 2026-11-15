import { describe, expect, it } from 'vitest';
import { makeLayout } from './__testfixtures__/fixtures';
import {
  MAX_ROOF_PITCH,
  MIN_ROOF_PITCH,
  TURNED_SIDE,
  clampRoofPitch,
  ridgeAlongX,
  roofPeakHeight,
  roofPitchDegrees,
  roofSlopes,
} from './roof-shape';
import { parseStoredLayout } from './schema';
import type { RoofSpec, WallId } from './types';

describe('roof shape (#916)', () => {
  it('keeps today’s peaks without a pitch or a ridge', () => {
    // Gable: half the shorter span with the eaves, at most 2.5 m.
    expect(roofPeakHeight('gable', 10, 8)).toBeCloseTo(2.5);
    expect(roofPeakHeight('gable', 6, 4)).toBeCloseTo(2.35);
    // Hipped: 0.45 of the shorter side with the eaves, at most 2.2 m.
    expect(roofPeakHeight('hipped', 10, 8)).toBeCloseTo(2.2);
    expect(roofPeakHeight('hipped', 5, 3)).toBeCloseTo(3.7 * 0.45);
    expect(roofPeakHeight('flat', 10, 8)).toBeCloseTo(0.2);
    expect(roofPeakHeight('none', 10, 8)).toBe(0);
    expect(roofPeakHeight({ style: 'gable', pitch: 1 }, 6, 4)).toBe(roofPeakHeight('gable', 6, 4));
  });

  it('scales a pitched roof by its pitch, and only a pitched one', () => {
    expect(roofPeakHeight({ style: 'gable', pitch: 1.4 }, 10, 8)).toBeCloseTo(3.5);
    expect(roofPeakHeight({ style: 'hipped', pitch: 0.5 }, 10, 8)).toBeCloseTo(1.1);
    expect(roofPeakHeight({ style: 'flat', pitch: 1.6 }, 10, 8)).toBeCloseTo(0.2);
    // Out of range is clamped, so no caller can build a needle or a sheet.
    expect(roofPeakHeight({ style: 'gable', pitch: 9 }, 10, 8)).toBeCloseTo(2.5 * MAX_ROOF_PITCH);
  });

  it('runs the ridge along the longer side unless the roof says otherwise', () => {
    expect(ridgeAlongX('gable', 10, 8)).toBe(true);
    expect(ridgeAlongX('gable', 6, 9)).toBe(false);
    expect(ridgeAlongX({ style: 'gable', ridge: 'z' }, 10, 8)).toBe(false);
    expect(ridgeAlongX({ style: 'gable', ridge: 'x' }, 6, 9)).toBe(true);
    // Only a gable has a ridge to turn.
    expect(ridgeAlongX({ style: 'hipped', ridge: 'z' }, 10, 8)).toBe(true);
  });

  it('measures a turned gable’s rise across its new span', () => {
    // A narrow front: 5 m wide, 12 m deep. The ridge turned to run east–west
    // spans the 12 m depth, so the 2.5 m cap holds; along the depth it spans 5.7 m.
    expect(roofPeakHeight('gable', 5, 12)).toBeCloseTo(2.5);
    expect(roofPeakHeight({ style: 'gable', ridge: 'x' }, 5, 12)).toBeCloseTo(2.5);
    expect(roofPeakHeight('gable', 3, 12)).toBeCloseTo(1.85);
    expect(roofPeakHeight({ style: 'gable', ridge: 'x' }, 3, 12)).toBeCloseTo(2.5);
  });

  it('slopes a gable down to the sides either side of its ridge', () => {
    const sides: WallId[] = ['north', 'south', 'east', 'west'];
    const sloped = (roof: RoofSpec) => sides.filter((side) => roofSlopes(roof, 10, 8, side));
    expect(sloped({ style: 'gable' })).toEqual(['north', 'south']);
    expect(sloped({ style: 'gable', ridge: 'z' })).toEqual(['east', 'west']);
    expect(sloped({ style: 'hipped', ridge: 'z' })).toEqual(sides);
    expect(sloped({ style: 'flat' })).toEqual([]);
  });

  it('turns dormer sides both ways, so turning back restores them', () => {
    for (const side of ['north', 'south', 'east', 'west'] as const) {
      expect(TURNED_SIDE[TURNED_SIDE[side]]).toBe(side);
      // A slope on one axis lands on the other.
      expect(side === 'north' || side === 'south').not.toBe(TURNED_SIDE[side] === 'north' || TURNED_SIDE[side] === 'south');
    }
  });

  it('names the pitch in degrees', () => {
    // 2.5 m over a 4.35 m half span.
    expect(roofPitchDegrees('gable', 10, 8)).toBeCloseTo((Math.atan2(2.5, 4.35) * 180) / Math.PI);
    expect(roofPitchDegrees({ style: 'gable', pitch: 1.6 }, 10, 8)).toBeGreaterThan(roofPitchDegrees('gable', 10, 8));
    expect(roofPitchDegrees('flat', 10, 8)).toBe(0);
  });

  it('clamps a pitch into range, and anything else to the default', () => {
    expect(clampRoofPitch(0.1)).toBe(MIN_ROOF_PITCH);
    expect(clampRoofPitch(5)).toBe(MAX_ROOF_PITCH);
    expect(clampRoofPitch(1.2)).toBe(1.2);
    expect(clampRoofPitch(Number.NaN)).toBe(1);
    expect(clampRoofPitch('2')).toBe(1);
  });
});

describe('roof shape in saved houses (#916)', () => {
  it('loads an old roof unchanged', () => {
    const roof: RoofSpec = { style: 'gable', color: '#5d3a23' };
    expect(parseStoredLayout(makeLayout({ roof }))!.roof).toEqual(roof);
  });

  it('keeps a pitch and a ridge, clamping the pitch', () => {
    expect(parseStoredLayout(makeLayout({ roof: { style: 'gable', pitch: 1.3, ridge: 'z' } }))!.roof).toEqual({
      style: 'gable',
      pitch: 1.3,
      ridge: 'z',
    });
    expect(parseStoredLayout(makeLayout({ roof: { style: 'hipped', pitch: 40 } }))!.roof).toEqual({ style: 'hipped', pitch: MAX_ROOF_PITCH });
  });

  it('drops a pitch that isn’t a number and a ridge that isn’t an axis, keeping the roof', () => {
    const roof = { style: 'gable', color: '#123456', pitch: 'steep', ridge: 'y' } as unknown as RoofSpec;
    expect(parseStoredLayout(makeLayout({ roof }))!.roof).toEqual({ style: 'gable', color: '#123456' });
    const infinite = { style: 'gable', pitch: Number.POSITIVE_INFINITY, ridge: 'x' } as RoofSpec;
    expect(parseStoredLayout(makeLayout({ roof: infinite }))!.roof).toEqual({ style: 'gable', ridge: 'x' });
  });
});
