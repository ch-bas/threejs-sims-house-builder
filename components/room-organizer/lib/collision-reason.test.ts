import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { collisionMessage } from './collision-reason';
import { collisionReason, hasCollisions, type KeepOutRect } from './geometry';
import type { InteriorWall } from './types';

const W = 8;
const D = 8;
const porch: KeepOutRect = { x0: -1, x1: 1, z0: -4, z1: -3 };
const stairwell: KeepOutRect = { ...porch, hole: true };
const partition: InteriorWall = { id: 'w', x1: -4, z1: 0, x2: 4, z2: 0 };

describe('collisionReason (#627)', () => {
  it('names the room bounds, for an item leaving it', () => {
    const item = makeItem({ position: { x: 3.9, z: 2 } });
    expect(collisionReason(item, [item], W, D)).toEqual({ kind: 'bounds' });
  });

  it('names the house, for an outdoor item standing in it', () => {
    const tree = makeItem({ category: 'outdoor', type: 'tree', position: { x: 0, z: 2 } });
    expect(collisionReason(tree, [tree], W, D)).toEqual({ kind: 'building' });
  });

  it('tells the porch from a stairwell', () => {
    const item = makeItem({ position: { x: 0, z: -3 } });
    expect(collisionReason(item, [item], W, D, { keepOut: [porch] })).toEqual({ kind: 'porch' });
    expect(collisionReason(item, [item], W, D, { keepOut: [stairwell] })).toEqual({ kind: 'stairwell' });
  });

  it('names a partition', () => {
    const item = makeItem({ position: { x: 0, z: 0 } });
    expect(collisionReason(item, [item], W, D, { interiorWalls: [partition] })).toEqual({ kind: 'partition' });
  });

  it('names the other item', () => {
    const a = makeItem({ id: 'a', position: { x: 0, z: 2 } });
    const b = makeItem({ id: 'b', name: 'Bookcase', position: { x: 0.2, z: 2 } });
    expect(collisionReason(a, [a, b], W, D)).toEqual({ kind: 'item', id: 'b' });
    expect(collisionMessage(a, [a, b], W, D)).toBe('It overlaps the Bookcase.');
  });

  it('is null for an item standing clear, and for an unplaced one', () => {
    const item = makeItem({ position: { x: 0, z: 2 } });
    expect(collisionReason(item, [item], W, D)).toBeNull();
    expect(collisionMessage(item, [item], W, D)).toBeNull();
  });

  it('has a reason exactly when hasCollisions says so, over a sweep of the room', () => {
    const other = makeItem({ id: 'other', position: { x: 1, z: 1 } });
    const context = { keepOut: [porch], interiorWalls: [partition] };
    let red = 0;
    for (let x = -5; x <= 5; x += 0.5) {
      for (let z = -5; z <= 5; z += 0.5) {
        const item = makeItem({ id: 'probe', position: { x, z } });
        const items = [item, other];
        const reason = collisionReason(item, items, W, D, context);
        expect(reason !== null).toBe(hasCollisions(item, items, W, D, context));
        if (reason) red += 1;
      }
    }
    expect(red).toBeGreaterThan(0);
  });
});
