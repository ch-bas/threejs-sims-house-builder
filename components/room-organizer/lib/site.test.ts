import { describe, expect, it } from 'vitest';
import {
  MAX_STREET_SEED,
  MAX_TERRAIN_Y,
  MIN_TERRAIN_Y,
  clampTerrainY,
  groundHeightAt,
  hasNeighbourOn,
  hasNeighbours,
  isStreetSeed,
  isTerrainY,
  lowestGround,
  neighbourSides,
  outdoorGroundSize,
  roadEdges,
} from './site';

describe('site helpers (#202)', () => {
  const hill = { frontY: 2.5, backY: 0 };

  it('is flat at the ground floor without a terrain', () => {
    expect(groundHeightAt(undefined, -10, 4)).toBe(0);
    expect(groundHeightAt(undefined, 3, 4)).toBe(0);
    expect(lowestGround(undefined)).toBe(0);
  });

  it('holds street level in front, garden level behind, and slopes along the house', () => {
    expect(groundHeightAt(hill, -20, 4)).toBe(2.5);
    expect(groundHeightAt(hill, -4, 4)).toBe(2.5);
    expect(groundHeightAt(hill, 0, 4)).toBeCloseTo(1.25);
    expect(groundHeightAt(hill, 4, 4)).toBe(0);
    expect(groundHeightAt(hill, 20, 4)).toBe(0);
  });

  it('reports how deep a plinth must reach on a falling site', () => {
    expect(lowestGround(hill)).toBe(0);
    expect(lowestGround({ frontY: 0, backY: -1.5 })).toBe(-1.5);
  });

  it('validates and clamps ground heights', () => {
    expect(isTerrainY(-1)).toBe(true);
    expect(isTerrainY(MIN_TERRAIN_Y - 0.1)).toBe(false);
    expect(isTerrainY(MAX_TERRAIN_Y + 0.1)).toBe(false);
    expect(isTerrainY(Number.NaN)).toBe(false);
    expect(isTerrainY('1')).toBe(false);
    expect(clampTerrainY(99)).toBe(MAX_TERRAIN_Y);
    expect(clampTerrainY(-99)).toBe(MIN_TERRAIN_Y);
    expect(clampTerrainY(Number.NaN)).toBe(0);
  });

  it('lists only the sides that have a neighbour', () => {
    expect(neighbourSides(undefined)).toEqual([]);
    expect(neighbourSides({ east: true })).toEqual(['east']);
    expect(neighbourSides({ west: true, east: false })).toEqual(['west']);
    expect(neighbourSides({ west: true, east: true })).toEqual(['west', 'east']);
  });

  it('knows when the street has anything on it, and which side a house stands on (#310)', () => {
    expect(hasNeighbours(undefined)).toBe(false);
    expect(hasNeighbours({ seed: 4 })).toBe(false);
    expect(hasNeighbours({ across: true })).toBe(true);
    expect(hasNeighbourOn({ east: true }, 'east')).toBe(true);
    expect(hasNeighbourOn({ east: true }, 'west')).toBe(false);
    expect(hasNeighbourOn({ street: true }, 'west')).toBe(true);
    expect(hasNeighbourOn({ across: true }, 'west')).toBe(false);
  });

  it('accepts only whole seeds the PRNG can take', () => {
    expect(isStreetSeed(0)).toBe(true);
    expect(isStreetSeed(MAX_STREET_SEED)).toBe(true);
    expect(isStreetSeed(MAX_STREET_SEED + 1)).toBe(false);
    expect(isStreetSeed(-1)).toBe(false);
    expect(isStreetSeed(1.5)).toBe(false);
    expect(isStreetSeed('7')).toBe(false);
  });

  it('places the road where the lot scenery draws it', () => {
    expect(outdoorGroundSize(8, 6)).toBe(60);
    expect(roadEdges(3, undefined)).toEqual({ near: 10.6, far: expect.closeTo(16.7, 5) });
    expect(roadEdges(3, 'garden')).toEqual(roadEdges(3, undefined));
    expect(roadEdges(3, 'pavement')).toEqual({ near: 3, far: expect.closeTo(9.1, 5) });
  });
});
