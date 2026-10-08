import { describe, expect, it } from 'vitest';
import { floorPlanCanvasLayout } from './floor-plan-fit';

describe('floorPlanCanvasLayout (#191)', () => {
  it('stretch keeps the image as is', () => {
    const layout = floorPlanCanvasLayout(1200, 600, 1, 'stretch');
    expect(layout).toMatchObject({ width: 1200, height: 600 });
    expect(layout.dest).toEqual({ x: 0, y: 0, w: 1200, h: 600 });
  });

  it('contain pads a 2:1 plan to a square room with bands, image at native size', () => {
    const layout = floorPlanCanvasLayout(1200, 600, 1, 'contain');
    expect(layout).toMatchObject({ width: 1200, height: 1200 });
    expect(layout.source).toEqual({ x: 0, y: 0, w: 1200, h: 600 });
    expect(layout.dest).toEqual({ x: 0, y: 300, w: 1200, h: 600 });
  });

  it('contain pads a tall plan sideways', () => {
    const layout = floorPlanCanvasLayout(500, 1000, 2, 'contain');
    expect(layout).toMatchObject({ width: 2000, height: 1000 });
    expect(layout.dest).toEqual({ x: 750, y: 0, w: 500, h: 1000 });
  });

  it('cover crops to the room aspect and fills the canvas', () => {
    const layout = floorPlanCanvasLayout(1200, 600, 1, 'cover');
    expect(layout).toMatchObject({ width: 600, height: 600 });
    expect(layout.source).toEqual({ x: 300, y: 0, w: 600, h: 600 });
    expect(layout.dest).toEqual({ x: 0, y: 0, w: 600, h: 600 });
  });

  it('the canvas always has the room aspect outside stretch mode', () => {
    for (const mode of ['cover', 'contain'] as const) {
      const { width, height } = floorPlanCanvasLayout(1000, 300, 1.6, mode);
      expect(width / height).toBeCloseTo(1.6, 2);
    }
  });

  it('caps the larger side, scaling the placement with it', () => {
    const layout = floorPlanCanvasLayout(4000, 1000, 0.5, 'contain', 2048);
    expect(layout.height).toBe(2048);
    expect(layout.width).toBe(1024);
    expect(layout.dest.w).toBeCloseTo(1024);
    expect(layout.dest.h).toBeCloseTo(256);
    expect(layout.dest.y).toBeCloseTo((2048 - 256) / 2);
  });
});
