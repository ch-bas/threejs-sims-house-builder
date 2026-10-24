import { describe, expect, it } from 'vitest';
import { clampToFootprint } from './footprint';
import { INTERIOR_WALL_THICKNESS } from './opening-snap';
import { buildWalkColliders } from './walk-collision';

describe('clampToFootprint (#451)', () => {
  it('keeps an item inside the room by its rotated footprint', () => {
    const sofa = { width: 2, depth: 1, rotation: 0 };
    expect(clampToFootprint(sofa, { x: 10, z: -10 }, 8, 6)).toEqual({ x: 3, z: -2.5 });
    // A quarter turn swaps the extents.
    const turned = clampToFootprint({ ...sofa, rotation: Math.PI / 2 }, { x: 10, z: -10 }, 8, 6);
    expect(turned.x).toBeCloseTo(3.5);
    expect(turned.z).toBeCloseTo(-2);
  });

  it('leaves a position that already fits alone', () => {
    expect(clampToFootprint({ width: 1, depth: 1 }, { x: 1.25, z: -0.5 }, 8, 6)).toEqual({ x: 1.25, z: -0.5 });
  });

  it('centres an item wider than the room instead of flipping it past the far wall', () => {
    expect(clampToFootprint({ width: 10, depth: 1 }, { x: 3, z: 0 }, 8, 6)).toEqual({ x: 0, z: 0 });
  });
});

describe('INTERIOR_WALL_THICKNESS (#451)', () => {
  it('is the slab the walker collides with', () => {
    const colliders = buildWalkColliders([], [{ id: 'w', x1: -2, z1: 0, x2: 2, z2: 0 }], { roomWidth: 8, roomDepth: 8 });
    expect(colliders).toHaveLength(1);
    const [wall] = colliders;
    expect(wall!.hd * 2).toBeCloseTo(INTERIOR_WALL_THICKNESS);
    expect(wall!.hw * 2).toBeCloseTo(4);
  });
});
