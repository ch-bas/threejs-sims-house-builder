import { describe, expect, it } from 'vitest';
import { settleWallMountedItem } from './opening-snap';

// 8×8 room throughout: walls at x = ±4, z = ±4.
const W = 8;
const D = 8;

describe('settleWallMountedItem (#116)', () => {
  it('returns null for items that do not mount on walls', () => {
    expect(settleWallMountedItem({ type: 'sofa', width: 2, depth: 0.9, rotation: 0 }, { x: 1, z: 1 }, W, D)).toBeNull();
  });

  it('snaps a door back onto the nearest wall and re-aligns its rotation', () => {
    const settled = settleWallMountedItem(
      { type: 'door', width: 0.9, depth: 0.12, rotation: Math.PI / 2 },
      { x: 0.3, z: -3.2 },
      W,
      D
    );
    expect(settled).not.toBeNull();
    // North wall (z = -4) is nearest; its aligned rotation is 0.
    expect(settled!.position).toEqual({ x: 0.3, z: -4 });
    expect(settled!.rotation).toBe(0);
  });

  it('omits the rotation patch when the opening is already wall-aligned', () => {
    const settled = settleWallMountedItem(
      { type: 'window', width: 1.2, depth: 0.12, rotation: 0 },
      { x: -1, z: -3.5 },
      W,
      D
    );
    expect(settled!.position).toEqual({ x: -1, z: -4 });
    expect(settled!.rotation).toBeUndefined();
  });

  it('seats a flush camera against the nearest wall and records the wall rotation', () => {
    const settled = settleWallMountedItem(
      { type: 'security-camera', width: 0.3, depth: 0.2, rotation: 0 },
      { x: 3.5, z: 0.5 },
      W,
      D
    );
    // East wall (x = 4): inward normal rotation is -π/2; body inset by
    // depth/2 + 0.02 so the back face rests on the wall.
    expect(settled!.wallRotation).toBeCloseTo(-Math.PI / 2, 10);
    expect(settled!.position.x).toBeCloseTo(4 - 0.12, 10);
    expect(settled!.position.z).toBeCloseTo(0.5, 10);
    expect(settled!.rotation).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('clamps the settled opening within the wall ends', () => {
    const settled = settleWallMountedItem(
      { type: 'door', width: 0.9, depth: 0.12, rotation: 0 },
      { x: 7.5, z: -3.9 },
      W,
      D
    );
    // x is clamped so the whole 0.9 m door stays on the 8 m wall.
    expect(settled!.position.x).toBeCloseTo(4 - 0.45, 10);
    expect(settled!.position.z).toBe(-4);
  });
});
