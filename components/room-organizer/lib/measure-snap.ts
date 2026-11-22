import { footprintOutline, type FootprintBuilding } from './footprint';
import { INTERIOR_WALL_THICKNESS, projectOntoSegment } from './opening-snap';
import { itemWorldCorners, type PlacedItem } from './plan-export/plan-geometry';
import type { FloorLayout, Vec2 } from './types';

/**
 * Where the measure tool's points land (#921). A point near something worth
 * measuring from catches on it: a corner (a wall's end, the house's corners,
 * an item's corners), an item's centre or the middle of its side, then the
 * line of an item's side or a wall's face. Pure: the plan and the 3D floor
 * click both snap through it.
 */

/** What a measure point caught on; 'none' is the pointer as it was. */
export type MeasureSnapKind = 'corner' | 'centre' | 'edge' | 'wall' | 'none';

export interface MeasureSnap {
  point: Vec2;
  kind: MeasureSnapKind;
}

export interface MeasureSnapTargets {
  floor: Pick<FloorLayout, 'items' | 'interiorWalls'>;
  building: FootprintBuilding;
  /** How far (metres) a point reaches to catch on something. */
  reach: number;
}

interface Segment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** The two faces of an interior wall: its centreline moved half its thickness to each side. */
function wallFaces(wall: Segment): Segment[] {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  if (length < 1e-6) return [];
  const nx = (-(wall.z2 - wall.z1) / length) * (INTERIOR_WALL_THICKNESS / 2);
  const nz = ((wall.x2 - wall.x1) / length) * (INTERIOR_WALL_THICKNESS / 2);
  return [1, -1].map((side) => ({ x1: wall.x1 + nx * side, z1: wall.z1 + nz * side, x2: wall.x2 + nx * side, z2: wall.z2 + nz * side }));
}

function ringSegments(ring: readonly Vec2[]): Segment[] {
  return ring.map((from, index) => {
    const to = ring[(index + 1) % ring.length]!;
    return { x1: from.x, z1: from.z, x2: to.x, z2: to.z };
  });
}

/**
 * The measure point for a pointer at `point`: the nearest catch point within
 * `reach`, else the nearest catch line within it, else the pointer itself.
 */
export function snapMeasurePoint(point: Vec2, { floor, building, reach }: MeasureSnapTargets): MeasureSnap {
  if (!(reach > 0)) return { point, kind: 'none' };
  const points: MeasureSnap[] = [];
  const lines: Array<{ segment: Segment; kind: 'edge' | 'wall' }> = [];
  const outline = footprintOutline(building);
  for (const corner of outline) points.push({ point: corner, kind: 'corner' });
  for (const segment of ringSegments(outline)) lines.push({ segment, kind: 'wall' });
  for (const wall of floor.interiorWalls ?? []) {
    points.push({ point: { x: wall.x1, z: wall.z1 }, kind: 'corner' }, { point: { x: wall.x2, z: wall.z2 }, kind: 'corner' });
    for (const segment of wallFaces(wall)) lines.push({ segment, kind: 'wall' });
  }
  for (const item of floor.items) {
    if (!item.position) continue;
    const corners = itemWorldCorners(item as PlacedItem);
    points.push({ point: { x: item.position.x, z: item.position.z }, kind: 'centre' });
    corners.forEach((corner, index) => {
      const next = corners[(index + 1) % corners.length]!;
      points.push({ point: corner, kind: 'corner' }, { point: { x: (corner.x + next.x) / 2, z: (corner.z + next.z) / 2 }, kind: 'edge' });
    });
    for (const segment of ringSegments(corners)) lines.push({ segment, kind: 'edge' });
  }

  let best: MeasureSnap | null = null;
  let bestDistance = reach;
  for (const target of points) {
    const distance = Math.hypot(target.point.x - point.x, target.point.z - point.z);
    if (distance <= bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  if (best) return { point: { x: best.point.x, z: best.point.z }, kind: best.kind };

  bestDistance = reach;
  for (const { segment, kind } of lines) {
    const projected = projectOntoSegment(point, segment, 0);
    if (!projected || projected.distance > bestDistance) continue;
    best = { point: projected.point, kind };
    bestDistance = projected.distance;
  }
  return best ?? { point, kind: 'none' };
}

