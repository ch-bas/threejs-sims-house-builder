import { describe, expect, it } from 'vitest';
import { makeCatalogItem } from './__testfixtures__/fixtures';
import { rotatedHalfExtents } from './geometry';
import { footprintCorners, ghostItem, ghostOutlinePoints, GHOST_ITEM_ID, invertClientToWorld } from './placement-ghost';

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
