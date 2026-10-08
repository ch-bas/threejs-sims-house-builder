import type { FloorPlanFitMode } from './types';

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

/** Largest side of the composited 3D floor-plan canvas, in pixels. */
export const FLOOR_PLAN_CANVAS_MAX = 4096;

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
): {
  width: number;
  height: number;
  source: { x: number; y: number; w: number; h: number };
  dest: { x: number; y: number; w: number; h: number };
} {
  const { source, dest } = computeFloorPlanPlacement(imageWidth, imageHeight, roomAspect, mode);
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
