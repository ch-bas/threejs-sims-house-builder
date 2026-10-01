import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { snapToNeighbors, snapToWall } from './geometry';

const room = { roomWidth: 8, roomDepth: 8 };
const chair = { width: 1, depth: 1, rotation: 0 };
const tree = { width: 1.4, depth: 1.4, rotation: 0, category: 'outdoor' as const };

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
