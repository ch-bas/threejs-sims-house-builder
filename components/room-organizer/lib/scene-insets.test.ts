import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MIN_HOUSE_SHARE, frameBox, frameInRegion, houseFrameBox, isCompactViewport, regionViewOffset, visibleRegion } from './scene-insets';
import type { FrameInput, Rect } from './scene-insets';

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });

describe('isCompactViewport', () => {
  it('keeps the desktop framing only when the viewport is both wide and tall', () => {
    expect(isCompactViewport(1440, 900)).toBe(false);
    expect(isCompactViewport(1101, 701)).toBe(false);
    expect(isCompactViewport(1100, 900)).toBe(true);
    expect(isCompactViewport(1440, 700)).toBe(true);
    expect(isCompactViewport(390, 664)).toBe(true);
  });
});

describe('visibleRegion', () => {
  const screen = rect(0, 0, 390, 664);

  it('is the whole canvas when nothing covers it', () => {
    expect(visibleRegion(screen, [])).toEqual(screen);
  });

  it('ignores occluders outside the canvas', () => {
    expect(visibleRegion(screen, [rect(400, 0, 500, 100), rect(0, -80, 390, 0)])).toEqual(screen);
  });

  it('is the band between a top bar and a bottom HUD', () => {
    expect(visibleRegion(screen, [rect(8, 8, 382, 60), rect(0, 380, 390, 664)])).toEqual(rect(0, 60, 390, 380));
  });

  it('picks the largest free rectangle around a side column', () => {
    // Left column, top 60–300, 100 wide; bottom HUD from 400.
    const region = visibleRegion(screen, [rect(0, 60, 100, 300), rect(0, 400, 390, 664)]);
    // Full width above the column loses to the band right of it.
    expect(region).toEqual(rect(100, 0, 390, 400));
  });

  it('falls back to the whole canvas when only a sliver is free', () => {
    expect(visibleRegion(screen, [rect(0, 60, 390, 664)])).toEqual(screen);
  });

  it('never overlaps an occluder', () => {
    const occluders = [rect(10, 10, 120, 50), rect(250, 12, 380, 90), rect(0, 300, 120, 360), rect(0, 360, 390, 664)];
    const region = visibleRegion(screen, occluders);
    for (const o of occluders) {
      const overlap = region.left < o.right && o.left < region.right && region.top < o.bottom && o.top < region.bottom;
      expect(overlap).toBe(false);
    }
    // 390×210 under the top-right pill beats 270×270 beside the column.
    expect(region).toEqual(rect(0, 90, 390, 300));
  });
});

/** Projects the box corners through a real three camera; returns their pixel bounds. */
function projectedBounds(input: FrameInput): Rect {
  const frame = frameBox(input);
  const camera = new PerspectiveCamera(input.fovDeg, input.canvasWidth / input.canvasHeight, 0.3, 1000);
  camera.position.set(...frame.position);
  camera.lookAt(...frame.target);
  camera.setViewOffset(input.canvasWidth, input.canvasHeight, frame.offsetX, frame.offsetY, input.canvasWidth, input.canvasHeight);
  camera.updateMatrixWorld();
  const out = rect(Infinity, Infinity, -Infinity, -Infinity);
  for (const x of [input.boxMin[0], input.boxMax[0]]) {
    for (const y of [input.boxMin[1], input.boxMax[1]]) {
      for (const z of [input.boxMin[2], input.boxMax[2]]) {
        const p = new Vector3(x, y, z).project(camera);
        const px = ((p.x + 1) / 2) * input.canvasWidth;
        const py = ((1 - p.y) / 2) * input.canvasHeight;
        out.left = Math.min(out.left, px);
        out.right = Math.max(out.right, px);
        out.top = Math.min(out.top, py);
        out.bottom = Math.max(out.bottom, py);
      }
    }
  }
  return out;
}

describe('frameBox', () => {
  const base: FrameInput = {
    canvasWidth: 390,
    canvasHeight: 664,
    region: rect(0, 60, 390, 380),
    fovDeg: 75,
    boxMin: [-4, 0, -4],
    boxMax: [4, 3, 4],
    direction: [0, 1, 1],
    margin: 0.05,
  };

  it('orbits the box centre along the requested direction', () => {
    const frame = frameBox(base);
    expect(frame.target).toEqual([0, 1.5, 0]);
    const d = [frame.position[0] - 0, frame.position[1] - 1.5, frame.position[2] - 0];
    expect(d[0]).toBeCloseTo(0);
    expect(d[1]).toBeCloseTo(d[2]!);
  });

  it('fits every corner inside the visible region, touching its margin', () => {
    for (const input of [
      base,
      { ...base, direction: [0.6, 0.7, 0.6] as const },
      { ...base, region: rect(100, 0, 390, 400) },
      { ...base, canvasWidth: 750, canvasHeight: 342, region: rect(0, 50, 520, 342) },
      { ...base, boxMax: [4, 9, 4] as const },
    ]) {
      const bounds = projectedBounds(input);
      const { region } = input;
      const slackX = Math.min(bounds.left - region.left, region.right - bounds.right);
      const slackY = Math.min(bounds.top - region.top, region.bottom - bounds.bottom);
      expect(slackX).toBeGreaterThan(-1e-6);
      expect(slackY).toBeGreaterThan(-1e-6);
      // Tight: the binding corner sits exactly on the margin.
      const marginX = ((region.right - region.left) * 0.05) / 1.1;
      const marginY = ((region.bottom - region.top) * 0.05) / 1.1;
      expect(Math.min(Math.abs(slackX - marginX), Math.abs(slackY - marginY))).toBeLessThan(0.01);
    }
  });

  it('shifts the projection centre to the middle of the region', () => {
    const frame = frameBox(base);
    expect(frame.offsetX).toBe(0);
    expect(frame.offsetY).toBe(664 / 2 - 220);
  });

  it('moves the camera back when the region shrinks', () => {
    // A short band binds on height: the house must sit farther away to fit.
    const wide = frameBox({ ...base, region: rect(0, 0, 390, 664) });
    const band = frameBox({ ...base, region: rect(0, 60, 390, 220) });
    const dist = (f: typeof wide) => Math.hypot(f.position[0] - f.target[0], f.position[1] - f.target[1], f.position[2] - f.target[2]);
    expect(dist(band)).toBeGreaterThan(dist(wide));
  });
});

