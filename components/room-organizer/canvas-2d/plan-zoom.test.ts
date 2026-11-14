// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { NO_PLAN_ZOOM, onPlanZoom, panPlan, pinchPlan, PLAN_ZOOM_MAX, planZoomOf, setPlanZoom, zoomPlanAbout, zoomedTransform } from './plan-zoom';
import { canvasToWorld, get2DViewTransform } from './render';

const room = { width: 8, height: 6 };
const W = 390;
const H = 844;
const size = { width: W, height: H };
const fit = get2DViewTransform(W, H, room);
const view = (zoom: Parameters<typeof zoomedTransform>[1], at = fit, area = size) => zoomedTransform(at, zoom, area);

describe('plan view zoom (#678)', () => {
  it('no zoom is the plain fit, so the minimap, blueprint and print are unchanged', () => {
    expect(view(NO_PLAN_ZOOM)).toBe(fit);
    expect(get2DViewTransform(W, H, room, undefined, undefined, undefined, NO_PLAN_ZOOM)).toEqual(fit);
  });

  it('zooming about a point keeps the world under it there', () => {
    const before = canvasToWorld(250, 400, fit, room);
    const zoom = zoomPlanAbout(fit, NO_PLAN_ZOOM, 3, { x: 250, y: 400 }, size);
    expect(zoom.zoom).toBe(3);
    const after = canvasToWorld(250, 400, view(zoom), room);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
    // The transform the plan paints with is the one the pointer reads.
    expect(get2DViewTransform(W, H, room, undefined, undefined, undefined, zoom)).toEqual(view(zoom));
  });

  it('stays between the fit and the most it zooms in', () => {
    expect(zoomPlanAbout(fit, NO_PLAN_ZOOM, 0.5, { x: 100, y: 100 }, size)).toEqual(NO_PLAN_ZOOM);
    expect(zoomPlanAbout(fit, NO_PLAN_ZOOM, 100, { x: 100, y: 100 }, size).zoom).toBe(PLAN_ZOOM_MAX);
  });

  it('pans only as far as the fitted canvas reaches: the plan never leaves the screen', () => {
    expect(panPlan(fit, NO_PLAN_ZOOM, 50, 50, size)).toEqual(NO_PLAN_ZOOM);
    const zoomed = zoomPlanAbout(fit, NO_PLAN_ZOOM, 2, { x: W / 2, y: H / 2 }, size);
    const before = view(zoomed);
    const moved = view(panPlan(fit, zoomed, -100, -30, size));
    expect(moved.offsetX - before.offsetX).toBeCloseTo(-100, 9);
    expect(moved.offsetY - before.offsetY).toBeCloseTo(-30, 9);
    // Far past the edge: the zoomed canvas's corner stops at the screen's.
    const far = view(panPlan(fit, zoomed, -5000, -5000, size));
    expect(far.offsetX).toBeCloseTo(fit.offsetX * 2 - W, 9);
    expect(far.offsetY).toBeCloseTo(fit.offsetY * 2 - H, 9);
    const back = view(panPlan(fit, zoomed, 5000, 5000, size));
    expect(back.offsetX).toBeCloseTo(fit.offsetX * 2, 9);
  });

  it('a pinch zooms by the spread of the fingers and pans with their midpoint', () => {
    const start = { a: { x: 150, y: 400 }, b: { x: 250, y: 400 } };
    const under = canvasToWorld(200, 400, fit, room);
    // Fingers twice as far apart, and both moved 20 px up.
    const zoom = pinchPlan(fit, NO_PLAN_ZOOM, start, { a: { x: 100, y: 380 }, b: { x: 300, y: 380 } }, size);
    expect(zoom.zoom).toBeCloseTo(2, 9);
    const after = canvasToWorld(200, 380, view(zoom), room);
    expect(after.x).toBeCloseTo(under.x, 9);
    expect(after.z).toBeCloseTo(under.z, 9);
  });

  it('keeps the world point under the centre when the fit changes under it, and stays on the screen', () => {
    const zoom = zoomPlanAbout(fit, NO_PLAN_ZOOM, 3, { x: 180, y: 420 }, size);
    const centre = canvasToWorld(W / 2, H / 2, view(zoom), room);
    // A sheet opens over the bottom 300 px: the fit shrinks into the rest.
    const sheet = get2DViewTransform(W, H, room, undefined, { top: 0, right: 0, bottom: 300, left: 0 });
    const after = canvasToWorld(W / 2, H / 2, view(zoom, sheet), room);
    expect(after.x).toBeCloseTo(centre.x, 9);
    expect(after.z).toBeCloseTo(centre.z, 9);
    // A rotation to landscape: the pan is clamped to the new canvas.
    const landscape = { width: 844, height: 390 };
    const turned = get2DViewTransform(844, 390, room);
    const t = view(zoom, turned, landscape);
    expect(t.offsetX).toBeLessThanOrEqual(turned.offsetX * 3 + 1e-9);
    expect(t.offsetX).toBeGreaterThanOrEqual(turned.offsetX * 3 - 844 * 2 - 1e-9);
  });

  it('is kept per canvas and heard by its listeners, and a canvas with none has no zoom', () => {
    const a = document.createElement('canvas');
    const b = document.createElement('canvas');
    const heard = vi.fn();
    const stop = onPlanZoom(a, heard);
    setPlanZoom(a, { zoom: 2, u: 1, v: 1 });
    expect(planZoomOf(a)).toEqual({ zoom: 2, u: 1, v: 1 });
    expect(planZoomOf(b)).toBe(NO_PLAN_ZOOM);
    expect(heard).toHaveBeenCalledTimes(1);
    setPlanZoom(b, NO_PLAN_ZOOM);
    setPlanZoom(a, NO_PLAN_ZOOM);
    setPlanZoom(a, NO_PLAN_ZOOM);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });
});
