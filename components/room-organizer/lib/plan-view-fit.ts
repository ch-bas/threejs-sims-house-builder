/**
 * Fitting the on-screen 2D plan and the minimap (#381): what they fit, and
 * where on the canvas.
 *
 * What: the room plus every placed item, so an outdoor tree or fence a few
 * metres from the house is on the plan and can be clicked, instead of off
 * the canvas edge. Where: on a desktop window, the largest HUD-free part of
 * the canvas the plan fits biggest in, so no item sits under the catalog
 * strip or the mode panel. (Compact viewports keep their own measure in
 * `hooks/scene-occluders.ts`.)
 *
 * Pure: rects and floor data in, numbers out. `canvas-2d/render.ts` and the
 * hooks share these, so the painted plan and the pointer maths agree.
 */

import { planContentBounds, type PlanBounds } from './plan-export/plan-geometry';
import { insetsFromRegion, isSliver, type Insets, type Rect } from './scene-insets';
import type { FloorLayout, RoomLayout } from './types';

export type { PlanBounds } from './plan-export/plan-geometry';

/** The full-screen plan's margin (CSS px) around what it fits. */
export const PLAN_PADDING_PX = 60;

/**
 * The desktop plan's margin inside a HUD-free region: room for the room
 * dimensions drawn beside the walls. The panels around the region already
 * frame it, and the full 60 px cost a short desktop band a fifth of its
 * plan.
 */
export const PLAN_INSET_PADDING_PX = 24;

/** The plan margin inside a HUD-free region, at most this share of its short side. */
export const INSET_PADDING_SHARE = 0.12;

/**
 * An item that overhangs the walls by less than this (m) does not grow the
 * fit: a sofa pushed flush against a wall, or a wall-hung piece, would
 * otherwise nudge an indoor-only plan by a pixel.
 */
export const PLAN_FIT_TOLERANCE_M = 0.05;

/**
 * What the on-screen plan fits: the room unioned with every placed item's
 * footprint (`planContentBounds`, the sheet the vector exports use), with
 * overhangs under `PLAN_FIT_TOLERANCE_M` snapped back to the walls.
 */
export function planViewBounds(layout: RoomLayout, floor: FloorLayout): PlanBounds {
  const content = planContentBounds(layout, floor);
  const halfW = layout.width / 2;
  const halfD = layout.height / 2;
  const snap = (edge: number, wall: number) => (Math.abs(edge - wall) < PLAN_FIT_TOLERANCE_M ? wall : edge);
  return {
    minX: Math.min(-halfW, snap(content.minX, -halfW)),
    minZ: Math.min(-halfD, snap(content.minZ, -halfD)),
    maxX: Math.max(halfW, snap(content.maxX, halfW)),
    maxZ: Math.max(halfD, snap(content.maxZ, halfD)),
  };
}

/** The plan's fit extent in metres. */
export function boundsSize(bounds: PlanBounds): { width: number; height: number } {
  return { width: bounds.maxX - bounds.minX, height: bounds.maxZ - bounds.minZ };
}

/**
 * The scale (CSS px per metre) the plan is drawn at inside a free region of
 * `regionWidth` × `regionHeight`: the margin is `padding`, shrunk to at most
 * `INSET_PADDING_SHARE` of the region's short side so a short band still
 * shows a usable plan. Not positive when the region leaves no room.
 */
export function regionFitScale(
  regionWidth: number,
  regionHeight: number,
  content: { width: number; height: number },
  padding: number
): number {
  const pad = Math.min(padding, INSET_PADDING_SHARE * Math.min(regionWidth, regionHeight));
  return Math.min((regionWidth - pad * 2) / content.width, (regionHeight - pad * 2) / content.height);
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * The free rectangle of `bounds` (no occluder over it) that draws `content`
 * the biggest, by `regionFitScale`. Unlike `visibleRegion`'s largest area,
 * this suits the plan's own shape: a square house on a wide desktop fits
 * better in a tall column between the corner panels than in the wide band
 * above them. Ties go to the larger area. Null when no candidate is usable.
 */
export function bestPlanRegion(
  bounds: Rect,
  occluders: readonly Rect[],
  content: { width: number; height: number },
  padding: number
): Rect | null {
  const blocks = occluders
    .map((o) => ({
      left: Math.max(o.left, bounds.left),
      top: Math.max(o.top, bounds.top),
      right: Math.min(o.right, bounds.right),
      bottom: Math.min(o.bottom, bounds.bottom),
    }))
    .filter((o) => o.right > o.left && o.bottom > o.top);
  const unique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
  const xs = unique([bounds.left, bounds.right, ...blocks.flatMap((b) => [b.left, b.right])]);
  const ys = unique([bounds.top, bounds.bottom, ...blocks.flatMap((b) => [b.top, b.bottom])]);
  let best: Rect | null = null;
  let bestScale = 0;
  let bestArea = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      for (let k = 0; k < ys.length; k++) {
        for (let m = k + 1; m < ys.length; m++) {
          const candidate = { left: xs[i]!, top: ys[k]!, right: xs[j]!, bottom: ys[m]! };
          // Every taller band from the same top is blocked too.
          if (blocks.some((b) => overlaps(candidate, b))) break;
          if (isSliver(candidate)) continue;
          const width = candidate.right - candidate.left;
          const height = candidate.bottom - candidate.top;
          const scale = regionFitScale(width, height, content, padding);
          const area = width * height;
          if (scale > bestScale || (scale === bestScale && area > bestArea)) {
            best = candidate;
            bestScale = scale;
            bestArea = area;
          }
        }
      }
    }
  }
  return best;
}

/**
 * Where the classic whole-canvas fit draws the content: `get2DViewTransform`
 * without insets (render.ts), in canvas-local CSS pixels.
 */
export function classicPlanRect(
  canvasWidth: number,
  canvasHeight: number,
  content: { width: number; height: number },
  padding: number
): Rect {
  const scale = Math.min((canvasWidth - padding * 2) / content.width, (canvasHeight - padding * 2) / content.height);
  const left = (canvasWidth - content.width * scale) / 2;
  const top = (canvasHeight - content.height * scale) / 2;
  return { left, top, right: left + content.width * scale, bottom: top + content.height * scale };
}

/**
 * The insets a desktop plan is fitted with, in canvas-local CSS pixels
 * (`canvas` is the canvas rect in the occluders' space): undefined, the
 * classic whole-canvas fit with `PLAN_PADDING_PX`, pixel for pixel, while no
 * HUD panel covers the plan that fit draws; else the edges of the
 * `bestPlanRegion` for `PLAN_INSET_PADDING_PX`, the padding the plan is then
 * drawn with.
 */
export function desktopPlanInsets(
  canvas: Rect,
  occluders: readonly Rect[],
  content: { width: number; height: number }
): Insets | undefined {
  const classic = classicPlanRect(canvas.right - canvas.left, canvas.bottom - canvas.top, content, PLAN_PADDING_PX);
  const onScreen = {
    left: canvas.left + classic.left,
    top: canvas.top + classic.top,
    right: canvas.left + classic.right,
    bottom: canvas.top + classic.bottom,
  };
  if (!occluders.some((o) => overlaps(o, onScreen))) return undefined;
  const region = bestPlanRegion(canvas, occluders, content, PLAN_INSET_PADDING_PX);
  return region ? insetsFromRegion(canvas, region) : undefined;
}
