import { describe, expect, it } from 'vitest';
import { makeItem, makeUnplacedItem } from './__testfixtures__/fixtures';
import { MAX_ROOM_DIMENSION } from './constants';
import { autoOrganize, hasCollisions } from './geometry';
import {
  MIN_ZONE_SIZE,
  arrangeByZone,
  ZONE_COLORS,
  clampZoneRect,
  defaultZoneName,
  isRoomZone,
  isZoneRect,
  itemsInZone,
  nextZoneColor,
  sameZone,
  zoneArea,
  zoneContains,
  zoneFromCorners,
  zoneInPorch,
  zoneStats,
} from './zones';
import type { RoomZone } from './types';

const bedroom: RoomZone = { id: 'z1', name: 'Bedroom', color: '#3b82f6', x: -4, z: -3, w: 3, d: 2.5 };

describe('zoneFromCorners (#155)', () => {
  it('normalises corners dragged in any direction into corner + size', () => {
    expect(zoneFromCorners({ x: 1, z: 2 }, { x: -1, z: -2 }, 10, 10)).toEqual({ x: -1, z: -2, w: 2, d: 4 });
    expect(zoneFromCorners({ x: -1, z: -2 }, { x: 1, z: 2 }, 10, 10)).toEqual({ x: -1, z: -2, w: 2, d: 4 });
  });

  it('rounds to 0.1 m so areas read as clean numbers', () => {
    const rect = zoneFromCorners({ x: 0.04, z: 0.06 }, { x: 2.96, z: 1.51 }, 10, 10);
    expect(rect).toEqual({ x: 0, z: 0.1, w: 3, d: 1.4 });
  });

  it('clamps to the room footprint', () => {
    const rect = zoneFromCorners({ x: -9, z: -9 }, { x: 9, z: 9 }, 8, 6);
    expect(rect).toEqual({ x: -4, z: -3, w: 8, d: 6 });
  });

  it('refuses a rectangle thinner than MIN_ZONE_SIZE on either side', () => {
    expect(zoneFromCorners({ x: 0, z: 0 }, { x: MIN_ZONE_SIZE - 0.1, z: 3 }, 10, 10)).toBeNull();
    expect(zoneFromCorners({ x: 0, z: 0 }, { x: 3, z: 0.01 }, 10, 10)).toBeNull();
    // Entirely outside the room: clamps to a zero-width sliver.
    expect(zoneFromCorners({ x: 6, z: 0 }, { x: 9, z: 2 }, 8, 8)).toBeNull();
  });

  it('fits a floor whose size is not a multiple of 10 cm, edge to edge (#618)', () => {
    // 5.05 × 4.33 m: the walls sit at ±2.525 and ±2.165.
    for (const reach of [2.525, 2.56, 9]) {
      const rect = zoneFromCorners({ x: -reach, z: -reach }, { x: reach, z: reach }, 5.05, 4.33)!;
      expect(rect.x).toBeCloseTo(-2.525, 9);
      expect(rect.z).toBeCloseTo(-2.165, 9);
      expect(rect.x + rect.w).toBeLessThanOrEqual(2.525 + 1e-9);
      expect(rect.z + rect.d).toBeLessThanOrEqual(2.165 + 1e-9);
      expect(rect.x + rect.w).toBeCloseTo(2.525, 9);
      expect(rect.z + rect.d).toBeCloseTo(2.165, 9);
    }
  });

  it('keeps a corner off the walls on the 10 cm grid (#618)', () => {
    const rect = zoneFromCorners({ x: -2.56, z: 0.04 }, { x: 1.03, z: 2.2 }, 5.05, 4.33)!;
    expect(rect.x).toBeCloseTo(-2.525, 9);
    expect(rect.x + rect.w).toBeCloseTo(1, 9);
    expect(rect.z).toBeCloseTo(0, 9);
    expect(rect.z + rect.d).toBeCloseTo(2.165, 9);
  });

  it('re-fitting a wall-to-wall zone to the same floor leaves it as it is (#618)', () => {
    const rect = zoneFromCorners({ x: -3, z: -3 }, { x: 3, z: 3 }, 5.05, 4.33)!;
    expect(clampZoneRect(rect, 5.05, 4.33)).toEqual(rect);
  });

  it('clampZoneRect re-fits a stored rectangle to a room that shrank', () => {
    expect(clampZoneRect({ x: -4, z: -3, w: 3, d: 2.5 }, 4, 4)).toEqual({ x: -2, z: -2, w: 1, d: 1.5 });
    expect(clampZoneRect({ x: Number.NaN, z: 0, w: 1, d: 1 }, 8, 8)).toBeNull();
  });
});

