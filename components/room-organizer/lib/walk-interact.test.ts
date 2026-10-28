import { describe, expect, it } from 'vitest';
import { findNpcSeats } from './npc-seats';
import { buildWalkerColliders } from './walk-collision';
import { SEATED_EYE, findSeat, isSeat, seatPose } from './walk-interact';
import type { FurnitureItem } from './types';

function item(overrides: Partial<FurnitureItem> & { type: string; position: { x: number; z: number } }): FurnitureItem {
  return { id: overrides.type, name: overrides.type, width: 1, depth: 1, height: 1, color: '#000', icon: '', rotation: 0, ...overrides };
}

const SOFA = item({ id: 'sofa', type: 'sofa', name: 'Sofa', width: 2, depth: 0.9, height: 0.8, position: { x: 0, z: 0 } });
const TV = item({ id: 'tv', type: 'tv', width: 1.5, depth: 0.4, height: 0.5, position: { x: 0.4, z: 2.5 }, rotation: Math.PI });
const CHAIR = item({ id: 'chair', type: 'chair', width: 0.5, depth: 0.5, height: 0.8, position: { x: 3, z: 0 } });
const TABLE = item({ id: 'table', type: 'dining-table', width: 1.6, depth: 0.9, height: 0.75, position: { x: 0, z: -2 } });

describe('isSeat', () => {
  it('knows what you can sit on', () => {
    expect(['chair', 'dining-chair', 'armchair', 'sofa', 'bench', 'garden-bench', 'bed', 'toilet'].every((type) => isSeat({ type }))).toBe(true);
    expect(isSeat({ type: 'dining-table' })).toBe(false);
    // A prototype key is not a seat type.
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(isSeat({ type })).toBe(false);
  });
});

describe('findSeat (#463b)', () => {
  const items = [SOFA, TV, CHAIR, TABLE];

  it('finds the sofa in front of the walker', () => {
    expect(findSeat(items, 0, 1.2, 0, -1)?.id).toBe('sofa');
  });

  it('ignores a seat behind the walker unless it is right there', () => {
    expect(findSeat(items, 0, 1.4, 0, 1)).toBeNull();
    expect(findSeat(items, 0, 0.8, 0, 1)?.id).toBe('sofa');
  });

  it('ignores a seat out of reach, and things that are not seats', () => {
    expect(findSeat(items, -3, -3, 1, 0)).toBeNull();
    expect(findSeat([TABLE], 0, -1, 0, -1)).toBeNull();
  });

  it('prefers the seat straight ahead', () => {
    const other = { ...CHAIR, id: 'chair-2', position: { x: -0.9, z: 1.6 } };
    expect(findSeat([SOFA, other], 0, 1.5, 0, -1)?.id).toBe('sofa');
  });
});

describe('seatPose (#463b)', () => {
  it('sits on the sofa and faces the TV', () => {
    const pose = seatPose(SOFA, [SOFA, TV], 0)!;
    expect(pose.eyeY).toBeCloseTo(0.8 * 0.65 + SEATED_EYE, 9);
    expect(pose.z).toBeCloseTo(0.09, 9);
    expect([pose.lookX, pose.lookZ]).toEqual([0.4, 2.5]);
    expect(pose.lookY).toBeCloseTo(0.85, 9);
  });

  it('with no TV in front, looks the way the seat faces', () => {
    const turned = { ...SOFA, rotation: Math.PI / 2 };
    const pose = seatPose(turned, [turned, TV], 3)!;
    expect(pose.lookX - pose.x).toBeCloseTo(3, 9);
    expect(pose.lookZ - pose.z).toBeCloseTo(0, 9);
    expect(pose.lookY).toBe(pose.eyeY);
    expect(pose.eyeY).toBeCloseTo(3 + 0.8 * 0.65 + SEATED_EYE, 9);
  });

  it('caps the seat at a low item’s own height', () => {
    const bench = item({ id: 'bench', type: 'bench', height: 0.3, position: { x: 0, z: 0 } });
    expect(seatPose(bench, [bench], 0)!.eyeY).toBeCloseTo(0.3 + SEATED_EYE, 9);
  });

  it('is null for something you cannot sit on', () => {
    expect(seatPose(TABLE, [TABLE], 0)).toBeNull();
  });
});

