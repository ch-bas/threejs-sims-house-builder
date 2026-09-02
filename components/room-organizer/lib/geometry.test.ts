import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import {
  autoOrganize,
  boundingRadius,
  hasCollisions,
  itemInBounds,
  itemsOverlap,
  rotatedHalfExtents,
  snapToGrid,
} from './geometry';

describe('boundingRadius', () => {
  it('is the half-diagonal of the footprint', () => {
    expect(boundingRadius({ width: 4, depth: 3 })).toBeCloseTo(2.5, 10); // hypot(2,1.5)
  });
});

describe('rotatedHalfExtents', () => {
  it('equals half the raw dims at 0 rotation', () => {
    expect(rotatedHalfExtents({ width: 2, depth: 4, rotation: 0 })).toEqual({ halfW: 1, halfD: 2 });
  });

  it('swaps width/depth extents at 90°', () => {
    const e = rotatedHalfExtents({ width: 2, depth: 4, rotation: Math.PI / 2 });
    expect(e.halfW).toBeCloseTo(2, 10);
    expect(e.halfD).toBeCloseTo(1, 10);
  });

  it('at 45° a unit square spans its diagonal', () => {
    const e = rotatedHalfExtents({ width: 1, depth: 1, rotation: Math.PI / 4 });
    expect(e.halfW).toBeCloseTo(Math.SQRT2 / 2, 10);
    expect(e.halfD).toBeCloseTo(Math.SQRT2 / 2, 10);
  });
});

describe('itemsOverlap — OBB via SAT', () => {
  it('detects two axis-aligned boxes overlapping', () => {
    const a = makeItem({ id: 'a', width: 2, depth: 2, position: { x: 0, z: 0 } });
    const b = makeItem({ id: 'b', width: 2, depth: 2, position: { x: 1, z: 0 } });
    expect(itemsOverlap(a, b)).toBe(true);
  });

  it('reports no overlap for clearly separated boxes', () => {
    const a = makeItem({ id: 'a', width: 1, depth: 1, position: { x: 0, z: 0 } });
    const b = makeItem({ id: 'b', width: 1, depth: 1, position: { x: 5, z: 0 } });
    expect(itemsOverlap(a, b)).toBe(false);
  });

  it('returns false when either item lacks a position', () => {
    const a = makeItem({ id: 'a', position: undefined });
    const b = makeItem({ id: 'b', position: { x: 0, z: 0 } });
    expect(itemsOverlap(a, b)).toBe(false);
  });

  it('thin bars: SAT separates a diagonal gap the bounding-circle broad phase misses', () => {
    // Two long thin bars both aligned along +X (spanning x∈[-2,2], z∈[-0.1,0.1]),
    // stacked with a vertical gap of ~1.2m. Their bounding circles (radius ~2)
    // overlap because the bars are long, but the oriented boxes are clearly apart.
    const a = makeItem({ id: 'a', width: 4, depth: 0.2, rotation: 0, position: { x: 0, z: 0 } });
    const b = makeItem({ id: 'b', width: 4, depth: 0.2, rotation: 0, position: { x: 0, z: 1.4 } });
    const dist = Math.hypot(0, 1.4);
    // Broad phase (circles) passes: distance 1.4 < r_a + r_b ≈ 4.0.
    expect(dist).toBeLessThan(boundingRadius(a) + boundingRadius(b));
    // SAT rejects: the bars' z-ranges [-0.1,0.1] and [1.3,1.5] don't touch.
    expect(itemsOverlap(a, b)).toBe(false);
  });

  it('a 45°-rotated square overlaps a box its corner pokes into', () => {
    const a = makeItem({ id: 'a', width: 2, depth: 2, rotation: Math.PI / 4, position: { x: 0, z: 0 } });
    // Corner of the rotated square reaches ~sqrt(2) ≈ 1.414 along +X.
    const b = makeItem({ id: 'b', width: 1, depth: 1, rotation: 0, position: { x: 1.6, z: 0 } });
    expect(itemsOverlap(a, b)).toBe(true);
  });
});

describe('itemInBounds', () => {
  const W = 10;
  const D = 10;

  it('is true for an item well inside the room', () => {
    expect(itemInBounds(makeItem({ width: 2, depth: 2, position: { x: 0, z: 0 } }), W, D)).toBe(true);
  });

  it('is false when the footprint crosses a wall', () => {
    expect(itemInBounds(makeItem({ width: 2, depth: 2, position: { x: 4.5, z: 0 } }), W, D)).toBe(false);
  });

  it('accounts for rotation when checking bounds', () => {
    // A 4×0.2 bar at 45° near the corner spans its diagonal and pokes out.
    const bar = makeItem({ width: 4, depth: 0.2, rotation: Math.PI / 4, position: { x: 4, z: 4 } });
    expect(itemInBounds(bar, W, D)).toBe(false);
  });

  it('returns false for a positionless item', () => {
    expect(itemInBounds(makeItem({ position: undefined }), W, D)).toBe(false);
  });
});

