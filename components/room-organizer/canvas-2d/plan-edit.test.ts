import { describe, expect, it } from 'vitest';
import { MIN_ZONE_SIZE, zoneInPorch } from '../lib/zones';
import { draggedZoneRect, hitInteriorWall, zoneAt, zoneGripAt } from './plan-edit';
import type { EntrancePlanOutline } from '../lib/street';
import type { InteriorWall, RoomZone } from '../lib/types';

const across: InteriorWall = { id: 'across', x1: -2, z1: 0, x2: 2, z2: 0 };
const down: InteriorWall = { id: 'down', x1: 1, z1: -3, x2: 1, z2: 3 };

describe('hitInteriorWall (#564)', () => {
  it('finds a wall within its thickness and misses past it', () => {
    expect(hitInteriorWall([across], 0, 0.07)?.id).toBe('across');
    expect(hitInteriorWall([across], 0, 0.2)).toBeNull();
  });

  it('widens the target by the slop', () => {
    expect(hitInteriorWall([across], 0, 0.2, 0.15)?.id).toBe('across');
  });

  it('does not reach past the end of the wall', () => {
    expect(hitInteriorWall([across], 2.3, 0, 0.1)).toBeNull();
  });

  it('takes the nearest of two walls', () => {
    expect(hitInteriorWall([across, down], 0.9, 0.05, 0.2)?.id).toBe('across');
    expect(hitInteriorWall([across, down], 0.95, 0.15, 0.2)?.id).toBe('down');
  });

  it('survives a zero-length wall', () => {
    expect(hitInteriorWall([{ id: 'dot', x1: 1, z1: 1, x2: 1, z2: 1 }], 1, 1)?.id).toBe('dot');
  });
});

describe('zoneGripAt (#628)', () => {
  const zone = { x: -1, z: -1, w: 2, d: 2 };

  it.each([
    [-1, -1, 'nw'],
    [1, -1, 'ne'],
    [1, 1, 'se'],
    [-1, 1, 'sw'],
    [0, -1, 'n'],
    [1, 0, 'e'],
    [0, 1, 's'],
    [-1, 0, 'w'],
    [0, 0, 'move'],
  ])('at (%d, %d) takes %s', (x, z, grip) => {
    expect(zoneGripAt(zone, x, z, 0.1)).toBe(grip);
  });

  it('reaches past the edge by the slop, and no further', () => {
    expect(zoneGripAt(zone, 1.05, 0, 0.1)).toBe('e');
    expect(zoneGripAt(zone, 1.2, 0, 0.1)).toBeNull();
  });

  it('gives the drawn handles a wider reach than the rest of the edge', () => {
    expect(zoneGripAt(zone, 1.3, 0, 0.1, 0.4)).toBe('e');
    expect(zoneGripAt(zone, 1.3, -1.3, 0.1, 0.4)).toBe('ne');
    expect(zoneGripAt(zone, 1.3, 0.45, 0.1, 0.4)).toBeNull();
    expect(zoneGripAt(zone, 0.5, 0.2, 0.1, 0.4)).toBe('move');
  });

  it('keeps a middle in a zone thinner than a finger', () => {
    const thin = { x: 0, z: 0, w: 0.3, d: 3 };
    expect(zoneGripAt(thin, 0.15, 1.5, 0.5)).toBe('move');
    expect(zoneGripAt(thin, 0.05, 1.5, 0.5)).toBe('w');
    expect(zoneGripAt(thin, 0.25, 1.5, 0.5)).toBe('e');
  });
});

describe('zoneAt (#628)', () => {
  const zones: RoomZone[] = [
    { id: 'under', name: 'A', color: '#000', x: -2, z: -2, w: 4, d: 4 },
    { id: 'over', name: 'B', color: '#000', x: 0, z: 0, w: 1, d: 1 },
  ];

  it('picks the zone painted last', () => {
    expect(zoneAt(zones, 0.5, 0.5)?.id).toBe('over');
    expect(zoneAt(zones, -1, -1)?.id).toBe('under');
    expect(zoneAt(zones, 3, 3)).toBeNull();
  });

  it('steps down the stack, then off it', () => {
    expect(zoneAt(zones, 0.5, 0.5, 'over')?.id).toBe('under');
    expect(zoneAt(zones, 0.5, 0.5, 'under')).toBeNull();
  });
});

describe('draggedZoneRect (#628)', () => {
  const zone = { x: -1, z: -1, w: 2, d: 2 };
  const drag = (grip: Parameters<typeof draggedZoneRect>[1], dx: number, dz: number) => draggedZoneRect(zone, grip, dx, dz, 10, 8);

  it('moves on the zone grid with its size kept', () => {
    expect(drag('move', 1.04, 0.26)).toEqual({ x: 0, z: -0.7, w: 2, d: 2 });
  });

  it('stops a move at the walls with its size kept', () => {
    expect(drag('move', 100, -100)).toEqual({ x: 3, z: -4, w: 2, d: 2 });
    expect(drag('move', -100, 100)).toEqual({ x: -5, z: 2, w: 2, d: 2 });
  });

  it('moves only the edges the grip holds', () => {
    expect(drag('e', 1, 5)).toEqual({ x: -1, z: -1, w: 3, d: 2 });
    expect(drag('n', 5, 0.5)).toEqual({ x: -1, z: -0.5, w: 2, d: 1.5 });
    expect(drag('sw', -1, 1)).toEqual({ x: -2, z: -1, w: 3, d: 3 });
  });

  it('never turns a zone inside out or below the minimum', () => {
    const rect = drag('w', 50, 0)!;
    expect(rect.w).toBeCloseTo(MIN_ZONE_SIZE, 9);
    expect(rect.x + rect.w).toBeCloseTo(1, 9);
  });

  it('stops a resize at the wall', () => {
    expect(drag('e', 100, 0)).toEqual({ x: -1, z: -1, w: 6, d: 2 });
  });
});

describe('draggedZoneRect and the porch (#582, #628)', () => {
  const recess: EntrancePlanOutline = { x0: -1, x1: 1, frontZ: -4, backZ: -2 };
  const room = { x: -1, z: -2, w: 2, d: 2 };

  it('holds a zone that would end up on the porch', () => {
    expect(zoneInPorch({ x: -1, z: -4, w: 2, d: 2 }, recess)).toBe(true);
    expect(draggedZoneRect(room, 'move', 0, -2, 10, 8, recess)).toBeNull();
  });

  it('lets it go anywhere else, and overlap the porch while room is left', () => {
    expect(draggedZoneRect(room, 'move', 3, 0, 10, 8, recess)).toEqual({ x: 2, z: -2, w: 2, d: 2 });
    expect(draggedZoneRect(room, 'move', 1, -1, 10, 8, recess)).toEqual({ x: 0, z: -3, w: 2, d: 2 });
  });

  it('does not hold a zone already on the porch, which an entrance can do to it', () => {
    const onPorch = { x: -1, z: -4, w: 2, d: 2 };
    expect(draggedZoneRect(onPorch, 'move', 0.5, 0, 10, 8, recess)).toEqual({ x: -0.5, z: -4, w: 2, d: 2 });
  });
});