describe('one seat-height table for walkers and the player (#623)', () => {
  it('seats the player at the walker’s hip height on the same sofa', () => {
    const npc = findNpcSeats([SOFA])[0]!;
    const pose = seatPose(SOFA, [SOFA], 0)!;
    expect(pose.eyeY - SEATED_EYE).toBeCloseTo(npc.seatHeight, 9);
  });

  it('raises the player with a resized, taller sofa', () => {
    const tall = { ...SOFA, height: 1.2 };
    const pose = seatPose(tall, [tall], 0)!;
    expect(pose.eyeY - SEATED_EYE).toBeCloseTo(findNpcSeats([tall])[0]!.seatHeight, 9);
    expect(pose.eyeY).toBeGreaterThan(seatPose(SOFA, [SOFA], 0)!.eyeY);
  });

  it('matches for every seat a walker can use', () => {
    for (const type of ['chair', 'dining-chair', 'armchair', 'sofa', 'bench', 'garden-bench']) {
      const seat = item({ type, width: 0.6, depth: 0.6, height: 0.9, position: { x: 0, z: 0 } });
      expect(seatPose(seat, [seat], 0)!.eyeY - SEATED_EYE).toBeCloseTo(findNpcSeats([seat])[0]!.seatHeight, 9);
    }
  });
});

