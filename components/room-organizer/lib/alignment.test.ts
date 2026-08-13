import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { alignSelection, distributeSelection } from './alignment';

describe('alignSelection — edge alignment', () => {
  const items = [
    makeItem({ id: 'a', width: 2, depth: 2, position: { x: 0, z: 0 } }),
    makeItem({ id: 'b', width: 4, depth: 4, position: { x: 6, z: 3 } }),
  ];
  const ids = new Set(['a', 'b']);

  it('min-x aligns left edges', () => {
    const result = alignSelection(items, ids, 'min-x');
    // Leftmost edge is a's: 0 - 1 = -1. Each item centre = -1 + halfWidth.
    expect(result.get('a')!.x).toBeCloseTo(-1 + 1, 10); // 0
    expect(result.get('b')!.x).toBeCloseTo(-1 + 2, 10); // 1
  });

  it('max-x aligns right edges', () => {
    const result = alignSelection(items, ids, 'max-x');
    // Rightmost edge is b's: 6 + 2 = 8. Each centre = 8 - halfWidth.
    expect(result.get('a')!.x).toBeCloseTo(8 - 1, 10); // 7
    expect(result.get('b')!.x).toBeCloseTo(8 - 2, 10); // 6
  });

  it('center-x aligns centres to the average', () => {
    const result = alignSelection(items, ids, 'center-x');
    const avg = (0 + 6) / 2; // 3
    expect(result.get('a')!.x).toBeCloseTo(avg, 10);
    expect(result.get('b')!.x).toBeCloseTo(avg, 10);
  });

  it('min-z aligns top edges and leaves x untouched', () => {
    const result = alignSelection(items, ids, 'min-z');
    const minZ = Math.min(0 - 1, 3 - 2); // min(-1, 1) = -1
    expect(result.get('a')!.z).toBeCloseTo(minZ + 1, 10); // 0
    expect(result.get('b')!.z).toBeCloseTo(minZ + 2, 10); // 1
    expect(result.get('a')!.x).toBeCloseTo(0, 10);
  });

  it('returns an empty map for fewer than two positioned items', () => {
    expect(alignSelection(items, new Set(['a']), 'min-x').size).toBe(0);
  });
});

describe('distributeSelection', () => {
  it('evenly spaces the middle items along X, keeping the ends fixed', () => {
    const items = [
      makeItem({ id: 'a', position: { x: 0, z: 0 } }),
      makeItem({ id: 'b', position: { x: 1, z: 0 } }),
      makeItem({ id: 'c', position: { x: 9, z: 0 } }),
    ];
    const result = distributeSelection(items, new Set(['a', 'b', 'c']), 'x');
    // Ends fixed, middle placed at start + step*1 = 0 + 4.5.
    expect(result.has('a')).toBe(false);
    expect(result.has('c')).toBe(false);
    expect(result.get('b')!.x).toBeCloseTo(4.5, 10);
  });

  it('distributes along Z and leaves x untouched', () => {
    const items = [
      makeItem({ id: 'a', position: { x: 2, z: 0 } }),
      makeItem({ id: 'b', position: { x: 3, z: 5 } }),
      makeItem({ id: 'c', position: { x: 4, z: 10 } }),
    ];
    const result = distributeSelection(items, new Set(['a', 'b', 'c']), 'z');
    expect(result.get('b')!.z).toBeCloseTo(5, 10);
    expect(result.get('b')!.x).toBeCloseTo(3, 10);
  });

  it('returns an empty map for fewer than three positioned items', () => {
    const items = [makeItem({ id: 'a', position: { x: 0, z: 0 } }), makeItem({ id: 'b', position: { x: 1, z: 0 } })];
    expect(distributeSelection(items, new Set(['a', 'b']), 'x').size).toBe(0);
  });
});
