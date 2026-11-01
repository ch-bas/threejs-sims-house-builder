import { describe, expect, it } from 'vitest';
import { parseWallLength, snapWallEndpoint, wallAngleDegrees, wallEndAtLength } from './wall-snap';
import type { InteriorWall } from './types';

const ROOM = { roomWidth: 10, roomDepth: 10 };

describe('snapWallEndpoint — vertex snap', () => {
  it('snaps to an existing wall endpoint within range', () => {
    const walls: InteriorWall[] = [{ id: 'w', x1: 2, z1: 2, x2: 3, z2: 3 }];
    const result = snapWallEndpoint({ point: { x: 2.1, z: 1.9 }, existingWalls: walls, ...ROOM });
    expect(result.kind).toBe('vertex');
    expect(result.point).toEqual({ x: 2, z: 2 });
  });

  it('snaps to a building corner', () => {
    const result = snapWallEndpoint({ point: { x: 4.8, z: 4.7 }, existingWalls: [], ...ROOM });
    expect(result.kind).toBe('vertex');
    expect(result.point).toEqual({ x: 5, z: 5 });
  });

  it('does not vertex-snap when the nearest vertex is beyond snapDistance', () => {
    const result = snapWallEndpoint({
      point: { x: 0, z: 0 },
      existingWalls: [{ id: 'w', x1: 3, z1: 3, x2: 3.5, z2: 3.5 }],
      ...ROOM,
    });
    expect(result.kind).toBe('none');
    expect(result.point).toEqual({ x: 0, z: 0 });
  });

  it('respects a custom snapDistance', () => {
    const walls: InteriorWall[] = [{ id: 'w', x1: 2, z1: 2, x2: 3, z2: 3 }];
    // Cursor is exactly 0.4m from the (2,2) endpoint.
    const near = { point: { x: 1.6, z: 2 }, existingWalls: walls, ...ROOM };
    expect(snapWallEndpoint({ ...near, snapDistance: 0.3 }).kind).toBe('none');
    expect(snapWallEndpoint({ ...near, snapDistance: 0.5 }).kind).toBe('vertex');
  });

  it('ignores stale endpoints that sit outside the lot', () => {
    // Wall endpoint far outside the room should not be a snap target.
    const walls: InteriorWall[] = [{ id: 'w', x1: 99, z1: 99, x2: 1, z2: 1 }];
    const result = snapWallEndpoint({ point: { x: 4.9, z: 4.9 }, existingWalls: walls, ...ROOM });
    // Should snap to the building corner (5,5), not the stale (99,99) vertex.
    expect(result.point).toEqual({ x: 5, z: 5 });
  });
});

describe('snapWallEndpoint — right-angle snap', () => {
  it('snaps to a horizontal line from the chain anchor', () => {
    const result = snapWallEndpoint({
      point: { x: 3, z: 1.1 },
      existingWalls: [],
      fromPoint: { x: 0, z: 1 },
      ...ROOM,
    });
    expect(result.kind).toBe('right-angle');
    expect(result.point).toEqual({ x: 3, z: 1 });
  });

  it('snaps to a vertical line from the chain anchor', () => {
    const result = snapWallEndpoint({
      point: { x: 1.1, z: 3 },
      existingWalls: [],
      fromPoint: { x: 1, z: 0 },
      ...ROOM,
    });
    expect(result.kind).toBe('right-angle');
    expect(result.point).toEqual({ x: 1, z: 3 });
  });

  it('does not right-angle snap without a fromPoint', () => {
    const result = snapWallEndpoint({ point: { x: 3, z: 0.05 }, existingWalls: [], ...ROOM });
    expect(result.kind).toBe('none');
  });
});

