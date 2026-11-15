import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { collisionReason, snapToNeighbors, snapToWall } from './geometry';
import { INTERIOR_WALL_THICKNESS } from './opening-snap';
import type { InteriorWall } from './types';

const room = { roomWidth: 8, roomDepth: 8 };
const chair = { width: 1, depth: 1, rotation: 0 };
const tree = { width: 1.4, depth: 1.4, rotation: 0, category: 'outdoor' as const };

describe('snapToWall to partitions (#914)', () => {
  // A partition running north-south at x = 1, and one east-west at z = -1.
  const ns: InteriorWall = { id: 'ns', x1: 1, z1: -4, x2: 1, z2: 4 };
  const ew: InteriorWall = { id: 'ew', x1: -4, z1: -1, x2: 1, z2: -1 };
  const half = INTERIOR_WALL_THICKNESS / 2;
  const wardrobe = makeItem({ id: 'w', type: 'wardrobe', category: 'bedroom', width: 1.4, depth: 0.6, height: 2.1, rotation: Math.PI / 2 });

  it('lands a 0.6 m wardrobe within 0.3 m of a partition face flush, clear of the partition', () => {
    // Turned a quarter, the wardrobe is 0.6 m along x: its centre sits 0.3 m off the face.
    const flushX = 1 - half - 0.3;
    for (const x of [flushX - 0.29, flushX + 0.05]) {
      const position = snapToWall({ position: { x, z: 2 }, item: wardrobe, ...room, interiorWalls: [ns] });
      expect(position.x).toBeCloseTo(flushX, 12);
      expect(position.z).toBe(2);
      const placed = { ...wardrobe, position };
      expect(collisionReason(placed, [placed], 8, 8, { interiorWalls: [ns] })).toBeNull();
    }
    // Its other side snaps to the other face.
    const east = snapToWall({ position: { x: 1 + half + 0.4, z: 2 }, item: wardrobe, ...room, interiorWalls: [ns] });
    expect(east.x).toBeCloseTo(1 + half + 0.3, 12);
    // An east-west one fixes z.
    const desk = makeItem({ id: 'd', width: 1.2, depth: 0.6, rotation: 0 });
    const south = snapToWall({ position: { x: -2, z: -0.5 }, item: desk, ...room, interiorWalls: [ew] });
    expect(south.x).toBe(-2);
    expect(south.z).toBeCloseTo(-1 + half + 0.3, 12);
    const placed = { ...desk, position: south };
    expect(collisionReason(placed, [placed], 8, 8, { interiorWalls: [ew] })).toBeNull();
  });

  it('pulls an item that landed a few centimetres into the partition back out', () => {
    const before = { ...wardrobe, position: { x: 1 - half - 0.25, z: 2 } };
    expect(collisionReason(before, [before], 8, 8, { interiorWalls: [ns] })).toEqual({ kind: 'partition' });
    const after = { ...before, position: snapToWall({ position: before.position, item: before, ...room, interiorWalls: [ns] }) };
    expect(collisionReason(after, [after], 8, 8, { interiorWalls: [ns] })).toBeNull();
  });

  it('still snaps to a partition with a door in it (the door is its own item)', () => {
    const door = makeItem({ id: 'door', type: 'door', category: 'structure', width: 0.9, depth: 0.12, height: 2.05, position: { x: 1, z: 0 }, rotation: Math.PI / 2 });
    const position = snapToWall({ position: { x: 0.4, z: 2 }, item: wardrobe, ...room, interiorWalls: [ns] });
    expect(position.x).toBeCloseTo(1 - half - 0.3, 12);
    const placed = { ...wardrobe, position };
    expect(collisionReason(placed, [placed, door], 8, 8, { interiorWalls: [ns] })).toBeNull();
  });

  it('does not pull an item in a doorway against the partition beside it', () => {
    const door = makeItem({ id: 'door', type: 'door', category: 'structure', width: 0.9, depth: 0.12, height: 2.05, position: { x: 1, z: 0 }, rotation: Math.PI / 2 });
    const chairAt = { x: 0.35, z: 0.2 };
    expect(snapToWall({ position: chairAt, item: chair, ...room, interiorWalls: [ns], items: [door] })).toEqual(chairAt);
    // Past the door's span it snaps again.
    expect(snapToWall({ position: { x: 0.35, z: 1.5 }, item: chair, ...room, interiorWalls: [ns], items: [door] }).x).toBeCloseTo(1 - half - 0.5, 12);
    // A door in another partition is no doorway of this one.
    const elsewhere = { ...door, position: { x: -2, z: -1 } };
    expect(snapToWall({ position: chairAt, item: chair, ...room, interiorWalls: [ns], items: [elsewhere] }).x).toBeCloseTo(1 - half - 0.5, 12);
  });

  it('skips angled partitions, ones it is not beside, and outdoor items', () => {
    const angled: InteriorWall = { id: 'a', x1: 0, z1: 0, x2: 2, z2: 2 };
    expect(snapToWall({ position: { x: 0.9, z: 1.5 }, item: chair, ...room, interiorWalls: [angled] })).toEqual({ x: 0.9, z: 1.5 });
    // Past the end of the east-west partition (it stops at x = 1).
    expect(snapToWall({ position: { x: 2, z: -0.5 }, item: chair, ...room, interiorWalls: [ew] })).toEqual({ x: 2, z: -0.5 });
    expect(snapToWall({ position: { x: 0.4, z: 0 }, item: tree, ...room, interiorWalls: [ns] })).toEqual({ x: 0.4, z: 0 });
  });

  it('takes the nearer of a shell face and a partition face', () => {
    // A corridor: a partition 0.9 m inside the west wall (inner face at -4).
    const corridor: InteriorWall = { id: 'c', x1: -3.1, z1: -4, x2: -3.1, z2: 4 };
    // A 0.5 m chair centred 0.3 m off the shell face and 0.25 m off the partition's.
    const small = { width: 0.5, depth: 0.5, rotation: 0 };
    const nearPartition = snapToWall({ position: { x: -3.45 - half + 0.1, z: 0 }, item: small, ...room, interiorWalls: [corridor] });
    expect(nearPartition.x).toBeCloseTo(-3.1 - half - 0.25, 12);
    expect(snapToWall({ position: { x: -3.7, z: 0 }, item: small, ...room, interiorWalls: [corridor] })).toEqual({ x: -3.75, z: 0 });
  });
});

