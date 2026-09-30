import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { MAX_ROOM_DIMENSION } from './constants';
import {
  MIN_ZONE_SIZE,
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
    const unplaced = makeItem({ id: 'none', position: undefined });
    expect(itemsInZone(bedroom, [inside, straddling, unplaced]).map((item) => item.id)).toEqual(['in']);
  });

  it('zoneArea is w × d and zoneStats sums the prices of the items inside', () => {
    expect(zoneArea(bedroom)).toBeCloseTo(7.5);
    const items = [
      makeItem({ id: 'bed', price: 800, position: { x: -3, z: -2 } }),
      makeItem({ id: 'lamp', price: 45, position: { x: -1.5, z: -1 } }),
      makeItem({ id: 'sofa', price: 1200, position: { x: 2, z: 2 } }),
      makeItem({ id: 'free', position: { x: -2, z: -2 } }),
    ];
    expect(zoneStats(bedroom, items)).toEqual({ itemCount: 3, cost: 845, area: 7.5 });
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
