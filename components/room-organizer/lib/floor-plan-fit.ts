import { MAX_ROOM_DIMENSION } from './constants';
import type { FloorPlanFitMode, FloorPlanTransform, RoomLayout, Vec2 } from './types';

/**
 * Where to paint the tracing image inside the room rectangle for a fit mode.
 * The 2D plan draws with it directly and the 3D floor composites its texture
 * with it (floorPlanCanvasLayout), so both views place the plan identically
 * (#218, #191).
 *
 * `source` is in image pixels (cover crops it); `dest` is normalized to the
 * room rectangle, each axis 0..1 (contain letterboxes it — the bands show the
 * floor colour, which the caller fills first).
 */
export function computeFloorPlanPlacement(
  imageWidth: number,
  imageHeight: number,
  roomAspect: number,
  mode: FloorPlanFitMode
): {
  source: { x: number; y: number; w: number; h: number };
  dest: { x: number; y: number; w: number; h: number };
} {
  const fullSource = { x: 0, y: 0, w: imageWidth, h: imageHeight };
  const fullDest = { x: 0, y: 0, w: 1, h: 1 };
  const imageAspect = imageWidth / imageHeight;
  if (mode === 'cover') {
    // Crop the image (centered) to the room's aspect; fill the whole room.
    if (imageAspect > roomAspect) {
      const w = imageHeight * roomAspect;
      return { source: { x: (imageWidth - w) / 2, y: 0, w, h: imageHeight }, dest: fullDest };
    }
    const h = imageWidth / roomAspect;
    return { source: { x: 0, y: (imageHeight - h) / 2, w: imageWidth, h }, dest: fullDest };
  }
  if (mode === 'contain') {
    // Whole image visible, centered, aspect kept; bands show the floor.
    if (imageAspect > roomAspect) {
      const h = roomAspect / imageAspect;
      return { source: fullSource, dest: { x: 0, y: (1 - h) / 2, w: 1, h } };
    }
    const w = imageAspect / roomAspect;
    return { source: fullSource, dest: { x: (1 - w) / 2, y: 0, w, h: 1 } };
  }
  return { source: fullSource, dest: fullDest };
}

/** Where the image is painted: `source` in image pixels, `dest` as a share of the room rectangle. */
export type FloorPlanPlacement = ReturnType<typeof computeFloorPlanPlacement>;

/** What places the tracing image on a building: its full rectangle, the fit mode, and a calibration. */
export interface FloorPlanFit {
  /** Along x, metres: `layout.width`. */
  width: number;
  /** Along z, metres: `layout.height`. */
  depth: number;
  mode: FloorPlanFitMode;
  transform?: FloorPlanTransform | undefined;
}

/** The fit a layout paints its tracing image with. */
export function floorPlanFitOf(
  layout: Pick<RoomLayout, 'width' | 'height' | 'floorPlanFitMode' | 'floorPlanTransform'>
): FloorPlanFit {
  return {
    width: layout.width,
    depth: layout.height,
    mode: layout.floorPlanFitMode ?? 'stretch',
    ...(layout.floorPlanTransform ? { transform: layout.floorPlanTransform } : {}),
  };
}

/**
 * The one rectangle the 3D floor, the 2D plan, the minimap and the blueprint
 * paint the tracing image into (#726). A calibrated image keeps its own
 * proportions at its scale and may reach past the room (`dest` outside
 * 0..1; each view clips to the footprint); otherwise the fit mode places it.
 */
export function floorPlanPlacement(imageWidth: number, imageHeight: number, fit: FloorPlanFit): FloorPlanPlacement {
  const { transform } = fit;
  if (!transform) return computeFloorPlanPlacement(imageWidth, imageHeight, fit.width / fit.depth, fit.mode);
  const w = imageWidth * transform.scale;
  const d = imageHeight * transform.scale;
  return {
    source: { x: 0, y: 0, w: imageWidth, h: imageHeight },
    dest: {
      x: (transform.offsetX - w / 2 + fit.width / 2) / fit.width,
      y: (transform.offsetZ - d / 2 + fit.depth / 2) / fit.depth,
      w: w / fit.width,
      h: d / fit.depth,
    },
  };
}

/** The image pixel under a world point (metres, room-centred), as the placement paints it. */
export function imagePixelAt(point: Vec2, imageWidth: number, imageHeight: number, fit: FloorPlanFit): { x: number; y: number } {
  const { source, dest } = floorPlanPlacement(imageWidth, imageHeight, fit);
  const u = (point.x + fit.width / 2) / fit.width;
  const v = (point.z + fit.depth / 2) / fit.depth;
  return {
    x: source.x + ((u - dest.x) / dest.w) * source.w,
    y: source.y + ((v - dest.y) / dest.h) * source.h,
  };
}

/** Metres per image pixel a calibration may set: from a 10 000 px scan of a metre to a metre a pixel. */
export const MIN_FLOOR_PLAN_SCALE = 1e-4;
export const MAX_FLOOR_PLAN_SCALE = 1;
/** How far from the room's centre a calibrated image's centre may sit, metres. */
export const MAX_FLOOR_PLAN_OFFSET = MAX_ROOM_DIMENSION;
/** Two calibration points closer than this on the image can't give a scale. */
const MIN_CALIBRATION_PIXELS = 2;

const clampOffset = (value: number): number => Math.max(-MAX_FLOOR_PLAN_OFFSET, Math.min(MAX_FLOOR_PLAN_OFFSET, value));

/** Why two points and a length can't calibrate the image: no usable length, points on one spot, or a scale out of range. */
export type CalibrationProblem = 'length' | 'points' | 'scale';