describe('snapToWall (#380)', () => {
  it('snaps an indoor item flush to the inner face from either side of it', () => {
    expect(snapToWall({ position: { x: -3.3, z: 0 }, item: chair, ...room })).toEqual({ x: -3.5, z: 0 });
    expect(snapToWall({ position: { x: 0, z: 3.7 }, item: chair, ...room })).toEqual({ x: 0, z: 3.5 });
    // Just past the inner face (into the wall) still snaps back flush.
    expect(snapToWall({ position: { x: 3.6, z: 0 }, item: chair, ...room })).toEqual({ x: 3.5, z: 0 });
  });

  it('leaves an item away from every wall alone', () => {
    expect(snapToWall({ position: { x: 1, z: -1 }, item: chair, ...room })).toEqual({ x: 1, z: -1 });
    expect(snapToWall({ position: { x: 0, z: 20 }, item: chair, ...room })).toEqual({ x: 0, z: 20 });
  });

  it('never pulls an outdoor item inside the house', () => {
    // A tree just outside the south wall used to land at z = 3.3, inside;
    // now it snaps flush against the outer face.
    expect(snapToWall({ position: { x: 0, z: 5 }, item: tree, ...room })).toEqual({ x: 0, z: 4.7 });
    expect(snapToWall({ position: { x: 0, z: 6 }, item: tree, ...room })).toEqual({ x: 0, z: 6 });
    expect(snapToWall({ position: { x: -4.5, z: 1 }, item: tree, ...room })).toEqual({ x: -4.7, z: 1 });
  });

  it('only snaps alongside the wall, not on its extension past a corner', () => {
    // Far south of the building, near the line of the west wall: no snap.
    expect(snapToWall({ position: { x: -4.6, z: 10 }, item: tree, ...room })).toEqual({ x: -4.6, z: 10 });
  });

  it('uses the rotated footprint', () => {
    const sofa = { width: 2, depth: 1, rotation: Math.PI / 2 };
    expect(snapToWall({ position: { x: -3.3, z: 0 }, item: sofa, ...room })).toEqual({ x: -3.5, z: 0 });
  });
});

describe('snapToNeighbors (#380)', () => {
  const moving = makeItem({ id: 'a', position: { x: 0, z: 0 } });
  const member = makeItem({ id: 'b', position: { x: 1.05, z: 3 } });

  it('aligns to a neighbour’s edge', () => {
    // a's right edge (x + 0.5) meets b's left edge (0.55): x = 0.05 → 0.
    expect(snapToNeighbors({ position: { x: 0.1, z: 0 }, movingItem: moving, otherItems: [moving, member] }).x).toBeCloseTo(0.05);
  });

  it('never snaps to a co-dragged member’s stale position', () => {
    const snapped = snapToNeighbors({
      position: { x: 0.1, z: 0 },
      movingItem: moving,
      otherItems: [moving, member],
      excludeIds: new Set(['a', 'b']),
    });
    expect(snapped).toEqual({ x: 0.1, z: 0 });
  });
});
