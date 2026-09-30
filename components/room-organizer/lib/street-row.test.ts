import { describe, expect, it } from 'vitest';
import { PAVEMENT_DEPTH, groundHeightAt, roadEdges } from './site';
import {
  MAX_WINDOWS_PER_FACE,
  PARTY_WALL_GAP,
  generateStreet,
  streetHalfLength,
  windowCount,
  windowRow,
  type StreetSite,
} from './street-row';

const SITE: StreetSite = {
  width: 8,
  depth: 6,
  floorYs: [0, 3],
  eavesY: 6,
  roof: { style: 'gable', color: '#8d6e63' },
};

const street = (overrides: Partial<StreetSite> = {}) =>
  generateStreet({ ...SITE, neighbours: { west: true, east: true, street: true, across: true, seed: 7 }, ...overrides });

describe('street generator (#310)', () => {
  it('is empty without neighbours, and the old matched pair with only the party walls', () => {
    expect(generateStreet(SITE)).toEqual([]);
    expect(generateStreet({ ...SITE, neighbours: { west: false } })).toEqual([]);

    const pair = generateStreet({ ...SITE, neighbours: { west: true, east: true } });
    expect(pair.map((house) => house.side)).toEqual(['west', 'east']);
    for (const house of pair) {
      // Inner face a hair off our wall plane, our storeys, eaves and roof line.
      const sign = house.side === 'east' ? 1 : -1;
      expect(sign * house.x - house.width / 2).toBeCloseTo(4 + PARTY_WALL_GAP);
      expect(house.depth).toBe(6);
      expect(house.floorYs).toEqual([0, 3]);
      expect(house.eavesY).toBe(6);
      expect(house.roof).toEqual({ style: 'gable', color: '#8d6e63', pitch: 1 });
      expect(house.attached).toBe(true);
      expect(house.frontZ).toBe(-3);
    }
  });

  it('gives the same street for the same seed and a different one for another', () => {
    const a = street();
    expect(street()).toEqual(a);
    const b = street({ neighbours: { west: true, east: true, street: true, across: true, seed: 8 } });
    expect(b).not.toEqual(a);
    // Default seed when a layout has none.
    expect(street({ neighbours: { street: true } })).toEqual(street({ neighbours: { street: true, seed: 1 } }));
  });

  it('runs the row along both sides, inside the scenery, with every house within bounds', () => {
    const houses = street();
    const ours = houses.filter((house) => house.row === 'ours');
    const west = ours.filter((house) => house.x < 0);
    const east = ours.filter((house) => house.x > 0);
    expect(west.length).toBeGreaterThanOrEqual(2);
    expect(east.length).toBeGreaterThanOrEqual(2);
    expect(ours.length).toBeGreaterThanOrEqual(5);
    expect(houses.filter((house) => house.row === 'across').length).toBeGreaterThanOrEqual(3);
    const extent = streetHalfLength(8, 6);
    expect(extent).toBe(24);
    for (const house of houses) {
      expect(Math.abs(house.x) + house.width / 2).toBeLessThanOrEqual(extent);
      expect(house.width).toBeGreaterThanOrEqual(3);
      expect(house.width).toBeLessThanOrEqual(14);
      expect(house.depth).toBeGreaterThanOrEqual(4);
      expect(house.floorYs.length).toBeGreaterThanOrEqual(1);
      expect(house.floorYs.length).toBeLessThanOrEqual(3);
      expect(house.eavesY).toBeGreaterThan(house.floorYs[house.floorYs.length - 1]!);
      expect(house.roof.pitch).toBeGreaterThan(0.5);
      expect(['brick', 'render', 'plain']).toContain(house.facade.finish);
      expect(house.facade.color).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Only the party-wall pair is tagged with a side.
    expect(houses.filter((house) => house.side).map((house) => house.id)).toEqual(['w0', 'e0']);
    // Houses never overlap along their row.
    for (const row of [west, east, houses.filter((house) => house.row === 'across')]) {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i += 1) {
        const previous = sorted[i - 1]!;
        expect(sorted[i]!.x - sorted[i]!.width / 2).toBeGreaterThanOrEqual(previous.x + previous.width / 2 + PARTY_WALL_GAP - 1e-9);
      }
    }
  });

  it('opens the side walls only where a house stands free', () => {
    const houses = street();
    for (const row of [houses.filter((house) => house.row === 'ours' && house.x > 0), houses.filter((house) => house.row === 'across')]) {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i += 1) {
        const gap = sorted[i]!.x - sorted[i]!.width / 2 - (sorted[i - 1]!.x + sorted[i - 1]!.width / 2);
        const attached = gap < 0.1;
        expect(sorted[i - 1]!.openSides.east).toBe(!attached);
        expect(sorted[i]!.openSides.west).toBe(!attached);
      }
    }
    // The party-wall neighbour's inner wall is ours.
    expect(houses.find((house) => house.id === 'e0')!.openSides.west).toBe(false);
    expect(houses.find((house) => house.id === 'w0')!.openSides.east).toBe(false);
  });

  it('starts the row off a gap when the party wall itself is off', () => {
    const houses = generateStreet({ ...SITE, neighbours: { street: true, seed: 3 } });
    const first = houses.find((house) => house.id === 'e0')!;
    expect(first.side).toBeUndefined();
    expect(first.attached).toBe(false);
    expect(first.x - first.width / 2).toBeGreaterThan(4 + 1);
    expect(first.openSides.west).toBe(true);
  });

  it('mirrors the facing row across the road at the scenery’s road line', () => {
    const across = street().filter((house) => house.row === 'across');
    const road = roadEdges(3, undefined);
    for (const house of across) {
      expect(house.facing).toBe(1);
      expect(house.frontZ).toBeCloseTo(-(road.far + PAVEMENT_DEPTH + 1.2));
      expect(house.depth).toBeLessThanOrEqual(8);
    }
    const pavement = street({ frontage: 'pavement' }).filter((house) => house.row === 'across');
    expect(pavement[0]!.frontZ).toBeCloseTo(-(roadEdges(3, 'pavement').far + PAVEMENT_DEPTH));
  });

  it('sits every house on the ground under it on a sloped site (#280)', () => {
    const terrain = { frontY: 3, backY: 0 };
    const houses = street({ terrain });
    for (const house of houses) {
      if (house.row === 'ours') {
        // The terrace shares our datum and is cut into the hill like us; a
        // shallower house's back wall stands part-way down the slope.
        expect(house.groundFrontY).toBe(3);
        expect(house.groundBackY).toBeCloseTo(groundHeightAt(terrain, house.frontZ + house.depth, 3));
        expect(house.floorYs[0]).toBe(0);
      } else {
        // Across the road the ground is flat at street level; they stand on it.
        expect(house.groundFrontY).toBe(3);
        expect(house.groundBackY).toBe(3);
        expect(house.floorYs[0]).toBe(3);
      }
    }
  });

  it('caps the row for a small lot', () => {
    expect(streetHalfLength(3, 3)).toBeCloseTo(13);
    const houses = generateStreet({ ...SITE, width: 3, depth: 3, neighbours: { street: true, across: true, seed: 2 } });
    expect(houses.length).toBeGreaterThan(2);
    for (const house of houses) expect(Math.abs(house.x) + house.width / 2).toBeLessThanOrEqual(13);
  });
});

describe('window rules (#280)', () => {
  it('derives the count from the facade width', () => {
    expect(windowCount(1.3)).toBe(0);
    expect(windowCount(1.4)).toBe(1);
    expect(windowCount(2.5)).toBe(1);
    expect(windowCount(2.6)).toBe(1);
    expect(windowCount(4)).toBe(2);
    expect(windowCount(8)).toBe(4);
    expect(windowCount(100)).toBe(MAX_WINDOWS_PER_FACE);
  });

  it('places a row clear of the ground line or drops it', () => {
    expect(windowRow(0, 3, 0)).toEqual({ sillY: 0.9, height: 1.4 });
    expect(windowRow(0, 3, -2)).toEqual({ sillY: 0.9, height: 1.4 });
    // Part-buried: the sill is lifted clear of the ground and the window shortened.
    expect(windowRow(0, 3, 1.2)).toEqual({ sillY: 1.65, height: expect.closeTo(1, 5) });
    // Mostly or wholly buried: no row.
    expect(windowRow(0, 3, 1.5)).toBeNull();
    expect(windowRow(0, 3, 3)).toBeNull();
    // A loft knee wall is too low for a window.
    expect(windowRow(5.5, 6.6, 0)).toBeNull();
  });
});
