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
import { distanceOutsideWalls } from './plan-export/print';
import { insetsFromRegion, isSliver, type Insets, type Rect } from './scene-insets';
import type { FloorLayout, FurnitureItem, RoomLayout } from './types';

export type { PlanBounds } from './plan-export/plan-geometry';

/** The full-screen plan's margin (CSS px) around what it fits. */
export const PLAN_PADDING_PX = 60;

/**
 * The desktop plan's margin inside a HUD-free region: room for the room
 * dimensions drawn beside the walls. Along a side that meets a HUD panel
 * the margin sits under the panel (`desktopPlanInsets`), so only the
 * canvas edges cost the plan any size.
 */
export const PLAN_INSET_PADDING_PX = 20;
/** The gap (CSS px) kept between the plan's content and a HUD panel beside it. */
export const PLAN_PANEL_GAP_PX = 4;

/** The plan margin inside a HUD-free region, at most this share of its short side. */
export const INSET_PADDING_SHARE = 0.12;

/**
 * An item that overhangs the walls by less than this (m) does not grow the
 * fit: a sofa pushed flush against a wall, or a wall-hung piece, would
 * otherwise nudge an indoor-only plan by a pixel.
 */
export const PLAN_FIT_TOLERANCE_M = 0.05;

/**
 * The house is drawn at least this share of its room-only size, as on the
 * blueprint (`lib/blueprint.ts`, #377): the outdoor items may widen the fit
 * up to 1 / share of the room on each axis, which bounds the shrink for any
 * canvas shape. Past that the furthest are left off the fit and shown as
 * edge markers instead, so one tree 40 m out can't shrink the house to a
 * smudge.
 */
const PLAN_MIN_ROOM_SHARE = 0.5;

/** An item too far outside the walls to fit, with its distance out (m). */
export interface OffPlanItem {
  item: FurnitureItem & { position: NonNullable<FurnitureItem['position']> };
  distance: number;
}

/** What the plan fits, and the items left out of it, furthest first. */
export interface PlanViewFit {
  bounds: PlanBounds;
  offPlan: OffPlanItem[];
}

