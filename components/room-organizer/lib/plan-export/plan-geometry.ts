/**
 * Shared plan-space maths for the SVG and DXF exporters (#230).
 *
 * The emitters must reproduce the geometry the 2D top-down view draws, but
 * canvas-2d/render.ts is being refactored by another workstream and must not
 * be imported for its private helpers or modified. Where its maths is not
 * exported, the few relevant lines are duplicated here with a comment naming
 * the source; everything exported (e.g. `rotatedHalfExtents`) is reused from
 * lib/geometry.ts as render.ts itself does.
 */

import { GRID_SIZE_METERS } from '../constants';
import { isOpening } from '../opening-snap';
import type { FloorLayout, FurnitureItem } from '../types';

/** Duplicated from canvas-2d/render.ts (`INTERIOR_WALL_THICKNESS_M`), which
 * mirrors the 0.16 m modelled in three/interior-walls.ts. */
export const INTERIOR_WALL_THICKNESS_M = 0.16;

/** A placed item: `position` narrowed to non-optional. */
export type PlacedItem = FurnitureItem & { position: NonNullable<FurnitureItem['position']> };

export interface PlanItems {
  /** Doors and windows — drawn as wall marks, not footprint rects. */
  openings: PlacedItem[];
  /** Everything else with a position — drawn as rotated footprint rects. */
  furniture: PlacedItem[];
}

/** Split a floor's placed items into wall openings vs. footprint furniture. */
export function splitPlanItems(items: readonly FurnitureItem[]): PlanItems {
  const openings: PlacedItem[] = [];
  const furniture: PlacedItem[] = [];
  for (const item of items) {
    if (!item.position) continue;
    const placed = item as PlacedItem;
    if (isOpening(item.type)) openings.push(placed);
    else furniture.push(placed);
  }
  return { openings, furniture };
}

/**
 * The four footprint corners of a rotated item, in world metres (x right,
 * z down, origin at the room centre), wound clockwise when viewed top-down.
 *
 * Matches canvas-2d/render.ts `drawFurniture`, which rotates the canvas by
 * `-(item.rotation)` (canvas rotate() is clockwise while Three's rotateY is
 * CCW): a local offset (lx, lz) maps to
 *   (lx·cosθ + lz·sinθ, −lx·sinθ + lz·cosθ).
 * Consistent with `rotatedHalfExtents` in lib/geometry.ts, whose AABB is the
 * max |x|/|z| of these corners.
 */
export function itemWorldCorners(item: PlacedItem): Array<{ x: number; z: number }> {
  const theta = item.rotation ?? 0;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const hw = item.width / 2;
  const hd = item.depth / 2;
  const signs: ReadonlyArray<readonly [number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  return signs.map(([sx, sz]) => ({
    x: item.position.x + sx * hw * cos + sz * hd * sin,
    z: item.position.z - sx * hw * sin + sz * hd * cos,
  }));
}

/**
 * Unit axes of a wall opening in world metres: `along` the wall (the item's
 * local +X) and `into` the room (the item's local +Z). For wall-snapped
 * rotations (see lib/opening-snap.ts, "the camera faces its local +Z: world
 * direction (sin r, cos r)") `into` points off the wall into the room.
 */
export function openingAxes(item: PlacedItem): {
  along: { x: number; z: number };
  into: { x: number; z: number };
} {
  const theta = item.rotation ?? 0;
  return {
    along: { x: Math.cos(theta), z: -Math.sin(theta) },
    into: { x: Math.sin(theta), z: Math.cos(theta) },
  };
}

/**
 * World coordinates of the grid lines, anchored to the world centre so the
 * cells line up with `snapToGrid` — duplicated from canvas-2d/render.ts
 * `drawGrid` (corner-anchoring drifts by `(width/2 mod GRID_SIZE_METERS)`).
 */
export function gridLinePositions(extent: number): number[] {
  const half = extent / 2;
  const positions: number[] = [];
  for (let w = Math.ceil(-half / GRID_SIZE_METERS) * GRID_SIZE_METERS; w <= half; w += GRID_SIZE_METERS) {
    positions.push(w);
  }
  return positions;
}

/** True when the floor plan should draw this exterior wall dashed-hidden. */
export function isWallHidden(floor: FloorLayout, wall: 'north' | 'south' | 'east' | 'west'): boolean {
  return (floor.hiddenWalls ?? []).includes(wall);
}
