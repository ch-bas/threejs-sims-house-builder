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

export function isCompactViewport(width: number, height: number): boolean {
  return width < DESKTOP_MIN_WIDTH || height < DESKTOP_MIN_HEIGHT;
}

/**
 * The visible region falls back to the whole canvas when the largest free
 * rectangle is smaller than this share of it in either dimension: a sliver
 * frames the house uselessly small, so we'd rather let a panel cover part
 * of it.
 */
const MIN_REGION_FRACTION = 0.3;

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

  if (
    !best ||
    rectWidth(best) < rectWidth(bounds) * MIN_REGION_FRACTION ||
    rectHeight(best) < rectHeight(bounds) * MIN_REGION_FRACTION
  ) {
    return bounds;
  }
  return best;
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
  for (const x of [boxMin[0], boxMax[0]]) {
    for (const y of [boxMin[1], boxMax[1]]) {
      for (const z of [boxMin[2], boxMax[2]]) {
        const q: Vec3 = [x - target[0], y - target[1], z - target[2]];
        const depth = distance - dot(q, back);
        xs.push(dot(q, right) / depth / tanPerPx);
        ys.push(dot(q, up) / depth / tanPerPx);
      }
    }
  }

  return {
    position: [target[0] + back[0] * distance, target[1] + back[1] * distance, target[2] + back[2] * distance],
    target,
    ...regionViewOffset(w, h, region),
    extentWidth: Math.max(...xs) - Math.min(...xs),
    extentHeight: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * Below this share of the canvas's short side the framed house is too small
 * to work with: a mis-measured occluder (a transparent container much bigger
 * than what it paints) can leave a sliver of "free" canvas, and fitting the
 * house into it frames a thumbnail.
 */
export const MIN_HOUSE_SHARE = 0.35;

/**
 * `frameBox` in the visible region, falling back to the whole canvas when
 * the house would come out smaller than `MIN_HOUSE_SHARE` of the short side.
 */
export function frameInRegion(input: FrameInput): Frame & { fellBack: boolean } {
  const framed = frameBox(input);
  const shortSide = Math.min(input.canvasWidth, input.canvasHeight);
  if (Math.max(framed.extentWidth, framed.extentHeight) >= shortSide * MIN_HOUSE_SHARE) {
    return { ...framed, fellBack: false };
  }
  const whole = { left: 0, top: 0, right: input.canvasWidth, bottom: input.canvasHeight };
  return { ...frameBox({ ...input, region: whole }), fellBack: true };
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
