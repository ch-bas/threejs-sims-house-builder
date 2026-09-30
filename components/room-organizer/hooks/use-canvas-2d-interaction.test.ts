import { describe, expect, it } from 'vitest';
import { canvasToWorld, get2DViewTransform, type View2DTransform } from '../canvas-2d/render';
import { makeItem, makeLayout, makeUnplacedItem } from '../lib/__testfixtures__/fixtures';
import { hitTest2DItems } from './use-canvas-2d-interaction';

// Forward mapping exactly as render2DTopDown draws item centres.
function worldToCanvas(
  wx: number,
  wz: number,
  transform: View2DTransform,
  layout: { width: number; height: number }
): { px: number; py: number } {
  return {
    px: transform.offsetX + (wx + layout.width / 2) * transform.scale,
    py: transform.offsetY + (wz + layout.height / 2) * transform.scale,
  };
}

describe('get2DViewTransform / canvasToWorld (#166, #219)', () => {
  const layout = makeLayout({ width: 8, height: 6 });

  it('fits and centres the room exactly as render2DTopDown did', () => {
    const { scale, offsetX, offsetY } = get2DViewTransform(800, 600, layout);
    // scale = min((800-120)/8, (600-120)/6) = min(85, 80).
    expect(scale).toBe(80);
    expect(offsetX).toBe((800 - 8 * 80) / 2);
    expect(offsetY).toBe((600 - 6 * 80) / 2);
  });

  it('honours a custom padding (minimap-sized consumers)', () => {
    const { scale } = get2DViewTransform(180, 130, layout, 8);
    expect(scale).toBe(Math.min((180 - 16) / 8, (130 - 16) / 6));
  });

  it('maps the canvas centre to the world origin', () => {
    const transform = get2DViewTransform(1024, 768, layout);
    const world = canvasToWorld(512, 384, transform, layout);
    expect(world.x).toBeCloseTo(0, 10);
    expect(world.z).toBeCloseTo(0, 10);
  });

  it('round-trips world → canvas → world across the room', () => {
    const transform = get2DViewTransform(937, 611, layout);
    const points = [
      { x: 0, z: 0 },
      { x: -4, z: -3 },
      { x: 4, z: 3 },
      { x: 1.37, z: -2.09 },
    ];
    for (const point of points) {
      const { px, py } = worldToCanvas(point.x, point.z, transform, layout);
      const back = canvasToWorld(px, py, transform, layout);
      expect(back.x).toBeCloseTo(point.x, 10);
      expect(back.z).toBeCloseTo(point.z, 10);
    }
  });

  it('round-trips canvas → world → canvas', () => {
    const transform = get2DViewTransform(640, 480, layout);
    const back = worldToCanvas(
      canvasToWorld(123.4, 321.9, transform, layout).x,
      canvasToWorld(123.4, 321.9, transform, layout).z,
      transform,
      layout
    );
    expect(back.px).toBeCloseTo(123.4, 10);
    expect(back.py).toBeCloseTo(321.9, 10);
  });
});

describe('hitTest2DItems (#219)', () => {
  it('hits an unrotated item inside its rect and misses just outside', () => {
    const item = makeItem({ width: 1, depth: 0.5, position: { x: 2, z: -1 } });
    expect(hitTest2DItems([item], 2.4, -1)?.id).toBe(item.id);
    expect(hitTest2DItems([item], 2.6, -1)).toBeNull();
    expect(hitTest2DItems([item], 2, -0.7)).toBeNull();
  });

  it('respects rotation: a 90°-rotated item swaps its extents', () => {
    const item = makeItem({ width: 2, depth: 0.5, rotation: Math.PI / 2, position: { x: 0, z: 0 } });
    // Along world Z the rotated width now extends ±1; along X only ±0.25.
    expect(hitTest2DItems([item], 0, 0.9)?.id).toBe(item.id);
    expect(hitTest2DItems([item], 0.9, 0)).toBeNull();
  });

  it('is an exact rotated-rect test, not the rotated AABB', () => {
    const item = makeItem({ width: 2, depth: 0.5, rotation: Math.PI / 4, position: { x: 0, z: 0 } });
    // (0.7, 0.7) lies inside the rotated AABB (half-extents ≈ 0.88) but its
    // depth-axis projection is ≈ 0.99 > 0.25 — outside the oriented rect.
    expect(hitTest2DItems([item], 0.7, 0.7)).toBeNull();
    // A point 0.9 m out along the rotated width axis (cos, −sin) is inside.
    expect(hitTest2DItems([item], 0.9 * Math.SQRT1_2, -0.9 * Math.SQRT1_2)?.id).toBe(item.id);
  });

  it('returns the topmost item (last in draw order) on overlap', () => {
    const below = makeItem({ id: 'below', position: { x: 0, z: 0 } });
    const above = makeItem({ id: 'above', position: { x: 0.2, z: 0 } });
    expect(hitTest2DItems([below, above], 0.1, 0)?.id).toBe('above');
    // Order flipped, the other is drawn last and wins.
    expect(hitTest2DItems([above, below], 0.1, 0)?.id).toBe('below');
  });

  it('returns null on empty space and skips unplaced items', () => {
    const unplaced = makeUnplacedItem({ id: 'unplaced' });
    const placed = makeItem({ id: 'placed', position: { x: 3, z: 3 } });
    expect(hitTest2DItems([unplaced, placed], 0, 0)).toBeNull();
    expect(hitTest2DItems([], 0, 0)).toBeNull();
  });
});