describe('snapWallEndpoint — clamping', () => {
  it('clamps a point dragged onto the grass back to the footprint', () => {
    const result = snapWallEndpoint({ point: { x: 100, z: -100 }, existingWalls: [], ...ROOM });
    // The exact corner is a vertex within range post-clamp.
    expect(result.point.x).toBeLessThanOrEqual(5);
    expect(result.point.z).toBeGreaterThanOrEqual(-5);
    expect(result.point).toEqual({ x: 5, z: -5 });
  });

  it('clamps onto the building edge when far from any vertex after clamping', () => {
    const result = snapWallEndpoint({ point: { x: 0, z: 20 }, existingWalls: [], ...ROOM });
    // z clamps to 5, x stays 0 → no corner within range; the point lies on the south edge.
    expect(result.kind).toBe('on-wall');
    expect(result.point).toEqual({ x: 0, z: 5 });
  });
});

describe('snapWallEndpoint — on-wall snap (#412)', () => {
  const partition: InteriorWall = { id: 'p', x1: -5, z1: 0, x2: 5, z2: 0 };

  it('snaps onto the body of an existing wall', () => {
    const result = snapWallEndpoint({ point: { x: 1, z: 0.3 }, existingWalls: [partition], ...ROOM });
    expect(result.kind).toBe('on-wall');
    expect(result.point).toEqual({ x: 1, z: 0 });
  });

  it('snaps onto the building edge from inside', () => {
    const result = snapWallEndpoint({ point: { x: 1, z: -4.7 }, existingWalls: [], ...ROOM });
    expect(result.kind).toBe('on-wall');
    expect(result.point).toEqual({ x: 1, z: -5 });
  });

  it('closes a T-junction square to the chain anchor', () => {
    // Drawing up from the south wall at x = 1, ending a little askew near the partition.
    const result = snapWallEndpoint({
      point: { x: 1.2, z: 0.3 },
      existingWalls: [partition],
      fromPoint: { x: 1, z: 5 },
      ...ROOM,
    });
    expect(result.kind).toBe('on-wall');
    expect(result.point).toEqual({ x: 1, z: 0 });
  });

  it('keeps a wall drawn alongside another straight', () => {
    const result = snapWallEndpoint({
      point: { x: 3, z: 0.35 },
      existingWalls: [partition],
      fromPoint: { x: -3, z: 0.4 },
      ...ROOM,
    });
    expect(result.kind).toBe('right-angle');
    expect(result.point).toEqual({ x: 3, z: 0.4 });
  });

  it('prefers an endpoint over the wall body', () => {
    const result = snapWallEndpoint({ point: { x: 4.8, z: 0.1 }, existingWalls: [partition], ...ROOM });
    expect(result.kind).toBe('vertex');
  });

  it('leaves a point away from every wall alone', () => {
    const result = snapWallEndpoint({ point: { x: 1, z: 2 }, existingWalls: [partition], ...ROOM });
    expect(result.kind).toBe('none');
  });
});

