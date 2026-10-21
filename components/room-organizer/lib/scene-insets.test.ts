import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { frameBox, isCompactViewport, visibleRegion } from './scene-insets';
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