/** Image pixels between two world points as the image is painted now, and the scale `metres` gives them. */
function calibrationScale(a: Vec2, b: Vec2, metres: number, imageWidth: number, imageHeight: number, fit: FloorPlanFit) {
  const pa = imagePixelAt(a, imageWidth, imageHeight, fit);
  const pb = imagePixelAt(b, imageWidth, imageHeight, fit);
  const pixels = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  return { pa, pixels, scale: metres / pixels };
}

/** What stops `calibrateFloorPlan`, or null when it can calibrate. */
export function calibrationProblem(
  a: Vec2,
  b: Vec2,
  metres: number,
  imageWidth: number,
  imageHeight: number,
  fit: FloorPlanFit
): CalibrationProblem | null {
  if (!Number.isFinite(metres) || metres <= 0) return 'length';
  if (imageWidth <= 0 || imageHeight <= 0) return 'points';
  const { pixels, scale } = calibrationScale(a, b, metres, imageWidth, imageHeight, fit);
  if (!Number.isFinite(pixels) || pixels < MIN_CALIBRATION_PIXELS) return 'points';
  if (scale < MIN_FLOOR_PLAN_SCALE || scale > MAX_FLOOR_PLAN_SCALE) return 'scale';
  return null;
}

/**
 * The calibration that makes the image distance between world points `a`
 * and `b` (as the image is painted now) measure `metres` (#726). Point `a`
 * stays where it is on the plan, so the image grows or shrinks about the
 * first click. Null when `calibrationProblem` names one.
 */
export function calibrateFloorPlan(
  a: Vec2,
  b: Vec2,
  metres: number,
  imageWidth: number,
  imageHeight: number,
  fit: FloorPlanFit
): FloorPlanTransform | null {
  if (calibrationProblem(a, b, metres, imageWidth, imageHeight, fit)) return null;
  const { pa, scale } = calibrationScale(a, b, metres, imageWidth, imageHeight, fit);
  return {
    scale,
    offsetX: clampOffset(a.x - (pa.x - imageWidth / 2) * scale),
    offsetZ: clampOffset(a.z - (pa.y - imageHeight / 2) * scale),
  };
}

/** The calibrated image moved by (dx, dz) metres, kept within reach of the room. */
export function movedFloorPlan(transform: FloorPlanTransform, dx: number, dz: number): FloorPlanTransform {
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || (dx === 0 && dz === 0)) return transform;
  return { ...transform, offsetX: clampOffset(transform.offsetX + dx), offsetZ: clampOffset(transform.offsetZ + dz) };
}

/**
 * A stored calibration, or undefined when it isn't one (#726): repaired, never
 * refused, so a bad value costs the image its scale, not the house.
 */
export function repairFloorPlanTransform(value: unknown): FloorPlanTransform | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { scale, offsetX, offsetZ } = value as Record<string, unknown>;
  if (typeof scale !== 'number' || typeof offsetX !== 'number' || typeof offsetZ !== 'number') return undefined;
  if (!Number.isFinite(scale) || !Number.isFinite(offsetX) || !Number.isFinite(offsetZ)) return undefined;
  if (scale < MIN_FLOOR_PLAN_SCALE || scale > MAX_FLOOR_PLAN_SCALE) return undefined;
  const repaired = { scale, offsetX: clampOffset(offsetX), offsetZ: clampOffset(offsetZ) };
  const same = Object.keys(value).length === 3 && repaired.offsetX === offsetX && repaired.offsetZ === offsetZ;
  return same ? (value as FloorPlanTransform) : repaired;
}

/** Largest side of the composited 3D floor-plan canvas, in pixels. */
const FLOOR_PLAN_CANVAS_MAX = 4096;

/**
 * The offscreen canvas the 3D floor maps 1:1 onto the room (#191): the fitted
 * image drawn at its native resolution, with the contain bands as canvas
 * padding rather than UVs outside [0,1] (which clamp-to-edge smeared the
 * image's border rows across them). Scaled down so neither side exceeds
 * `maxSize`. `dest` is in canvas pixels.
 */
export function floorPlanCanvasLayout(
  imageWidth: number,
  imageHeight: number,
  roomAspect: number,
  mode: FloorPlanFitMode,
  maxSize = FLOOR_PLAN_CANVAS_MAX
): FloorPlanCanvasLayout {
  return canvasLayoutFor(computeFloorPlanPlacement(imageWidth, imageHeight, roomAspect, mode), maxSize);
}

export interface FloorPlanCanvasLayout {
  width: number;
  height: number;
  source: { x: number; y: number; w: number; h: number };
  dest: { x: number; y: number; w: number; h: number };
}

/**
 * The 3D floor's canvas for a fit (#726): the room rectangle at the image's
 * own resolution, a calibrated image drawn into it where `floorPlanPlacement`
 * puts it and clipped by the canvas edge.
 */
export function floorPlanCanvasLayoutFor(
  imageWidth: number,
  imageHeight: number,
  fit: FloorPlanFit,
  maxSize = FLOOR_PLAN_CANVAS_MAX
): FloorPlanCanvasLayout {
  return canvasLayoutFor(floorPlanPlacement(imageWidth, imageHeight, fit), maxSize);
}

function canvasLayoutFor({ source, dest }: FloorPlanPlacement, maxSize: number): FloorPlanCanvasLayout {
  const fullW = source.w / dest.w;
  const fullH = source.h / dest.h;
  const scale = Math.min(1, maxSize / Math.max(fullW, fullH));
  const width = Math.max(1, Math.round(fullW * scale));
  const height = Math.max(1, Math.round(fullH * scale));
  return {
    width,
    height,
    source,
    dest: { x: dest.x * width, y: dest.y * height, w: dest.w * width, h: dest.h * height },
  };
}
