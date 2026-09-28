import { describe, expect, it } from 'vitest';
import {
  MAX_STOREY_HEIGHT,
  MIN_STOREY_HEIGHT,
  buildingHeight,
  clampStoreyHeight,
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
