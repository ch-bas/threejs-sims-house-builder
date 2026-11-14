import type { View2DTransform } from './render';

/**
 * The on-screen plan's own zoom and pan (#678): view state, never layout
 * state, so nothing is saved, undone or shared. The minimap, blueprint and
 * print never pass one and keep the plain fit.
 *
 * It is held in world terms: `zoom` times the fit's scale, with the plan
 * point (`u`, `v`: metres from the room's north-west corner, the renderer's
 * frame) shown at the canvas centre. So when the fit changes under it (a
 * sheet opening, the catalogue strip or the stats bar changing height, a
 * rotation) the same point stays under the centre, rather than the view
 * jumping by the zoom times the change.
 */
export interface PlanZoom {
  readonly zoom: number;
  readonly u: number;
  readonly v: number;
}

export const NO_PLAN_ZOOM: PlanZoom = { zoom: 1, u: 0, v: 0 };

/** The most the plan zooms in on its fit: a 0.5 m chair at ~16 px on a phone grows to ~130 px. */
export const PLAN_ZOOM_MAX = 8;

/** The canvas the zoom is shown on, in CSS px. */
interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * Where the centre's plan point may sit in the fitted canvas: the zoomed
 * canvas always covers the screen, so the plan can't be pushed off it.
 */
function clampFitted(fitted: number, extent: number, zoom: number): number {
  const half = extent / (2 * zoom);
  return Math.min(extent - half, Math.max(half, fitted));
}

/** The zoom as a map over the fitted canvas: a fitted point `p` is drawn at `p * zoom + t`. */
function canvasShift(fit: View2DTransform, zoom: PlanZoom, size: Size): { x: number; y: number } {
  const fx = clampFitted(fit.offsetX + zoom.u * fit.scale, size.width, zoom.zoom);
  const fy = clampFitted(fit.offsetY + zoom.v * fit.scale, size.height, zoom.zoom);
  return { x: size.width / 2 - fx * zoom.zoom, y: size.height / 2 - fy * zoom.zoom };
}

/** Back from a map over the fitted canvas to world terms, kept on the screen. */
function fromShift(fit: View2DTransform, zoom: number, x: number, y: number, size: Size): PlanZoom {
  const z = Math.min(PLAN_ZOOM_MAX, Math.max(1, zoom));
  if (z === 1 || !(fit.scale > 0)) return NO_PLAN_ZOOM;
  const fx = clampFitted((size.width / 2 - x) / z, size.width, z);
  const fy = clampFitted((size.height / 2 - y) / z, size.height, z);
  return { zoom: z, u: (fx - fit.offsetX) / fit.scale, v: (fy - fit.offsetY) / fit.scale };
}

/** A fit transform with the view zoom applied. */
export function zoomedTransform(fit: View2DTransform, zoom: PlanZoom, size: Size): View2DTransform {
  if (zoom.zoom === 1) return fit;
  const shift = canvasShift(fit, zoom, size);
  return { scale: fit.scale * zoom.zoom, offsetX: fit.offsetX * zoom.zoom + shift.x, offsetY: fit.offsetY * zoom.zoom + shift.y };
}

/** `zoom` changed to `next`, with the fitted point now at (fromX, fromY) moved to (toX, toY). */
function refocus(fit: View2DTransform, zoom: PlanZoom, next: number, from: Point, to: Point, size: Size): PlanZoom {
  const shift = canvasShift(fit, zoom, size);
  const fittedX = (from.x - shift.x) / zoom.zoom;
  const fittedY = (from.y - shift.y) / zoom.zoom;
  const z = Math.min(PLAN_ZOOM_MAX, Math.max(1, next));
  return fromShift(fit, z, to.x - fittedX * z, to.y - fittedY * z, size);
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Zoom by `factor` about a canvas point (the wheel), which stays put. */
export function zoomPlanAbout(fit: View2DTransform, zoom: PlanZoom, factor: number, at: Point, size: Size): PlanZoom {
  return refocus(fit, zoom, zoom.zoom * factor, at, at, size);
}

/** Move the zoomed plan by a pointer's travel (canvas px). */
export function panPlan(fit: View2DTransform, zoom: PlanZoom, dx: number, dy: number, size: Size): PlanZoom {
  if (zoom.zoom === 1) return NO_PLAN_ZOOM;
  const shift = canvasShift(fit, zoom, size);
  return fromShift(fit, zoom.zoom, shift.x + dx, shift.y + dy, size);
}

/**
 * Two fingers from `from` to `to` (canvas px), over the zoom at their
 * touch-down: the zoom follows their spread, and the plan point between
 * them stays between them, so a two-finger drag pans.
 */
export function pinchPlan(fit: View2DTransform, start: PlanZoom, from: { a: Point; b: Point }, to: { a: Point; b: Point }, size: Size): PlanZoom {
  const spread = (pair: { a: Point; b: Point }): number => Math.hypot(pair.b.x - pair.a.x, pair.b.y - pair.a.y);
  const startSpread = spread(from);
  const factor = startSpread > 1 ? spread(to) / startSpread : 1;
  const mid = (pair: { a: Point; b: Point }): Point => ({ x: (pair.a.x + pair.b.x) / 2, y: (pair.a.y + pair.b.y) / 2 });
  return refocus(fit, start, start.zoom * factor, mid(from), mid(to), size);
}

const zooms = new WeakMap<HTMLCanvasElement, PlanZoom>();
const listeners = new WeakMap<HTMLCanvasElement, Set<() => void>>();

/** The plan canvas's view zoom: the paint and the pointer both read it. */
export function planZoomOf(canvas: HTMLCanvasElement): PlanZoom {
  return zooms.get(canvas) ?? NO_PLAN_ZOOM;
}

/** Set the view zoom; whatever draws over the plan (`onPlanZoom`) hears of it. */
export function setPlanZoom(canvas: HTMLCanvasElement, zoom: PlanZoom): void {
  const before = planZoomOf(canvas);
  if (zoom.zoom === 1) zooms.delete(canvas);
  else zooms.set(canvas, zoom);
  if (before === planZoomOf(canvas)) return;
  for (const listener of listeners.get(canvas) ?? []) listener();
}

/**
 * Call `listener` whenever the canvas's view zoom changes: the plan's paint
 * (with every overlay it draws) and the placement ghost's outline follow it.
 * Returns the disposer.
 */
export function onPlanZoom(canvas: HTMLCanvasElement, listener: () => void): () => void {
  let set = listeners.get(canvas);
  if (!set) {
    set = new Set();
    listeners.set(canvas, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}