describe('seats and the TV behind walls (#566)', () => {
  // A 6 × 5 m house: the south wall at z = 2.5 has a door at x = 1.5, and a
  // partition runs north–south at x = 1 up to z = 1.
  const DOOR = item({ id: 'door', type: 'door', width: 0.9, depth: 0.1, height: 2.1, position: { x: 2.2, z: 2.5 } });
  const BACK_SOFA = { ...SOFA, id: 'back-sofa', position: { x: -0.8, z: 2.0 }, rotation: Math.PI };
  const PARTITION = { id: 'p', x1: 1, z1: -2.5, x2: 1, z2: 1 };
  const EAST_CHAIR = item({ id: 'east-chair', type: 'chair', width: 0.5, depth: 0.5, height: 0.8, position: { x: 1.5, z: -1 } });

  function sight(items: FurnitureItem[], feetY = 0, outside = false) {
    const colliders = buildWalkerColliders({ width: 6, depth: 5, floors: [{ items, interiorWalls: [PARTITION] }] })[0]!;
    return { colliders, feetY, outside };
  }

  it('does not offer a sofa inside the house to a walker on the lawn', () => {
    const items = [DOOR, BACK_SOFA];
    // Without the sight test it was offered through the wall.
    expect(findSeat(items, 0, 3.0, 0, -1)?.id).toBe('back-sofa');
    expect(findSeat(items, 0, 3.0, 0, -1, sight(items, 0, true))).toBeNull();
  });

  it('does not offer an indoor seat to a walker outside, even through the open door', () => {
    const near = { ...BACK_SOFA, position: { x: 1.6, z: 1.9 } };
    const items = [DOOR, near];
    expect(findSeat(items, 2.2, 2.9, 0, -1, sight(items, 0, true))).toBeNull();
    // Indoors, the same sofa is in reach.
    expect(findSeat(items, 2.2, 1.0, 0, 1, sight(items))?.id).toBe(near.id);
  });

  it('offers a garden bench to a walker outside, not to one indoors at the door', () => {
    const bench = item({ id: 'garden', type: 'garden-bench', category: 'outdoor', width: 1.5, depth: 0.5, height: 0.85, position: { x: 2.2, z: 3.2 } });
    const items = [DOOR, bench];
    expect(findSeat(items, 2.2, 4.0, 0, -1, sight(items, 0, true))?.id).toBe('garden');
    expect(findSeat(items, 2.2, 2.1, 0, 1, sight(items))).toBeNull();
  });

  it('decides indoors or out by where the seat stands, not its category', () => {
    // A dining chair out on the lawn, and a garden bench in the living room.
    const patioChair = item({ id: 'patio', type: 'chair', category: 'seating', width: 0.5, depth: 0.5, height: 0.8, position: { x: 2.2, z: 3.4 } });
    const indoorBench = item({ id: 'bench-in', type: 'garden-bench', category: 'outdoor', width: 1.5, depth: 0.5, height: 0.85, position: { x: -1.5, z: -1 } });
    const footprint = { width: 6, depth: 5 };
    const items = [DOOR, patioChair, indoorBench];
    expect(findSeat(items, 2.2, 4.2, 0, -1, { ...sight(items, 0, true), footprint })?.id).toBe('patio');
    expect(findSeat(items, -1.5, -0.2, 0, -1, { ...sight(items), footprint })?.id).toBe('bench-in');
  });

  it('counts a bench on the recessed porch as outdoors (#566)', () => {
    const porchBench = item({ id: 'porch-bench', type: 'garden-bench', category: 'outdoor', width: 1, depth: 0.4, height: 0.85, position: { x: 0, z: -2.2 } });
    const footprint = { width: 6, depth: 5 };
    const porch = { x0: -0.7, x1: 0.7, z0: -2.5, z1: -1.3 };
    const items = [porchBench];
    // From the porch, out on the lot: in reach.
    expect(findSeat(items, 0, -1.6, 0, -1, { ...sight(items, 0, true), footprint, porch })?.id).toBe('porch-bench');
    // From indoors, through the front door: not.
    expect(findSeat(items, 0, -1.0, 0, -1, { ...sight(items), footprint, porch })).toBeNull();
  });

  it('does not offer a seat across a partition', () => {
    const items = [EAST_CHAIR];
    expect(findSeat(items, 0.55, -1, 1, 0)?.id).toBe('east-chair');
    expect(findSeat(items, 0.55, -1, 1, 0, sight(items))).toBeNull();
    // Round the end of the partition it is in sight again.
    expect(findSeat(items, 1.5, 0.2, 0, -1, sight(items))?.id).toBe('east-chair');
  });

  it('turns a seated walker to a TV only when nothing walls it off', () => {
    const chair = item({ id: 'c', type: 'chair', width: 0.5, depth: 0.5, height: 0.8, position: { x: 0, z: -2 } });
    const toilet = item({ id: 't', type: 'toilet', width: 0.4, depth: 0.7, height: 0.8, position: { x: 2, z: -2 }, rotation: -Math.PI / 2 });
    const tvBeyond = item({ id: 'tv', type: 'tv', width: 1, depth: 0.3, height: 0.5, position: { x: 0, z: 0.5 } });
    const tvWest = item({ id: 'tv', type: 'tv', width: 1, depth: 0.3, height: 0.5, position: { x: -0.5, z: -2 } });
    const wall = { id: 'w', x1: -3, z1: -1, x2: 0.9, z2: -1 };
    const view = (items: FurnitureItem[]) => ({
      colliders: buildWalkerColliders({ width: 6, depth: 5, floors: [{ items, interiorWalls: [wall, PARTITION] }] })[0]!,
    });
    // The chair faces a wall with a TV beyond it: it looks straight ahead.
    const blocked = seatPose(chair, [chair, tvBeyond], 0, view([chair, tvBeyond]))!;
    expect(seatPose(chair, [chair, tvBeyond], 0)!.lookZ).toBe(0.5);
    expect([blocked.lookX, blocked.lookZ]).toEqual([blocked.x, blocked.z + 3]);
    // The toilet behind the partition never faces the living-room TV.
    const throughPartition = seatPose(toilet, [toilet, tvWest], 0, view([toilet, tvWest]))!;
    expect(seatPose(toilet, [toilet, tvWest], 0)!.lookX).toBe(-0.5);
    expect(throughPartition.lookX).toBeCloseTo(throughPartition.x - 3, 9);
    // A TV in the same room still wins.
    const tvHere = item({ id: 'tv', type: 'tv', width: 1, depth: 0.3, height: 0.5, position: { x: 0, z: -0.2 } });
    const open = seatPose(chair, [chair, tvHere], 0, { colliders: buildWalkerColliders({ width: 6, depth: 5, floors: [{ items: [chair, tvHere], interiorWalls: [PARTITION] }] })[0]! })!;
    expect([open.lookX, open.lookZ]).toEqual([0, -0.2]);
  });
});