describe('snapToGrid', () => {
  it('rounds to the nearest multiple', () => {
    expect(snapToGrid(0.24, 0.5)).toBe(0);
    expect(snapToGrid(0.26, 0.5)).toBe(0.5);
    expect(snapToGrid(-0.26, 0.5)).toBe(-0.5);
    expect(snapToGrid(1.0, 0.25)).toBe(1.0);
  });
});

describe('hasCollisions', () => {
  const W = 10;
  const D = 10;

  it('flags an in-room item overlapping another', () => {
    const a = makeItem({ id: 'a', width: 2, depth: 2, position: { x: 0, z: 0 } });
    const b = makeItem({ id: 'b', width: 2, depth: 2, position: { x: 1, z: 0 } });
    expect(hasCollisions(a, [a, b], W, D)).toBe(true);
  });

  it('flags an in-room item that crosses the wall even with no neighbours', () => {
    const a = makeItem({ id: 'a', width: 2, depth: 2, position: { x: 4.5, z: 0 } });
    expect(hasCollisions(a, [a], W, D)).toBe(true);
  });

  it('does not flag a lone, in-bounds item', () => {
    const a = makeItem({ id: 'a', width: 2, depth: 2, position: { x: 0, z: 0 } });
    expect(hasCollisions(a, [a], W, D)).toBe(false);
  });

  it('never flags security cameras against room bounds', () => {
    const cam = makeItem({ id: 'c', type: 'security-camera', position: { x: 4.9, z: 4.9 } });
    expect(hasCollisions(cam, [cam], W, D)).toBe(false);
  });

  it('openings ignore room bounds but still collide with neighbours', () => {
    const door = makeItem({ id: 'd', type: 'door', width: 1, depth: 0.2, position: { x: 5, z: 0 } });
    expect(hasCollisions(door, [door], W, D)).toBe(false);
    const other = makeItem({ id: 'o', type: 'window', width: 1, depth: 0.2, position: { x: 5, z: 0 } });
    expect(hasCollisions(door, [door, other], W, D)).toBe(true);
  });

  it('outdoor items are flagged when they poke into the room', () => {
    const tree = makeItem({ id: 't', type: 'tree', category: 'outdoor', width: 1, depth: 1, position: { x: 0, z: 0 } });
    expect(hasCollisions(tree, [tree], W, D)).toBe(true);
  });

  it('outdoor items placed fully outside are allowed', () => {
    const tree = makeItem({ id: 't', type: 'tree', category: 'outdoor', width: 1, depth: 1, position: { x: 8, z: 0 } });
    expect(hasCollisions(tree, [tree], W, D)).toBe(false);
  });

  it('returns false for a positionless item', () => {
    expect(hasCollisions(makeItem({ position: undefined }), [], W, D)).toBe(false);
  });
});

describe('autoOrganize — overflow handling (#128)', () => {
  const items = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      makeItem({ id: `i${i}`, width: 1, depth: 1, position: { x: 3 + i, z: 2 }, rotation: 1.1 })
    );

  it('packs what fits and leaves overflow items at their original position and rotation', () => {
    // 3×3 room, margin 0.3: each row holds 2 items across 2 rows → 4 fit, 2 overflow.
    const result = autoOrganize(items(6), 3, 3);
    const placed = result.slice(0, 4);
    const overflow = result.slice(4);
    for (const item of placed) expect(item.rotation).toBe(0);
    expect(overflow.map((i) => i.position)).toEqual([
      { x: 3 + 4, z: 2 },
      { x: 3 + 5, z: 2 },
    ]);
    for (const item of overflow) expect(item.rotation).toBe(1.1);
  });

  it('never stacks two overflow items on the same spot', () => {
    const result = autoOrganize(items(8), 3, 3);
    const keys = result.map((i) => `${i.position!.x},${i.position!.z}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('leaves an item wider than the room at its original position instead of protruding', () => {
    const wide = makeItem({ id: 'sofa', width: 2.0, depth: 0.9, position: { x: 0.1, z: 0.2 }, rotation: 0.5 });
    const result = autoOrganize([wide], 2.2, 4);
    expect(result[0]!.position).toEqual({ x: 0.1, z: 0.2 });
    expect(result[0]!.rotation).toBe(0.5);
  });
});