describe('snapWallEndpoint — angle steps and the grid (#723)', () => {
  const from = { x: -2, z: 0 };

  it('rounds the first point of a chain to the 0.1 m grid', () => {
    const result = snapWallEndpoint({ point: { x: -2.5307883, z: -1.4912813 }, existingWalls: [], ...ROOM });
    expect(result).toEqual({ point: { x: -2.5, z: -1.5 }, kind: 'none' });
  });

  it('rounds along a wall or the shell, keeping the snap across it', () => {
    const partition: InteriorWall = { id: 'p', x1: -5, z1: 0, x2: 5, z2: 0 };
    expect(snapWallEndpoint({ point: { x: 1.234, z: -4.7 }, existingWalls: [], ...ROOM })).toEqual({ point: { x: 1.2, z: -5 }, kind: 'on-wall' });
    expect(snapWallEndpoint({ point: { x: 1.234, z: 0.2 }, existingWalls: [partition], ...ROOM }).point).toEqual({ x: 1.2, z: 0 });
    expect(snapWallEndpoint({ point: { x: 1.234, z: 0.2 }, existingWalls: [partition], free: true, ...ROOM }).point.x).toBeCloseTo(1.234, 9);
  });

  it('turns a chained wall to the nearest 15° step, at a length on the grid', () => {
    const result = snapWallEndpoint({ point: { x: 0.2, z: 2.1 }, existingWalls: [], fromPoint: from, ...ROOM });
    expect(result.kind).toBe('angle');
    expect(Math.atan2(result.point.z, result.point.x + 2) * (180 / Math.PI)).toBeCloseTo(45, 6);
    expect(Math.hypot(result.point.x + 2, result.point.z)).toBeCloseTo(3, 6);
  });

  it('lands exactly on an axis, not a hair off it', () => {
    const result = snapWallEndpoint({ point: { x: -2.3, z: 3 }, existingWalls: [], fromPoint: from, ...ROOM });
    expect(result).toEqual({ point: { x: -2, z: 3 }, kind: 'right-angle' });
  });

  it('draws free with Shift: no step and no grid, but the corners still catch', () => {
    const point = { x: 0.23, z: 2.17 };
    expect(snapWallEndpoint({ point, existingWalls: [], fromPoint: from, free: true, ...ROOM })).toEqual({ point, kind: 'none' });
    expect(snapWallEndpoint({ point: { x: 4.9, z: 4.9 }, existingWalls: [], free: true, ...ROOM }).kind).toBe('vertex');
  });

  it('keeps a stepped wall inside the lot', () => {
    const result = snapWallEndpoint({ point: { x: 3.7, z: 4.4 }, existingWalls: [], fromPoint: { x: 0, z: 2 }, snapDistance: 0.1, ...ROOM });
    expect(result.point.x).toBeLessThanOrEqual(5);
    expect(result.point.z).toBeLessThanOrEqual(5);
  });

  it('ends a stepped wall on a wall body along its own angle', () => {
    const partition: InteriorWall = { id: 'p', x1: -5, z1: 0, x2: 5, z2: 0 };
    const result = snapWallEndpoint({ point: { x: 1.1, z: 0.3 }, existingWalls: [partition], fromPoint: { x: -2, z: 3 }, ...ROOM });
    expect(result.kind).toBe('on-wall');
    expect(result.point.x).toBeCloseTo(1, 6);
    expect(result.point.z).toBeCloseTo(0, 6);
  });
});

describe('typed wall lengths (#723)', () => {
  it.each([['3.2', 3.2], ['3,2', 3.2], [' 4 m ', 4], ['.5', 0.5], ['2.', 2]] as const)('reads %s', (text, value) => {
    expect(parseWallLength(text)).toBe(value);
  });

  it.each(['', 'abc', '-1', '0', '0.05', '1.2.3', '1e3', 'Infinity'])('refuses %j', (text) => {
    expect(parseWallLength(text)).toBeNull();
  });

  it('measures the end from the anchor along the direction', () => {
    const end = wallEndAtLength({ x: 0, z: 0 }, { x: 3, z: 4 }, 2.5, 10, 10);
    expect(end?.x).toBeCloseTo(1.5, 9);
    expect(end?.z).toBeCloseTo(2, 9);
  });

  it('refuses a length that leaves the lot, but reaches the wall exactly', () => {
    expect(wallEndAtLength({ x: 0, z: 0 }, { x: 1, z: 0 }, 5.1, 10, 10)).toBeNull();
    expect(wallEndAtLength({ x: 0, z: 0 }, { x: 1, z: 0 }, 5, 10, 10)).toEqual({ x: 5, z: 0 });
  });

  it('gives no end without a direction', () => {
    expect(wallEndAtLength({ x: 0, z: 0 }, { x: 0, z: 0 }, 2, 10, 10)).toBeNull();
  });

  it('reads headings on the plan: east is 0, up the screen is 90', () => {
    const o = { x: 0, z: 0 };
    expect(wallAngleDegrees(o, { x: 1, z: 0 })).toBe(0);
    expect(wallAngleDegrees(o, { x: 0, z: -1 })).toBe(90);
    expect(wallAngleDegrees(o, { x: -1, z: 0 })).toBe(180);
    expect(wallAngleDegrees(o, { x: 1, z: 1 })).toBe(315);
  });
});