describe('hitTest2DItems layer order + hit slop (#286)', () => {
  it('picks the sofa over a rug listed after it (the Living Room template)', () => {
    const sofa = makeItem({ id: 'sofa', type: 'sofa', width: 2, depth: 0.9, height: 0.8, position: { x: 0, z: -1.5 } });
    const rug = makeItem({ id: 'rug', type: 'rug', width: 2, depth: 1.4, height: 0.02, position: { x: 0, z: -0.5 } });
    // (0, −1.1) is inside both footprints; the sofa is the upper layer.
    expect(hitTest2DItems([sofa, rug], 0, -1.1)?.id).toBe('sofa');
    expect(hitTest2DItems([rug, sofa], 0, -1.1)?.id).toBe('sofa');
    // Rug-only area still hits the rug.
    expect(hitTest2DItems([sofa, rug], 0, 0)?.id).toBe('rug');
  });

  it('picks a tabletop item over the desk added after it, and a camera over a cabinet', () => {
    const lamp = makeItem({ id: 'lamp', type: 'lamp', width: 0.3, depth: 0.3, height: 1.5, position: { x: 0.5, z: 0 } });
    const desk = makeItem({ id: 'desk', type: 'desk', width: 1.2, depth: 0.6, height: 0.75, position: { x: 0, z: 0 } });
    expect(hitTest2DItems([lamp, desk], 0.5, 0)?.id).toBe('lamp');
    const camera = makeItem({ id: 'cam', type: 'security-camera', width: 0.25, depth: 0.2, height: 2.4, position: { x: 0, z: 0 } });
    const cabinet = makeItem({ id: 'cabinet', type: 'cabinet', width: 1, depth: 0.5, height: 1.8, position: { x: 0, z: 0 } });
    expect(hitTest2DItems([camera, cabinet], 0, 0)?.id).toBe('cam');
  });

  it('applies the slop to wall-mounted and sub-0.3 m items only', () => {
    const wifi = makeItem({ id: 'wifi', type: 'wifi', width: 0.2, depth: 0.2, height: 0.1, position: { x: 0, z: 0 } });
    // 0.05 m outside the puck's edge: a miss without slop, a hit with it.
    expect(hitTest2DItems([wifi], 0.15, 0)).toBeNull();
    expect(hitTest2DItems([wifi], 0.15, 0, 0.06)?.id).toBe('wifi');
    const window = makeItem({ id: 'win', type: 'window', width: 1.2, depth: 0.12, height: 1.2, position: { x: 0, z: -2 } });
    expect(hitTest2DItems([window], 0, -2.1)).toBeNull();
    expect(hitTest2DItems([window], 0, -2.1, 0.06)?.id).toBe('win');
    // A sofa is a large target: the slop never widens it.
    const sofa = makeItem({ id: 'sofa', type: 'sofa', width: 2, depth: 0.9, height: 0.8, position: { x: 0, z: 0 } });
    expect(hitTest2DItems([sofa], 0, 0.48, 0.06)).toBeNull();
  });

  it('slop respects the item rotation', () => {
    const cam = makeItem({ id: 'cam', type: 'security-camera', width: 0.25, depth: 0.2, height: 2.4, rotation: Math.PI / 2, position: { x: 0, z: 0 } });
    // Rotated 90°: width (0.25) now runs along world Z. 0.16 m along Z is
    // 0.035 m past the edge — inside a 0.05 m slop; 0.2 m is not.
    expect(hitTest2DItems([cam], 0, 0.16, 0.05)?.id).toBe('cam');
    expect(hitTest2DItems([cam], 0, 0.2, 0.05)).toBeNull();
  });
});
