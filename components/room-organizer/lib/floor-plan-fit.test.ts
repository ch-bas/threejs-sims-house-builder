import { describe, expect, it } from 'vitest';
import {
  calibrateFloorPlan,
  calibrationProblem,
  computeFloorPlanPlacement,
  floorPlanCanvasLayout,
  floorPlanCanvasLayoutFor,
  floorPlanFitOf,
  floorPlanPlacement,
  imagePixelAt,
  MAX_FLOOR_PLAN_OFFSET,
  movedFloorPlan,
  repairFloorPlanTransform,
  type FloorPlanFit,
} from './floor-plan-fit';

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

describe('calibrated tracing image (#726)', () => {
  // A 1000×500 px scan over an 8 × 6 m house.
  const room = { width: 8, depth: 6 };
  const fitted: FloorPlanFit = { ...room, mode: 'contain' };

  it('keeps the fit modes when there is no calibration', () => {
    expect(floorPlanPlacement(1000, 500, fitted)).toEqual(computeFloorPlanPlacement(1000, 500, 8 / 6, 'contain'));
    expect(floorPlanFitOf({ width: 8, height: 6 })).toEqual({ width: 8, depth: 6, mode: 'stretch' });
    expect(floorPlanCanvasLayoutFor(1000, 500, fitted)).toEqual(floorPlanCanvasLayout(1000, 500, 8 / 6, 'contain'));
  });

  it('places a calibrated image at its own scale, centred on its offset', () => {
    // 1 cm a pixel: 10 × 5 m, centred 1 m east of the room's centre.
    const { source, dest } = floorPlanPlacement(1000, 500, { ...fitted, transform: { scale: 0.01, offsetX: 1, offsetZ: 0 } });
    expect(source).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
    expect(dest.w * room.width).toBeCloseTo(10, 9);
    expect(dest.h * room.depth).toBeCloseTo(5, 9);
    // Left edge at 1 - 5 = -4 m, which is the room's west wall.
    expect(dest.x).toBeCloseTo(0, 9);
    expect(dest.y * room.depth - room.depth / 2).toBeCloseTo(-2.5, 9);
  });

  it('maps world points to the image pixels painted under them, in every mode', () => {
    for (const mode of ['stretch', 'cover', 'contain'] as const) {
      const fit = { ...room, mode };
      const { source, dest } = floorPlanPlacement(1000, 500, fit);
      // The centre of the painted rectangle is the centre of its source.
      const centre = { x: (dest.x + dest.w / 2) * room.width - room.width / 2, z: (dest.y + dest.h / 2) * room.depth - room.depth / 2 };
      const pixel = imagePixelAt(centre, 1000, 500, fit);
      expect(pixel.x, mode).toBeCloseTo(source.x + source.w / 2, 6);
      expect(pixel.y, mode).toBeCloseTo(source.y + source.h / 2, 6);
    }
  });

  it('scales the image so the two points measure the length typed, the first point fixed', () => {
    const a = { x: -2, z: 0.5 };
    const b = { x: 1, z: 0.5 };
    const transform = calibrateFloorPlan(a, b, 6, 1000, 500, fitted);
    expect(transform).not.toBeNull();
    const after = { ...fitted, transform: transform! };
    // The pixel under `a` before is still under `a`.
    const pa = imagePixelAt(a, 1000, 500, fitted);
    const pb = imagePixelAt(b, 1000, 500, fitted);
    expect(imagePixelAt(a, 1000, 500, after).x).toBeCloseTo(pa.x, 6);
    expect(imagePixelAt(a, 1000, 500, after).y).toBeCloseTo(pa.y, 6);
    // And the pixel under `b` is now 6 m from `a`.
    expect(Math.hypot(pb.x - pa.x, pb.y - pa.y) * transform!.scale).toBeCloseTo(6, 9);
  });

  it('calibrates a stretched image to one scale both ways', () => {
    const stretch: FloorPlanFit = { ...room, mode: 'stretch' };
    const transform = calibrateFloorPlan({ x: -4, z: 0 }, { x: 4, z: 0 }, 8, 1000, 500, stretch)!;
    expect(transform.scale).toBeCloseTo(8 / 1000, 9);
    const { dest } = floorPlanPlacement(1000, 500, { ...stretch, transform });
    expect(dest.h * room.depth).toBeCloseTo(4, 9);
  });

  it('refuses a calibration it cannot make', () => {
    const a = { x: 0, z: 0 };
    expect(calibrateFloorPlan(a, a, 3, 1000, 500, fitted)).toBeNull();
    expect(calibrateFloorPlan(a, { x: 1, z: 0 }, 0, 1000, 500, fitted)).toBeNull();
    expect(calibrateFloorPlan(a, { x: 1, z: 0 }, Number.NaN, 1000, 500, fitted)).toBeNull();
    expect(calibrateFloorPlan(a, { x: 1, z: 0 }, 1e6, 1000, 500, fitted)).toBeNull();
  });

  it('says why it cannot calibrate, so the message can', () => {
    const a = { x: 0, z: 0 };
    const b = { x: 1, z: 0 };
    expect(calibrationProblem(a, b, 3, 1000, 500, fitted)).toBeNull();
    expect(calibrationProblem(a, b, 0, 1000, 500, fitted)).toBe('length');
    expect(calibrationProblem(a, b, Number.NaN, 1000, 500, fitted)).toBe('length');
    expect(calibrationProblem(a, a, 3, 1000, 500, fitted)).toBe('points');
    expect(calibrationProblem(a, b, 1e6, 1000, 500, fitted)).toBe('scale');
    expect(calibrationProblem(a, b, 1e-4, 1000, 500, fitted)).toBe('scale');
  });

  it('moves a calibrated image, within reach of the room', () => {
    const t = { scale: 0.01, offsetX: 0, offsetZ: 0 };
    expect(movedFloorPlan(t, 0, 0)).toBe(t);
    expect(movedFloorPlan(t, 1.5, -2)).toEqual({ scale: 0.01, offsetX: 1.5, offsetZ: -2 });
    expect(movedFloorPlan(t, 1e9, 0).offsetX).toBe(MAX_FLOOR_PLAN_OFFSET);
    expect(movedFloorPlan(t, Number.NaN, 0)).toBe(t);
  });

  it('draws a calibrated image into the 3D canvas where the plan paints it', () => {
    const layout = floorPlanCanvasLayoutFor(1000, 500, { ...fitted, transform: { scale: 0.01, offsetX: 1, offsetZ: 0 } });
    // The room at the image's resolution: 8 m at 100 px a metre.
    expect(layout.width).toBe(800);
    expect(layout.height).toBe(600);
    expect(layout.dest).toMatchObject({ x: 0, w: 1000, h: 500 });
    expect(layout.dest.y).toBeCloseTo(50, 9);
  });

  it('repairs a stored calibration rather than refusing the house', () => {
    const good = { scale: 0.02, offsetX: 1, offsetZ: -1 };
    expect(repairFloorPlanTransform(good)).toBe(good);
    expect(repairFloorPlanTransform({ ...good, extra: 1 })).toEqual(good);
    expect(repairFloorPlanTransform({ ...good, offsetX: 1e6 })).toEqual({ ...good, offsetX: MAX_FLOOR_PLAN_OFFSET });
    for (const bad of [null, 3, [], {}, { ...good, scale: 0 }, { ...good, scale: -1 }, { ...good, scale: 2 }, { ...good, offsetZ: Number.NaN }, { ...good, scale: '0.1' }]) {
      expect(repairFloorPlanTransform(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });
});