describe('isZoneRect / isRoomZone (#155)', () => {
  it('accepts a finite, positive, bounded rectangle with the naming fields', () => {
    expect(isZoneRect({ x: 0, z: 0, w: 1, d: 1 })).toBe(true);
    expect(isRoomZone(bedroom)).toBe(true);
  });

  it('rejects NaN / infinite corners and non-positive or absurd sizes', () => {
    expect(isZoneRect({ x: Number.NaN, z: 0, w: 1, d: 1 })).toBe(false);
    expect(isZoneRect({ x: 0, z: Number.POSITIVE_INFINITY, w: 1, d: 1 })).toBe(false);
    expect(isZoneRect({ x: 0, z: 0, w: 0, d: 1 })).toBe(false);
    expect(isZoneRect({ x: 0, z: 0, w: 1, d: -2 })).toBe(false);
    expect(isZoneRect({ x: 0, z: 0, w: MAX_ROOM_DIMENSION + 1, d: 1 })).toBe(false);
    expect(isZoneRect({ x: MAX_ROOM_DIMENSION + 1, z: 0, w: 1, d: 1 })).toBe(false);
    expect(isZoneRect({ x: '0', z: 0, w: 1, d: 1 })).toBe(false);
    expect(isZoneRect(null)).toBe(false);
  });

  it('rejects a zone missing its id, name or colour', () => {
    expect(isRoomZone({ ...bedroom, id: undefined })).toBe(false);
    expect(isRoomZone({ ...bedroom, name: 3 })).toBe(false);
    expect(isRoomZone({ ...bedroom, color: null })).toBe(false);
  });
});

describe('zone membership and stats (#155)', () => {
  it('zoneContains is inclusive on every edge', () => {
    expect(zoneContains(bedroom, -4, -3)).toBe(true);
    expect(zoneContains(bedroom, -1, -0.5)).toBe(true);
    expect(zoneContains(bedroom, -2.5, -2)).toBe(true);
    expect(zoneContains(bedroom, -0.9, -2)).toBe(false);
    expect(zoneContains(bedroom, -2.5, -3.1)).toBe(false);
  });

  it('itemsInZone counts an item by its centre only, ignoring unplaced items', () => {
    const inside = makeItem({ id: 'in', position: { x: -2.5, z: -2 } });
    // Centre just outside even though the 1×1 footprint overlaps the edge.
    const straddling = makeItem({ id: 'out', position: { x: -0.6, z: -2 } });
    const unplaced = makeUnplacedItem({ id: 'none' });
    expect(itemsInZone(bedroom, [inside, straddling, unplaced]).map((item) => item.id)).toEqual(['in']);
  });

  it('leaves the porch out of the area, a zone across it stays whole (#582)', () => {
    const recess = { x0: -0.7, x1: 0.7, frontZ: -4, backZ: -2.8 };
    const strip = { x: -4, z: -4, w: 8, d: 2 };
    expect(zoneArea(strip, recess)).toBeCloseTo(16 - 1.68);
    expect(zoneStats(strip, [], recess).area).toBeCloseTo(16 - 1.68);
    expect(zoneInPorch(strip, recess)).toBe(false);
    // Clear of the porch, or touching it: nothing to take off.
    expect(zoneArea({ x: 0.7, z: -4, w: 2, d: 1 }, recess)).toBe(2);
    expect(zoneInPorch({ x: 0.7, z: -4, w: 0.3, d: 0.3 }, recess)).toBe(false);
  });

  it('never reports a negative area for a zone wholly on the porch (#582)', () => {
    const recess = { x0: -0.7, x1: 0.7, frontZ: -4, backZ: -2.8 };
    // 0.3 × 0.6 less the overlap, in floats, comes out a hair below zero.
    const area = zoneArea({ x: -0.7, z: -4, w: 0.3, d: 0.6 }, recess);
    expect(Object.is(area, -0)).toBe(false);
    expect(area).toBeGreaterThanOrEqual(0);
    expect(area.toFixed(1)).toBe('0.0');
  });

  it('calls a zone that is all porch, or porch and a sliver, a zone in the porch (#582)', () => {
    const recess = { x0: -0.7, x1: 0.7, frontZ: -4, backZ: -2.8 };
    expect(zoneInPorch({ x: -0.5, z: -3.9, w: 1, d: 1 }, recess)).toBe(true);
    expect(zoneInPorch({ x: -0.5, z: -3.9, w: 1, d: 1.15 }, recess)).toBe(true);
    expect(zoneInPorch({ x: -0.5, z: -3.9, w: 1, d: 1.3 }, recess)).toBe(false);
    expect(zoneInPorch({ x: -0.5, z: -3.9, w: 1, d: 1 }, null)).toBe(false);
  });

  it('zoneArea is w × d and zoneStats sums the prices of the items inside', () => {
    expect(zoneArea(bedroom, null)).toBeCloseTo(7.5);
    const items = [
      makeItem({ id: 'bed', price: 800, position: { x: -3, z: -2 } }),
      makeItem({ id: 'lamp', price: 45, position: { x: -1.5, z: -1 } }),
      makeItem({ id: 'sofa', price: 1200, position: { x: 2, z: 2 } }),
      makeItem({ id: 'free', position: { x: -2, z: -2 } }),
    ];
    expect(zoneStats(bedroom, items, null)).toEqual({ itemCount: 3, cost: 845, area: 7.5 });
  });
});

