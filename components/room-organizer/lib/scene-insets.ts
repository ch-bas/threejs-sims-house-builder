/**
 * Framing the house in the part of the 3D canvas the HUD leaves visible.
 *
 * On a phone the HUD panels cover a large share of the canvas, so a camera
 * that frames the house for the whole canvas puts most of it under the
 * panels. These helpers find the largest unobstructed rectangle of the
 * canvas and the camera pose that fits the house inside it. The camera keeps
 * orbiting the house centre; a projection shift (`setViewOffset`) moves that
 * centre to the middle of the visible rectangle.
 *
 * Pure: rects in, numbers out. The hook reads the DOM rects.
 */

export type Vec3 = readonly [number, number, number];

/** A rectangle in CSS pixels, edges inclusive of `left`/`top`. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Viewports at least this wide AND tall keep the classic desktop framing,
 * untouched (the HUD sits at the edges there and the house already fits).
 */
export const DESKTOP_MIN_WIDTH = 1101;
export const DESKTOP_MIN_HEIGHT = 701;

/** How far each edge of a canvas is covered, in CSS pixels. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The insets that leave `region` free inside `bounds` (both in the same space). */
export function insetsFromRegion(bounds: Rect, region: Rect): Insets {
  return {
    top: Math.max(0, region.top - bounds.top),
    right: Math.max(0, bounds.right - region.right),
    bottom: Math.max(0, bounds.bottom - region.bottom),
    left: Math.max(0, region.left - bounds.left),
  };
}

export function isCompactViewport(width: number, height: number): boolean {
  return width < DESKTOP_MIN_WIDTH || height < DESKTOP_MIN_HEIGHT;
}

/**
 * The visible region falls back to the whole canvas only when the largest
 * free rectangle is a sliver, narrower or shorter than this in CSS pixels:
 * the gap between two panels, or a mis-measured occluder. Anything larger
 * is a real band, and the house is framed in it even when that frames it
 * small (an unfolded wall panel in landscape leaves about 100 px): framing
 * for the whole canvas would put it under the panels instead.
 */
export const MIN_REGION_PX = 64;

function rectWidth(r: Rect): number {
  return r.right - r.left;
}

function rectHeight(r: Rect): number {
  return r.bottom - r.top;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function clip(r: Rect, to: Rect): Rect | null {
  const out = {
    left: Math.max(r.left, to.left),
    top: Math.max(r.top, to.top),
    right: Math.min(r.right, to.right),
    bottom: Math.min(r.bottom, to.bottom),
  };
  return out.right > out.left && out.bottom > out.top ? out : null;
}

/**
 * The largest-area rectangle inside `bounds` that overlaps no occluder,
 * in `bounds`' coordinate space. Brute force over the occluders' edges:
 * the HUD has a handful of panels, so this is a few thousand cheap tests,
 * run only when the camera is framed.
 */
export function visibleRegion(bounds: Rect, occluders: readonly Rect[]): Rect {
  const blocks = occluders.map((o) => clip(o, bounds)).filter((o): o is Rect => o !== null);
  if (blocks.length === 0) return bounds;

  const xs = uniqueSorted([bounds.left, bounds.right, ...blocks.flatMap((b) => [b.left, b.right])]);
  const ys = uniqueSorted([bounds.top, bounds.bottom, ...blocks.flatMap((b) => [b.top, b.bottom])]);

  let best: Rect | null = null;
  let bestArea = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const left = xs[i]!;
      const right = xs[j]!;
      // Taller-first scan over y pairs; break as soon as a band is blocked,
      // since every taller band starting at the same top is blocked too.
      for (let k = 0; k < ys.length; k++) {
        const top = ys[k]!;
        for (let m = k + 1; m < ys.length; m++) {
          const candidate = { left, top, right, bottom: ys[m]! };
          if (blocks.some((b) => overlaps(candidate, b))) break;
          const area = (right - left) * (candidate.bottom - top);
          if (area > bestArea) {
            bestArea = area;
            best = candidate;
          }
        }
      }
    }
  }

  return best && !isSliver(best) ? best : bounds;
}