function snappedContentBounds(layout: RoomLayout, floor: FloorLayout): PlanBounds {
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

/**
 * What the on-screen plan and the minimap fit: the room unioned with every
 * placed item's footprint (`planContentBounds`, the sheet the vector exports
 * use), overhangs under `PLAN_FIT_TOLERANCE_M` snapped back to the walls.
 * Items outside the walls (`distanceOutsideWalls`, the print route's rule)
 * are left out until the fit is within 1 / `PLAN_MIN_ROOM_SHARE` of the room
 * on each axis: on an axis that overflows, the item sticking out furthest
 * along it goes first. They come back as `offPlan` (furthest first), which
 * the plan draws as edge markers.
 */
export function planViewFit(layout: RoomLayout, floor: FloorLayout): PlanViewFit {
  const maxWidth = layout.width / PLAN_MIN_ROOM_SHARE;
  const maxHeight = layout.height / PLAN_MIN_ROOM_SHARE;
  const fits = (b: PlanBounds) => b.maxX - b.minX <= maxWidth + 1e-9 && b.maxZ - b.minZ <= maxHeight + 1e-9;
  let bounds = snappedContentBounds(layout, floor);
  if (fits(bounds)) return { bounds, offPlan: [] };
  const remaining = floor.items
    .map((item) => ({ item, distance: distanceOutsideWalls(layout, item) }))
    .filter((entry): entry is OffPlanItem => entry.distance > 0);
  const offPlan: OffPlanItem[] = [];
  const gone = new Set<FurnitureItem>();
  while (remaining.length > 0 && !fits(bounds)) {
    // Only an axis that overflows sheds items, and only those sticking out
    // along it: a long room's far end must not go because a tree past its
    // short side overflowed the other axis.
    const overX = bounds.maxX - bounds.minX > maxWidth + 1e-9;
    const overZ = bounds.maxZ - bounds.minZ > maxHeight + 1e-9;
    const overhang = ({ item }: OffPlanItem): number =>
      Math.max(
        overX ? Math.abs(item.position.x) - layout.width / 2 : 0,
        overZ ? Math.abs(item.position.z) - layout.height / 2 : 0
      );
    let furthest = -1;
    for (let i = 0; i < remaining.length; i++) {
      if (overhang(remaining[i]!) > 0 && (furthest < 0 || overhang(remaining[i]!) > overhang(remaining[furthest]!))) furthest = i;
    }
    if (furthest < 0) break;
    const [entry] = remaining.splice(furthest, 1);
    offPlan.push(entry!);
    gone.add(entry!.item);
    bounds = snappedContentBounds(layout, { ...floor, items: floor.items.filter((item) => !gone.has(item)) });
  }
  return { bounds, offPlan: offPlan.sort((a, b) => b.distance - a.distance) };
}

/** `planViewFit`'s bounds. */
export function planViewBounds(layout: RoomLayout, floor: FloorLayout): PlanBounds {
  return planViewFit(layout, floor).bounds;
}

/** An off-plan item's marker on the plan, in canvas CSS px. */
export interface OffPlanMarker {
  item: OffPlanItem['item'];
  distance: number;
  /** Marker centre, just inside the fitted content's edge. */
  x: number;
  y: number;
  /** Direction from the room centre towards the item (radians, canvas axes). */
  angle: number;
}

/** How far inside the fitted content's edge a marker's centre sits (px). */
export const OFF_PLAN_MARKER_INSET_PX = 14;
/**
 * Markers closer than this (px, centre to centre) are fanned apart along
 * their edge, so each far item keeps a marker of its own to press: a disc
 * and the distance label under it.
 */
export const OFF_PLAN_MARKER_SPACING_PX = 36;
/** Hit radius of a marker (px). */
const OFF_PLAN_MARKER_HIT_PX = 13;

/**
 * Where each off-plan item's marker goes: on the ray from the room centre
 * towards the item, where it leaves the fitted content, pulled
 * `OFF_PLAN_MARKER_INSET_PX` back inside so it is always on screen.
 * `transform` is the plan's (`get2DViewTransform`), `bounds` what it fits.
 *
 * Items on about the same bearing would stack: nearest first, a marker that
 * lands within `spacing` of one already placed slides along its edge, to
 * alternate sides, until it is clear (kept inside the edge), so every far
 * item stays reachable. The arrow still points at its item.
 */
export function offPlanMarkers(
  transform: { scale: number; offsetX: number; offsetY: number },
  layout: Pick<RoomLayout, 'width' | 'height'>,
  bounds: PlanBounds,
  offPlan: readonly OffPlanItem[],
  spacing = OFF_PLAN_MARKER_SPACING_PX
): OffPlanMarker[] {
  const { scale, offsetX, offsetY } = transform;
  const px = (x: number) => offsetX + (x + layout.width / 2) * scale;
  const py = (z: number) => offsetY + (z + layout.height / 2) * scale;
  const left = px(bounds.minX);
  const right = px(bounds.maxX);
  const top = py(bounds.minZ);
  const bottom = py(bounds.maxZ);
  const cx = px(0);
  const cy = py(0);
  const inset = OFF_PLAN_MARKER_INSET_PX;
  const placed: OffPlanMarker[] = [];
  const nearestFirst = [...offPlan].sort((a, b) => a.distance - b.distance);
  for (const { item, distance } of nearestFirst) {
    const dx = px(item.position.x) - cx;
    const dy = py(item.position.z) - cy;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const tx = ux > 0 ? (right - cx) / ux : ux < 0 ? (left - cx) / ux : Infinity;
    const ty = uy > 0 ? (bottom - cy) / uy : uy < 0 ? (top - cy) / uy : Infinity;
    const reach = Math.max(0, Math.min(tx, ty) - inset);
    const x0 = cx + ux * reach;
    const y0 = cy + uy * reach;
    // Along a left or right edge the marker slides vertically, else sideways.
    const vertical = tx <= ty;
    const clampAlong = (v: number) =>
      vertical
        ? Math.min(Math.max(v, top + inset), Math.max(top + inset, bottom - inset))
        : Math.min(Math.max(v, left + inset), Math.max(left + inset, right - inset));
    let x = x0;
    let y = y0;
    for (let step = 1; step <= 2 * (offPlan.length + 1); step++) {
      if (!placed.some((m) => Math.hypot(m.x - x, m.y - y) < spacing)) break;
      const shift = Math.ceil(step / 2) * spacing * (step % 2 === 1 ? 1 : -1);
      if (vertical) y = clampAlong(y0 + shift);
      else x = clampAlong(x0 + shift);
    }
    placed.push({ item, distance, x, y, angle: Math.atan2(uy, ux) });
  }
  return placed;
}

/** The marker under a canvas point, if any (the last drawn wins). */
export function hitOffPlanMarker(markers: readonly OffPlanMarker[], x: number, y: number): OffPlanMarker | null {
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i]!;
    if (Math.hypot(marker.x - x, marker.y - y) <= OFF_PLAN_MARKER_HIT_PX) return marker;
  }
  return null;
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
 * A region up to this share smaller than the biggest may win when it is
 * markedly more central (`PLAN_REGION_CENTRE_GAIN`, #381 review): a side
 * column a hair bigger than the middle put the house in a corner with most
 * of the screen empty.
 */
const PLAN_REGION_SCALE_SLACK = 0.1;
/**
 * How much nearer the canvas centre (a share of the canvas width) a smaller
 * region's centre must be to win: a corner versus the middle, not two
 * near-central bands, where the size matters more.
 */
const PLAN_REGION_CENTRE_GAIN = 0.15;

/**
 * The free rectangle of `bounds` (no occluder over it) that draws `content`
 * the biggest, by `regionFitScale`. Unlike `visibleRegion`'s largest area,
 * this suits the plan's own shape: a square house on a wide desktop fits
 * better in a tall column between the corner panels than in the wide band
 * above them. A candidate within `PLAN_REGION_SCALE_SLACK` of the best scale
 * whose centre is `PLAN_REGION_CENTRE_GAIN` nearer the canvas centre wins
 * over a side column. Null when no candidate is usable.
 *
 * `grow` (px) widens each candidate on its right and bottom sides where they
 * meet a panel rather than the canvas edge, before it is scored and
 * returned: the plan's margin may sit under a panel, its content may not.
 * The top and left margins hold the room's dimensions and stay clear.
 */
export function bestPlanRegion(
  bounds: Rect,
  occluders: readonly Rect[],
  content: { width: number; height: number },
  padding: number,
  grow = 0
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
  const candidates: Array<{ rect: Rect; scale: number; area: number }> = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      for (let k = 0; k < ys.length; k++) {
        for (let m = k + 1; m < ys.length; m++) {
          const free = { left: xs[i]!, top: ys[k]!, right: xs[j]!, bottom: ys[m]! };
          // Every taller band from the same top is blocked too.
          if (blocks.some((b) => overlaps(free, b))) break;
          if (isSliver(free)) continue;
          // Not above or left: the room's dimensions are drawn there.
          const rect = {
            left: free.left,
            top: free.top,
            right: free.right < bounds.right ? Math.min(bounds.right, free.right + grow) : free.right,
            bottom: free.bottom < bounds.bottom ? Math.min(bounds.bottom, free.bottom + grow) : free.bottom,
          };
          const width = rect.right - rect.left;
          const height = rect.bottom - rect.top;
          const scale = regionFitScale(width, height, content, padding);
          if (scale > 0) candidates.push({ rect, scale, area: width * height });
        }
      }
    }
  }
  if (candidates.length === 0) return null;
  const bestScale = Math.max(...candidates.map((c) => c.scale));
  const cx = (bounds.left + bounds.right) / 2;
  const cy = (bounds.top + bounds.bottom) / 2;
  const offCentre = (r: Rect) => Math.hypot((r.left + r.right) / 2 - cx, (r.top + r.bottom) / 2 - cy);
  // The biggest plan (the larger area on a tie, then the more central)...
  const better = (a: (typeof candidates)[number], b: (typeof candidates)[number]) =>
    a.scale !== b.scale ? a.scale > b.scale : a.area !== b.area ? a.area > b.area : offCentre(a.rect) < offCentre(b.rect);
  let biggest = candidates[0]!;
  for (const candidate of candidates) if (better(candidate, biggest)) biggest = candidate;
  // ...unless a region nearly as big is markedly more central: the biggest
  // of those wins.
  const needed = offCentre(biggest.rect) - PLAN_REGION_CENTRE_GAIN * (bounds.right - bounds.left);
  let central: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    if (candidate.scale < bestScale * (1 - PLAN_REGION_SCALE_SLACK) || offCentre(candidate.rect) > needed) continue;
    if (!central || better(candidate, central)) central = candidate;
  }
  return (central ?? biggest).rect;
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
  // Along a side that meets a panel, not the canvas edge, the margin slides
  // under the panel and only a small gap stays: the plan keeps its size.
  const region = bestPlanRegion(canvas, occluders, content, PLAN_INSET_PADDING_PX, PLAN_INSET_PADDING_PX - PLAN_PANEL_GAP_PX);
  return region ? insetsFromRegion(canvas, region) : undefined;
}
