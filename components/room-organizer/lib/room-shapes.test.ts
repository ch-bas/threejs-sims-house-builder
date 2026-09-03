import { describe, expect, it } from 'vitest';
import { generateRoomShape } from './room-shapes';

describe('generateRoomShape — hexagon orientation (#122)', () => {
  it('stamps a flat-top hexagon spanning the full requested width', () => {
    const walls = generateRoomShape('hexagon', 0, 0, 4, 4, 'test');
    const xs = walls.flatMap((w) => [w.x1, w.x2]);
    const zs = walls.flatMap((w) => [w.z1, w.z2]);
    // Full width: vertices at 0°/180° reach ±width/2.
    expect(Math.max(...xs)).toBeCloseTo(2, 10);
    expect(Math.min(...xs)).toBeCloseTo(-2, 10);
    // Flat top and bottom: the extreme z is shared by TWO vertices (an edge),
    // not a single point — the old +30° phase produced a pointy top.
    const maxZ = Math.max(...zs);
    const topVertices = new Set(
      walls.flatMap((w) => [
        ...(Math.abs(w.z1 - maxZ) < 1e-9 ? [w.x1] : []),
        ...(Math.abs(w.z2 - maxZ) < 1e-9 ? [w.x2] : []),
      ])
    );
    expect(topVertices.size).toBe(2);
  });
});
