import { describe, expect, it } from 'vitest';
import { planRoomStamp, snapStampCentre, stampPlacement, type RoomStampSpec, type StampContext } from './room-stamp';
import { MAX_INTERIOR_WALLS_PER_FLOOR } from './schema';
import type { EntrancePlanOutline } from './street';
import type { InteriorWall } from './types';

const context: StampContext = { existingWalls: [], roomWidth: 10, roomDepth: 8, porch: null };
const rect: RoomStampSpec = { shape: 'rectangle', width: 4, depth: 3 };

describe('snapStampCentre (#724)', () => {
  it('rounds the edges to the grid', () => {
    expect(snapStampCentre({ x: 0.53, z: 0.27 }, 4, 3, context)).toEqual({ x: 0.5, z: 0.3 });
  });

  it('catches an edge on a wall corner or the shell', () => {
    const walls: InteriorWall[] = [{ id: 'w', x1: 1, z1: -2, x2: 1, z2: 2 }];
    expect(snapStampCentre({ x: 3.2, z: 0 }, 4, 3, { ...context, existingWalls: walls }).x).toBe(3);
    expect(snapStampCentre({ x: 2.8, z: 2.3 }, 4, 3, context).z).toBe(2.5);
  });

  it('keeps the whole room inside the footprint', () => {
    expect(snapStampCentre({ x: 40, z: -40 }, 4, 3, context)).toEqual({ x: 3, z: -2.5 });
  });
});

describe('stampPlacement (#724)', () => {
  it('a hover and a click place the stamp at its size', () => {
    expect(stampPlacement(rect, null, { x: 0, z: 0 }, context)).toMatchObject({ width: 4, depth: 3 });
    expect(stampPlacement(rect, { x: 1, z: 1 }, { x: 1.1, z: 1.1 }, context)).toMatchObject({ width: 4, depth: 3, centerX: 1 });
  });

  it('a drag sets the size from corner to corner, in any direction', () => {
    expect(stampPlacement(rect, { x: 2, z: 2 }, { x: -1, z: 0 }, context)).toEqual({ centerX: 0.5, centerZ: 1, width: 3, depth: 2 });
  });

  it('a drag keeps clean numbers (L5)', () => {
    const { centerX, centerZ, width, depth } = stampPlacement(rect, { x: 0.3, z: 0.7 }, { x: 2.5, z: 2.9 }, context);
    for (const value of [centerX, centerZ, width, depth]) expect(value).toBe(Math.round(value * 1e6) / 1e6);
  });

  it('a drag too small for a room stops at the smallest', () => {
    expect(stampPlacement(rect, { x: 0, z: 0 }, { x: 0.5, z: 0.1 }, context)).toMatchObject({ width: 1.5, depth: 1.5 });
  });
});

describe('planRoomStamp (#724)', () => {
  const place = { centerX: 0, centerZ: 0, width: 4, depth: 3 };

  it('builds the whole outline in open floor', () => {
    const plan = planRoomStamp(rect, place, context, 's');
    expect(plan.walls).toHaveLength(4);
    expect(plan.refusal).toBeNull();
  });

  it('drops the side a neighbouring room already built', () => {
    const shared: InteriorWall = { id: 'x', x1: 2, z1: -4, x2: 2, z2: 4 };
    const plan = planRoomStamp(rect, place, { ...context, existingWalls: [shared] }, 's');
    expect(plan.walls).toHaveLength(3);
  });

  it('keeps the stretch past a shorter wall', () => {
    const shared: InteriorWall = { id: 'x', x1: 2, z1: -1.5, x2: 2, z2: 0 };
    const plan = planRoomStamp(rect, place, { ...context, existingWalls: [shared] }, 's');
    expect(plan.walls).toHaveLength(4);
    const east = plan.walls.find((wall) => wall.x1 === 2 && wall.x2 === 2)!;
    expect(Math.min(east.z1, east.z2)).toBeCloseTo(0, 9);
    expect(Math.max(east.z1, east.z2)).toBeCloseTo(1.5, 9);
  });

  it('closes a sliver a shorter wall leaves, reaching back over it (L4)', () => {
    const shared: InteriorWall = { id: 'x', x1: 2, z1: -1.5, x2: 2, z2: 1.45 };
    const plan = planRoomStamp(rect, place, { ...context, existingWalls: [shared] }, 's');
    const east = plan.walls.find((wall) => wall.x1 === 2 && wall.x2 === 2)!;
    expect(Math.max(east.z1, east.z2)).toBeCloseTo(1.5, 9);
    expect(Math.abs(east.z2 - east.z1)).toBeCloseTo(0.1, 9);
  });

  it('joins two runs a thin cover would leave with a sliver between them', () => {
    const shared: InteriorWall = { id: 'x', x1: 2, z1: 0, x2: 2, z2: 0.06 };
    const plan = planRoomStamp(rect, place, { ...context, existingWalls: [shared] }, 's');
    expect(plan.walls.filter((wall) => wall.x1 === 2 && wall.x2 === 2)).toHaveLength(2);
  });

  it('adds no wall along the outside walls', () => {
    const plan = planRoomStamp(rect, { centerX: 3, centerZ: 2.5, width: 4, depth: 3 }, context, 's');
    expect(plan.walls).toHaveLength(2);
  });

  it('builds the side a hidden outside wall would have closed', () => {
    const corner = { centerX: 3, centerZ: 2.5, width: 4, depth: 3 };
    expect(planRoomStamp(rect, corner, { ...context, hiddenWalls: ['east'] }, 's').walls).toHaveLength(3);
  });

  it('refuses a stamp that adds nothing', () => {
    const plan = planRoomStamp(rect, { centerX: 0, centerZ: 0, width: 10, depth: 8 }, context, 's');
    expect(plan.refusal).toContain('already');
  });

  it('refuses a stamp across the porch, and one past the cap', () => {
    const porch: EntrancePlanOutline = { x0: -1, x1: 1, frontZ: -4, backZ: -3 };
    expect(planRoomStamp(rect, { centerX: 0, centerZ: -3, width: 1, depth: 2 }, { ...context, porch }, 's').refusal).toContain('porch');
    const full = Array.from({ length: MAX_INTERIOR_WALLS_PER_FLOOR - 2 }, (_, i): InteriorWall => ({ id: `w${i}`, x1: 4, z1: 3, x2: 4.5, z2: 3 }));
    expect(planRoomStamp(rect, place, { ...context, existingWalls: full }, 's').refusal).toContain('floor');
  });

  it('gives every piece its own id', () => {
    const shared: InteriorWall = { id: 'x', x1: 2, z1: -0.5, x2: 2, z2: 0.5 };
    const plan = planRoomStamp(rect, place, { ...context, existingWalls: [shared] }, 's');
    expect(new Set(plan.walls.map((wall) => wall.id)).size).toBe(plan.walls.length);
    expect(plan.walls).toHaveLength(5);
  });
});
