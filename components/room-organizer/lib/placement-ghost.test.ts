import { describe, expect, it } from 'vitest';
import { makeCatalogItem } from './__testfixtures__/fixtures';
import { rotatedHalfExtents } from './footprint';
import { footprintCorners, ghostItem, ghostOutlinePoints, GHOST_ITEM_ID, groundUnderPointer, invertClientToWorld } from './placement-ghost';
import { gardenGroundY } from './site';
import type { Vec2 } from './types';

describe('placement ghost helpers (#463 d)', () => {
  it('makes the catalogue entry an item at the spot', () => {
    const item = ghostItem(makeCatalogItem({ name: 'Desk' }), { x: 1, z: 2 }, 0.5);
    expect(item).toMatchObject({ id: GHOST_ITEM_ID, name: 'Desk', position: { x: 1, z: 2 }, rotation: 0.5 });
  });

  it('puts the footprint corners where the rotated item reaches', () => {
    const size = { width: 2, depth: 1 };
    for (const rotation of [0, Math.PI / 2, 0.7]) {
      const corners = footprintCorners(size, { x: 3, z: -1 }, rotation);
      const { halfW, halfD } = rotatedHalfExtents({ ...size, rotation });
      const xs = corners.map((c) => c.x);
      const zs = corners.map((c) => c.z);
      expect(Math.max(...xs) - 3).toBeCloseTo(halfW, 10);
      expect(Math.min(...xs) - 3).toBeCloseTo(-halfW, 10);
      expect(Math.max(...zs) + 1).toBeCloseTo(halfD, 10);
      expect(Math.min(...zs) + 1).toBeCloseTo(-halfD, 10);
    }
  });

  it('inverts the plan’s client → world mapping', () => {
    // A plan at 40 px/m, room centre at (500, 300).
    const toWorld = (x: number, y: number) => ({ x: (x - 500) / 40, z: (y - 300) / 40 });
    const toClient = invertClientToWorld(toWorld, { x: 10, y: 20 })!;
    for (const [x, y] of [[500, 300], [123, 456], [800, 40]] as const) {
      const back = toClient(toWorld(x, y));
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.y).toBeCloseTo(y, 9);
    }
  });

  it('gives no inverse when the mapping is unavailable or flat', () => {
    expect(invertClientToWorld(() => null)).toBeNull();
    expect(invertClientToWorld(() => ({ x: 0, z: 0 }))).toBeNull();
  });

  it('writes the outline as SVG points', () => {
    const points = ghostOutlinePoints([{ x: 0, z: 0 }, { x: 1, z: 2 }], (w) => ({ x: w.x * 10, y: w.z * 10 }));
    expect(points).toBe('0.0,0.0 10.0,20.0');
  });
});

describe('groundUnderPointer: a garden ghost on a slope (#665)', () => {
  // A 10 × 8 house on a site falling 3 m to the street, seen from the street.
  const site = { width: 10, height: 8, terrain: { frontY: -3, backY: 2 } };
  const ground = (position: Vec2) => gardenGroundY({ category: 'outdoor' }, 0, position, site);
  const eye = { x: 0, y: 16, z: -22 };
  /** The pointer's ray, through the floor plane (y = 0) at `floorZ`. */
  const ray = (floorZ: number) => (planeY = 0): Vec2 => {
    const t = (planeY - eye.y) / (0 - eye.y);
    return { x: 0, z: eye.z + (floorZ - eye.z) * t };
  };

  it('finds the lawn under the pointer, not the floor plane', () => {
    const at = groundUnderPointer(ray(-10), ground)!;
    // The ray meets y = -3 further out than y = 0.
    expect(at.z).toBeCloseTo(ray(-10)(-3).z);
  });

  it('over the plinth, stops at the front wall instead of jumping inside the house', () => {
    // At y = 0 the ray is in the garden, at y = -3 under the house.
    expect(ground(ray(-4.5)(-3))).toBeNull();
    const at = groundUnderPointer(ray(-4.5), ground)!;
    expect(at.z).toBeLessThanOrEqual(-4);
    expect(at.z).toBeGreaterThan(-4.01);
  });

  it('leaves the floor point alone where nothing stands on the ground', () => {
    expect(groundUnderPointer(ray(-2), ground)).toEqual(ray(-2)());
    expect(groundUnderPointer(ray(-10), () => null)).toEqual(ray(-10)());
  });
});