describe('zone defaults (#155)', () => {
  it('nextZoneColor hands out unused palette colours first, then cycles', () => {
    expect(nextZoneColor([])).toBe(ZONE_COLORS[0]);
    expect(nextZoneColor([bedroom])).toBe(ZONE_COLORS[1]);
    const all = ZONE_COLORS.map((color, i) => ({ ...bedroom, id: `z${i}`, color }));
    expect(nextZoneColor(all)).toBe(ZONE_COLORS[0]);
  });

  it('defaultZoneName picks the first free "Zone N"', () => {
    expect(defaultZoneName([])).toBe('Zone 1');
    expect(defaultZoneName([{ ...bedroom, name: 'Zone 1' }])).toBe('Zone 2');
    expect(defaultZoneName([{ ...bedroom, name: 'Zone 2' }])).toBe('Zone 1');
  });

  it('sameZone compares every field', () => {
    expect(sameZone(bedroom, { ...bedroom })).toBe(true);
    expect(sameZone(bedroom, { ...bedroom, name: 'Study' })).toBe(false);
    expect(sameZone(bedroom, { ...bedroom, w: 3.1 })).toBe(false);
  });
});

describe('arrangeByZone (#629)', () => {
  const W = 8;
  const D = 8;
  const west: RoomZone = { id: 'w', name: 'West', color: '#000', x: -4, z: -4, w: 4, d: 8 };
  const east: RoomZone = { id: 'e', name: 'East', color: '#000', x: 0, z: -4, w: 4, d: 8 };
  const box = (id: string, x: number, z: number) => makeItem({ id, width: 0.8, depth: 0.6, height: 1, position: { x, z } });
  const items = [box('a', -1, 3), box('b', -2, 2), box('c', 2, 3), box('d', 3, -3), box('e', 1, 1)];

  it('packs each zone’s items inside that zone', () => {
    const result = arrangeByZone(items, W, D, 'shelf', { zones: [west, east] });
    expect(result.map((item) => item.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    for (const item of result) {
      const zone = ['a', 'b'].includes(item.id) ? west : east;
      const { x, z } = item.position!;
      expect(x - 0.4, item.id).toBeGreaterThanOrEqual(zone.x);
      expect(x + 0.4, item.id).toBeLessThanOrEqual(zone.x + zone.w);
      expect(z - 0.3, item.id).toBeGreaterThanOrEqual(zone.z);
      expect(z + 0.3, item.id).toBeLessThanOrEqual(zone.z + zone.d);
    }
    for (const item of result) expect(hasCollisions(item, result, W, D), item.id).toBe(false);
  });

  it('packs the items outside every zone into the space the zones leave', () => {
    const north: RoomZone = { ...west, id: 'n', x: -4, z: -4, w: 8, d: 4 };
    const result = arrangeByZone(items, W, D, 'shelf', { zones: [north] });
    for (const item of result) expect(hasCollisions(item, result, W, D), item.id).toBe(false);
    // d was the only item in the north half; the others pack south of it.
    expect(result.find((item) => item.id === 'd')!.position!.z).toBeLessThan(0);
    for (const id of ['a', 'b', 'c', 'e']) expect(result.find((item) => item.id === id)!.position!.z, id).toBeGreaterThan(0);
  });

  it('is plain autoOrganize without zones', () => {
    expect(arrangeByZone(items, W, D, 'shelf', {})).toEqual(autoOrganize(items, W, D, 'shelf'));
  });
});

describe('clampZoneRect re-fit (#618)', () => {
  it('changes nothing on a second pass, and never overshoots', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 5000; i++) {
      const w = 2 + rand() * 18;
      const d = 2 + rand() * 18;
      const a = { x: (rand() - 0.5) * w * 1.1, z: (rand() - 0.5) * d * 1.1 };
      const b = { x: (rand() - 0.5) * w * 1.1, z: (rand() - 0.5) * d * 1.1 };
      const first = zoneFromCorners(a, b, w, d);
      if (!first) continue;
      expect(clampZoneRect(first, w, d)).toEqual(first);
      expect(first.x).toBeGreaterThanOrEqual(-w / 2 - 1e-9);
      expect(first.x + first.w).toBeLessThanOrEqual(w / 2 + 1e-9);
    }
  });

  it('re-fits the reported 2.83 × 18.4986 m case unchanged', () => {
    const zone = zoneFromCorners({ x: -1, z: 4.2 }, { x: 1, z: 9.2 }, 2.83, 18.4986);
    expect(zone).not.toBeNull();
    expect(clampZoneRect(zone!, 2.83, 18.4986)).toEqual(zone);
  });
});
