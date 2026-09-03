import { describe, expect, it } from 'vitest';
import { ROOM_SHAPES, generateRoomShape } from './room-shapes';

describe('generateRoomShape — every shape (#123)', () => {
  it.each(ROOM_SHAPES.map((shape) => [shape.id]))('%s fits the requested bounds and closes its outline', (id) => {
    const walls = generateRoomShape(id, 0, 0, 5, 4, 'test');
    expect(walls.length).toBeGreaterThanOrEqual(3);
    const eps = 1e-9;
    for (const wall of walls) {
      for (const [x, z] of [
        [wall.x1, wall.z1],
        [wall.x2, wall.z2],
      ]) {
        expect(Math.abs(x!)).toBeLessThanOrEqual(2.5 + eps);
        expect(Math.abs(z!)).toBeLessThanOrEqual(2 + eps);
      }
    }
    // Closed loop: every vertex is shared by exactly two wall endpoints.
    const counts = new Map<string, number>();
    for (const wall of walls) {
      for (const key of [`${wall.x1.toFixed(6)},${wall.z1.toFixed(6)}`, `${wall.x2.toFixed(6)},${wall.z2.toFixed(6)}`]) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    for (const [vertex, count] of counts) {
      expect(count, `vertex ${vertex} of ${id}`).toBe(2);
    }
  });
});

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
