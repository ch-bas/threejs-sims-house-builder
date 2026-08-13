import { describe, expect, it } from 'vitest';
import { snapWallEndpoint } from './wall-snap';
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
    const near = { point: { x: 2.4, z: 2 }, existingWalls: walls, ...ROOM };
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

  it('clamps but reports "none" when far from any vertex after clamping', () => {
    const result = snapWallEndpoint({ point: { x: 0, z: 20 }, existingWalls: [], ...ROOM });
    // z clamps to 5, x stays 0 → distance to nearest corner (±5,5) is 5 > snapDistance → none.
    expect(result.kind).toBe('none');
    expect(result.point).toEqual({ x: 0, z: 5 });
  });
});