/** Too thin in either dimension to frame anything in. */
export function isSliver(region: Rect): boolean {
  return rectWidth(region) < MIN_REGION_PX || rectHeight(region) < MIN_REGION_PX;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

export interface FrameInput {
  /** Canvas size in CSS pixels. */
  canvasWidth: number;
  canvasHeight: number;
  /** The visible region, in canvas-local CSS pixels. */
  region: Rect;
  /** The camera's vertical field of view, in degrees. */
  fovDeg: number;
  /** Axis-aligned box to frame (world metres). */
  boxMin: Vec3;
  boxMax: Vec3;
  /** Direction from the orbit target towards the camera; need not be unit. */
  direction: Vec3;
  /** Empty space kept around the box, as a share of the region (0.08 = 8%). */
  margin?: number;
}

export interface Frame {
  position: Vec3;
  target: Vec3;
  /**
   * The `x`/`y` for `camera.setViewOffset(w, h, x, y, w, h)`: shifts the
   * projection so the target lands in the middle of the visible region.
   */
  offsetX: number;
  offsetY: number;
  /** The box's projected size on screen, in CSS pixels. */
  extentWidth: number;
  extentHeight: number;
  /**
   * The larger projected side of the box's floor face, in CSS pixels: the
   * footprint, which always shows, while the walls above may be cut away.
   */
  floorExtent: number;
}

const DEFAULT_MARGIN = 0.08;

/** The view-offset `x`/`y` that puts the projection centre in the middle of `region`. */
export function regionViewOffset(canvasWidth: number, canvasHeight: number, region: Rect): { offsetX: number; offsetY: number } {
  return {
    offsetX: canvasWidth / 2 - (region.left + region.right) / 2,
    offsetY: canvasHeight / 2 - (region.top + region.bottom) / 2,
  };
}

/**
 * The camera pose that fits the whole box inside the visible region, looking
 * at the box centre along `direction`. Exact for a perspective camera: each
 * corner gives the distance at which it touches the region's edge, and the
 * farthest of those wins.
 */
export function frameBox(input: FrameInput): Frame {
  const { canvasWidth: w, canvasHeight: h, region, boxMin, boxMax } = input;
  const margin = input.margin ?? DEFAULT_MARGIN;
  const target: Vec3 = [
    (boxMin[0] + boxMax[0]) / 2,
    (boxMin[1] + boxMax[1]) / 2,
    (boxMin[2] + boxMax[2]) / 2,
  ];

  const back = normalize(input.direction);
  const forward: Vec3 = [-back[0], -back[1], -back[2]];
  // Camera basis as three's lookAt builds it (world up = +Y).
  let right = cross(forward, [0, 1, 0]);
  if (length(right) < 1e-6) right = [1, 0, 0];
  right = normalize(right);
  const up = cross(right, forward);

  // Half-extent tangents of the region (not the canvas): a pixel spans
  // 2·tan(fov/2)/h of tangent, whichever axis it is on.
  const tanPerPx = (2 * Math.tan((input.fovDeg * Math.PI) / 360)) / h;
  const shrink = 1 / (1 + 2 * margin);
  const tanX = (rectWidth(region) / 2) * tanPerPx * shrink;
  const tanY = (rectHeight(region) / 2) * tanPerPx * shrink;

  let distance = 0;
  for (const x of [boxMin[0], boxMax[0]]) {
    for (const y of [boxMin[1], boxMax[1]]) {
      for (const z of [boxMin[2], boxMax[2]]) {
        const q: Vec3 = [x - target[0], y - target[1], z - target[2]];
        // Depth of the corner in front of the camera is distance − q·back.
        const along = dot(q, back);
        distance = Math.max(
          distance,
          along + Math.abs(dot(q, right)) / tanX,
          along + Math.abs(dot(q, up)) / tanY
        );
      }
    }
  }

  // Projected size: each corner's offset from the projection centre, in px.
  const xs: number[] = [];
  const ys: number[] = [];
  const floorXs: number[] = [];
  const floorYs: number[] = [];
  for (const x of [boxMin[0], boxMax[0]]) {
    for (const y of [boxMin[1], boxMax[1]]) {
      for (const z of [boxMin[2], boxMax[2]]) {
        const q: Vec3 = [x - target[0], y - target[1], z - target[2]];
        const depth = distance - dot(q, back);
        const px = dot(q, right) / depth / tanPerPx;
        const py = dot(q, up) / depth / tanPerPx;
        xs.push(px);
        ys.push(py);
        if (y === boxMin[1]) {
          floorXs.push(px);
          floorYs.push(py);
        }
      }
    }
  }
  const span = (values: number[]) => Math.max(...values) - Math.min(...values);

  return {
    position: [target[0] + back[0] * distance, target[1] + back[1] * distance, target[2] + back[2] * distance],
    target,
    ...regionViewOffset(w, h, region),
    extentWidth: span(xs),
    extentHeight: span(ys),
    floorExtent: Math.max(span(floorXs), span(floorYs)),
  };
}

/**
 * The safety net for a mis-measured occluder (a transparent container much
 * bigger than what it paints): a framed footprint whose long side comes out
 * under this many CSS pixels is a thumbnail, not a framing.
 */
export const MIN_FOOTPRINT_PX = 48;
/** ...but only when the whole canvas would frame it at least this much larger. */
const FALLBACK_GAIN = 2;

/**
 * `frameBox` in the visible region, falling back to the whole canvas when
 * the region is a sliver (`isSliver`), or when the footprint framed in it
 * would be a thumbnail (`MIN_FOOTPRINT_PX`) that the whole canvas would
 * frame far larger. A small but real band (a landscape phone with a wall
 * panel unfolded, a tablet's strip between the top pills and the dock)
 * frames the house small, which beats framing it under the panels.
 */
export function frameInRegion(input: FrameInput): Frame & { fellBack: boolean } {
  const whole = { left: 0, top: 0, right: input.canvasWidth, bottom: input.canvasHeight };
  if (isSliver(input.region)) return { ...frameBox({ ...input, region: whole }), fellBack: true };
  const framed = frameBox(input);
  if (framed.floorExtent >= MIN_FOOTPRINT_PX) return { ...framed, fellBack: false };
  const wide = frameBox({ ...input, region: whole });
  return wide.floorExtent >= framed.floorExtent * FALLBACK_GAIN ? { ...wide, fellBack: true } : { ...framed, fellBack: false };
}

export interface HouseShape {
  /** Footprint, metres. */
  width: number;
  depth: number;
  /** Eaves height: the top of the highest storey. */
  height: number;
  /**
   * The roof while it is on screen: its rise above the eaves and how far
   * its eaves overhang the walls. Null when the roof is hidden.
   */
  roof: { peak: number; overhang: number } | null;
}

/** The box to frame: the footprint up to the eaves, plus the roof when it shows. */
export function houseFrameBox(house: HouseShape): { boxMin: Vec3; boxMax: Vec3 } {
  const overhang = house.roof ? Math.max(0, house.roof.overhang) : 0;
  const halfW = Math.max(1, house.width) / 2 + overhang;
  const halfD = Math.max(1, house.depth) / 2 + overhang;
  const top = Math.max(0, house.height) + (house.roof ? Math.max(0, house.roof.peak) : 0);
  return { boxMin: [-halfW, 0, -halfD], boxMax: [halfW, top, halfD] };
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: Vec3): Vec3 {
  const len = length(a) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
}
