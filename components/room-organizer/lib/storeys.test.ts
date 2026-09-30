import { describe, expect, it } from 'vitest';
import { WINDOW_SILL_HEIGHT } from './constants';
import {
  CAMERA_CEILING_CLEARANCE,
  MAX_STOREY_HEIGHT,
  MIN_STOREY_HEIGHT,
  buildingHeight,
  OPENING_HEAD_CLEARANCE,
  clampStoreyHeight,
  fitOpeningToStorey,
  floorElevation,
  interiorWallHeight,
  isStoreyHeight,
  stairRise,
  storeyHeight,
} from './storeys';
import { FLOOR_HEIGHT_METERS } from './types';

describe('storey heights (#202)', () => {
  it('stacks legacy floors exactly at index × 3 m', () => {
    const floors = [{}, {}, {}];
    expect([0, 1, 2, 3].map((i) => floorElevation(floors, i))).toEqual([0, 3, 6, 9]);
    expect(buildingHeight(floors)).toBe(3 * FLOOR_HEIGHT_METERS);
    expect(interiorWallHeight(floors[0])).toBeCloseTo(2.6);
  });

  it('sums mixed storey heights for elevations and the roof base', () => {
    const floors = [{ height: 2.5 }, {}, { height: 1.1 }];
    expect(floorElevation(floors, 0)).toBe(0);
    expect(floorElevation(floors, 1)).toBe(2.5);
    expect(floorElevation(floors, 2)).toBe(5.5);
    expect(buildingHeight(floors)).toBeCloseTo(6.6);
  });

  it('clamps out-of-range elevation indices to the building', () => {
    expect(floorElevation([{}, {}], 9)).toBe(6);
    expect(floorElevation([{}, {}], -1)).toBe(0);
  });

  it('keeps interior walls inside short storeys', () => {
    expect(interiorWallHeight({ height: 2.5 })).toBeCloseTo(2.1);
    expect(interiorWallHeight({ height: 1.1 })).toBeCloseTo(0.7);
    expect(interiorWallHeight({ height: MIN_STOREY_HEIGHT })).toBeLessThan(MIN_STOREY_HEIGHT);
  });

  it('builds stairs to the storey above only when the storey height is explicit', () => {
    expect(stairRise({ height: 3 }, {})).toBe(3);
    expect(stairRise({ height: 2.8 }, undefined)).toBe(2.8);
    expect(stairRise({ height: 3 }, { height: 2.5 })).toBe(2.5);
  });

  it('validates and clamps heights to the allowed range', () => {
    expect(isStoreyHeight(2.5)).toBe(true);
    expect(isStoreyHeight(MIN_STOREY_HEIGHT - 0.01)).toBe(false);
    expect(isStoreyHeight(MAX_STOREY_HEIGHT + 0.01)).toBe(false);
    expect(isStoreyHeight(Number.NaN)).toBe(false);
    expect(isStoreyHeight('3')).toBe(false);
    expect(clampStoreyHeight(0)).toBe(MIN_STOREY_HEIGHT);
    expect(clampStoreyHeight(99)).toBe(MAX_STOREY_HEIGHT);
    expect(clampStoreyHeight(Number.NaN)).toBe(FLOOR_HEIGHT_METERS);
    expect(storeyHeight({ height: 2.5 })).toBe(2.5);
  });
});

describe('fitOpeningToStorey (#277)', () => {
  const door = { type: 'door', height: 2.05 } as const;
  const window = { type: 'window', height: 1.2 } as const;
  const camera = { type: 'security-camera', height: 2.4 } as const;

  it('leaves every catalog opening untouched on a classic 3 m storey', () => {
    expect(fitOpeningToStorey(door, FLOOR_HEIGHT_METERS)).toEqual({ sill: 0, height: 2.05 });
    expect(fitOpeningToStorey(window, FLOOR_HEIGHT_METERS)).toEqual({ sill: WINDOW_SILL_HEIGHT, height: 1.2 });
    expect(fitOpeningToStorey({ ...window, sillHeight: 0.4 }, FLOOR_HEIGHT_METERS)).toEqual({ sill: 0.4, height: 1.2 });
    expect(fitOpeningToStorey(camera, FLOOR_HEIGHT_METERS)).toEqual({ sill: 0, height: 2.4 });
  });

  it('cuts a door down to the head clearance on a 2 m storey', () => {
    const fitted = fitOpeningToStorey(door, 2);
    expect(fitted.sill).toBe(0);
    expect(fitted.height).toBeCloseTo(2 - OPENING_HEAD_CLEARANCE);
  });

  it('drops a window sill first, then trims the frame, on a 2 m storey', () => {
    // Hole and mesh were 0.80–1.95 m vs 0.90–2.10 m; both now read this.
    const fitted = fitOpeningToStorey(window, 2);
    expect(fitted.sill).toBeCloseTo(0.8);
    expect(fitted.height).toBeCloseTo(1.15);
    expect(fitted.sill + fitted.height).toBeCloseTo(2 - OPENING_HEAD_CLEARANCE);
  });

  it('puts a window on the floor of a 1.1 m loft knee wall', () => {
    const fitted = fitOpeningToStorey(window, 1.1);
    expect(fitted.sill).toBe(0);
    expect(fitted.height).toBeCloseTo(1.05);
    expect(fitOpeningToStorey(door, 1.1).height).toBeCloseTo(1.05);
  });

  it('shortens a wall camera mount run to the storey, with room for the head', () => {
    expect(fitOpeningToStorey(camera, 1.1).sill).toBe(0);
    expect(fitOpeningToStorey(camera, 1.1).height).toBeCloseTo(1.1 - CAMERA_CEILING_CLEARANCE);
    expect(fitOpeningToStorey(camera, 2).height).toBeCloseTo(1.85);
  });

  it('never returns a negative height', () => {
    expect(fitOpeningToStorey(door, 0.02).height).toBe(0);
  });
});