describe('frameBox extent', () => {
  it('reports the projected size of the box, matching a real projection', () => {
    const input: FrameInput = {
      canvasWidth: 390,
      canvasHeight: 664,
      region: rect(0, 60, 390, 380),
      fovDeg: 75,
      boxMin: [-4, 0, -4],
      boxMax: [4, 3, 4],
      direction: [0.6, 0.7, 0.6],
    };
    const frame = frameBox(input);
    const bounds = projectedBounds(input);
    expect(frame.extentWidth).toBeCloseTo(bounds.right - bounds.left, 3);
    expect(frame.extentHeight).toBeCloseTo(bounds.bottom - bounds.top, 3);
  });
});

describe('regionViewOffset', () => {
  it('moves the projection centre to the middle of the region', () => {
    expect(regionViewOffset(390, 664, rect(0, 60, 390, 380))).toEqual({ offsetX: 0, offsetY: 332 - 220 });
    expect(regionViewOffset(750, 342, rect(0, 0, 750, 342))).toEqual({ offsetX: 0, offsetY: 0 });
    expect(regionViewOffset(750, 342, rect(150, 50, 750, 250))).toEqual({ offsetX: -75, offsetY: 21 });
  });
});

describe('frameInRegion', () => {
  const base: FrameInput = {
    canvasWidth: 750,
    canvasHeight: 342,
    region: rect(0, 60, 750, 280),
    fovDeg: 75,
    boxMin: [-4, 0, -4],
    boxMax: [4, 3, 4],
    direction: [0, 1, 1],
  };

  it('keeps the region when the house comes out a usable size', () => {
    const framed = frameInRegion(base);
    expect(framed.fellBack).toBe(false);
    expect(Math.max(framed.extentWidth, framed.extentHeight)).toBeGreaterThanOrEqual(342 * MIN_HOUSE_SHARE);
  });

  it('falls back to the whole canvas when the region would frame a thumbnail', () => {
    // A mis-measured HUD container left a 97×77 px gap in landscape.
    const framed = frameInRegion({ ...base, region: rect(150, 60, 247, 137) });
    expect(framed.fellBack).toBe(true);
    expect(framed).toMatchObject(frameBox({ ...base, region: rect(0, 0, 750, 342) }));
  });
});

describe('houseFrameBox', () => {
  it('is the footprint up to the eaves while the roof is hidden', () => {
    expect(houseFrameBox({ width: 8, depth: 6, height: 3, roof: null })).toEqual({ boxMin: [-4, 0, -3], boxMax: [4, 3, 3] });
  });

  it('adds the roof rise and the eave overhang while the roof shows', () => {
    expect(houseFrameBox({ width: 8, depth: 6, height: 6, roof: { peak: 2.5, overhang: 0.35 } })).toEqual({
      boxMin: [-4.35, 0, -3.35],
      boxMax: [4.35, 8.5, 3.35],
    });
  });

  it('keeps a degenerate footprint at least a metre wide', () => {
    expect(houseFrameBox({ width: 0, depth: 0, height: 0, roof: null })).toEqual({ boxMin: [-0.5, 0, -0.5], boxMax: [0.5, 0, 0.5] });
  });

  it('fits the eaves on an iPhone SE with the walls up', () => {
    // 8 × 8 m, one storey, gable rising min(2.5, 8.7/2) = 2.5 m: framed in the
    // whole SE canvas, every eave corner stays on screen.
    const input: FrameInput = {
      canvasWidth: 320,
      canvasHeight: 568,
      region: rect(0, 0, 320, 568),
      fovDeg: 75,
      ...houseFrameBox({ width: 8, depth: 8, height: 3, roof: { peak: 2.5, overhang: 0.35 } }),
      direction: [0.6, 0.7, 0.6],
    };
    const bounds = projectedBounds(input);
    expect(bounds.left).toBeGreaterThan(0);
    expect(bounds.right).toBeLessThan(320);
    expect(bounds.top).toBeGreaterThan(0);
    expect(bounds.bottom).toBeLessThan(568);
  });
});
