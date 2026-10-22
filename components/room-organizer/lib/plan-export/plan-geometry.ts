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

import { DEFAULT_VISION_FOV_DEG, DEFAULT_VISION_RANGE_M, GRID_SIZE_METERS } from '../constants';
import { isOpening, isWallMounted } from '../opening-snap';
import { computeFloorOpenings, floorOpeningOutline, stairPlanSymbol, stairTreadLines } from '../stairs';
import type { FloorLayout, FurnitureItem, RoomLayout } from '../types';

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

export interface PlanPoint {
  x: number;
  z: number;
}

/** A line of a plan symbol, in world metres. */
export interface PlanSegment {
  from: PlanPoint;
  to: PlanPoint;
}

/** Length of each barb of the stair arrow's head, in metres. */
const STAIR_ARROW_HEAD_M = 0.22;
/** Half-angle of the arrow head. */
const STAIR_ARROW_HEAD_ANGLE = Math.PI / 6;

/**
 * The tread lines of a stair in world metres (#290): every tread edge from
 * `stairSteps`, shared nosings once, rotated and mirrored like the mesh. The
 * footprint rect the plan already draws is among them.
 */
export function stairTreadSegments(item: PlacedItem): PlanSegment[] {
  return stairTreadLines(stairPlanSymbol(item).treads).map(([from, to]) => ({
    from: { x: from[0], z: from[1] },
    to: { x: to[0], z: to[1] },
  }));
}

/**
 * The up-arrow of a stair symbol (#290): a shaft through the tread centres
 * from the foot of the flight — a winder's turns the fan — and two barbs at
 * the head, on the last tread. Empty for a stair with a single tread.
 */
export function stairArrow(item: PlacedItem): { shaft: PlanPoint[]; head: PlanSegment[] } {
  const shaft = stairPlanSymbol(item).walkLine.map(([x, z]) => ({ x, z }));
  const tip = shaft[shaft.length - 1];
  const prev = shaft[shaft.length - 2];
  if (!tip || !prev) return { shaft, head: [] };
  const back = Math.atan2(prev.z - tip.z, prev.x - tip.x);
  const head = [back + STAIR_ARROW_HEAD_ANGLE, back - STAIR_ARROW_HEAD_ANGLE].map((angle) => ({
    from: { x: tip.x + Math.cos(angle) * STAIR_ARROW_HEAD_M, z: tip.z + Math.sin(angle) * STAIR_ARROW_HEAD_M },
    to: tip,
  }));
  return { shaft, head };
}

/**
 * The stairwell holes in a floor's plane, as closed world outlines (#290):
 * the openings the stairs on the floor below cut, from the same maths the 3D
 * floor is built with. Empty for the ground floor (or an index off the
 * building), whose slab nothing cuts.
 */
export function stairwellOutlines(layout: Pick<RoomLayout, 'floors'>, floorIndex: number): PlanPoint[][] {
  const floorBelow = floorIndex > 0 ? layout.floors[floorIndex - 1] : undefined;
  return computeFloorOpenings(floorBelow).map((opening) => floorOpeningOutline(opening).map(([x, z]) => ({ x, z })));
}

/** True when the floor plan should draw this exterior wall dashed-hidden. */
export function isWallHidden(floor: FloorLayout, wall: 'north' | 'south' | 'east' | 'west'): boolean {
  return (floor.hiddenWalls ?? []).includes(wall);
}

/** An axis-aligned rectangle in world metres (x right, z down, origin at the room centre). */
export interface PlanBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * The extent of everything the plan draws: the room rectangle unioned with
 * the rotated footprint corners of every placed item on the floor. Outdoor
 * items (trees, fences, pools) sit outside the walls, so the sheet must
 * follow them — the fixed room + margin sheet clipped them and let them
 * overprint the scale bar (#287). Wall-mounted items are left out: openings
 * are drawn as wall marks whose swing opens into the room, and their
 * footprint straddles the wall line by half its depth, which would pad every
 * sheet by 5 cm; a camera sits in the wall the same way, and one at 135° in a
 * corner poked past it and shifted the room off the sheet layout (#401).
 */
export function planContentBounds(layout: RoomLayout, floor: FloorLayout): PlanBounds {
  const bounds: PlanBounds = {
    minX: -layout.width / 2,
    minZ: -layout.height / 2,
    maxX: layout.width / 2,
    maxZ: layout.height / 2,
  };
  for (const item of splitPlanItems(floor.items).furniture) {
    if (isWallMounted(item.type)) continue;
    for (const corner of itemWorldCorners(item)) {
      if (corner.x < bounds.minX) bounds.minX = corner.x;
      if (corner.x > bounds.maxX) bounds.maxX = corner.x;
      if (corner.z < bounds.minZ) bounds.minZ = corner.z;
      if (corner.z > bounds.maxZ) bounds.maxZ = corner.z;
    }
  }
  return bounds;
}

/**
 * The union of every floor's `planContentBounds` (#405): one frame every
 * storey's sheet can share, so a whole-building export or an all-floors print
 * draws each floor at the same place and size and the sheets line up.
 */
export function buildingContentBounds(layout: RoomLayout): PlanBounds {
  const bounds: PlanBounds = {
    minX: -layout.width / 2,
    minZ: -layout.height / 2,
    maxX: layout.width / 2,
    maxZ: layout.height / 2,
  };
  for (const floor of layout.floors) {
    const floorBounds = planContentBounds(layout, floor);
    bounds.minX = Math.min(bounds.minX, floorBounds.minX);
    bounds.minZ = Math.min(bounds.minZ, floorBounds.minZ);
    bounds.maxX = Math.max(bounds.maxX, floorBounds.maxX);
    bounds.maxZ = Math.max(bounds.maxZ, floorBounds.maxZ);
  }
  return bounds;
}

/** `bounds` grown by `marginM` on every side. */
export function growBounds(bounds: PlanBounds, marginM: number): PlanBounds {
  return {
    minX: bounds.minX - marginM,
    minZ: bounds.minZ - marginM,
    maxX: bounds.maxX + marginM,
    maxZ: bounds.maxZ + marginM,
  };
}

/**
 * The sheet a plan is drawn on: `planContentBounds` grown by `marginM` on
 * every side for the title, room dimensions and scale bar. With no item
 * outside the walls this is exactly the old room + margin sheet, so
 * indoor-only exports are unchanged (#287).
 */
export function planBounds(layout: RoomLayout, floor: FloorLayout, marginM: number): PlanBounds {
  return growBounds(planContentBounds(layout, floor), marginM);
}

/** A coverage disc set: three concentric rings at ⅓, ⅔ and the full range. */
export interface CoverageRings {
  kind: 'wifi' | 'cctv';
  center: PlanPoint;
  /** Inner to outer, in metres. */
  radii: [number, number, number];
}

/**
 * The Wi-Fi and CCTV signal rings the 2D view draws with `showWiFiSignals`
 * and the blueprint always draws (#134): three rings at a third, two thirds
 * and the whole of `signalRange` around each access point or CCTV unit — the
 * same predicate as canvas-2d/render.ts `drawSignalRings` (#420).
 */
export function coverageRings(items: readonly FurnitureItem[]): CoverageRings[] {
  const rings: CoverageRings[] = [];
  for (const kind of ['wifi', 'cctv'] as const) {
    for (const item of items) {
      if (!item.position || !item.signalRange) continue;
      if (!(kind === 'wifi' ? item.isWiFiAccessPoint : item.isCCTV)) continue;
      const range = item.signalRange;
      rings.push({ kind, center: { ...item.position }, radii: [range / 3, (range * 2) / 3, range] });
    }
  }
  return rings;
}

/**
 * A camera's field-of-view wedge in plan space: the sector of radius
 * `radius` about `apex` swept from `startAngle` to `endAngle` (radians,
 * measured in the x-right / z-down plan plane, so increasing angles turn
 * clockwise on the sheet). `full` marks a 360° camera, drawn as a disc.
 */
export interface VisionWedge {
  apex: PlanPoint;
  radius: number;
  startAngle: number;
  endAngle: number;
  full: boolean;
}

/**
 * Every security camera's vision cone, as the 2D view draws it (#134): the
 * camera faces its local +Z, world direction (sin r, cos r). Range and FOV
 * fall back to the 3D cone's defaults when the item does not carry them
 * (#401), so an imported camera has the same wedge in every view.
 */
export function visionWedges(items: readonly FurnitureItem[]): VisionWedge[] {
  const wedges: VisionWedge[] = [];
  for (const item of items) {
    if (!item.position || !item.hasVisionCone) continue;
    const radius = item.visionRange ?? DEFAULT_VISION_RANGE_M;
    const fovDeg = item.visionFov ?? DEFAULT_VISION_FOV_DEG;
    const rotation = item.rotation ?? 0;
    const centerAngle = Math.atan2(Math.cos(rotation), Math.sin(rotation));
    const half = (Math.min(fovDeg, 360) * Math.PI) / 360;
    wedges.push({
      apex: { ...item.position },
      radius,
      startAngle: centerAngle - half,
      endAngle: centerAngle + half,
      full: fovDeg >= 360,
    });
  }
  return wedges;
}

/** The point `radius` metres from `center` at plan angle `angle` (x right, z down). */
export function polarPoint(center: PlanPoint, radius: number, angle: number): PlanPoint {
  return { x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius };
}

/** A dimension string's measured run, in world metres, with its label. */
export interface PlanDimension {
  from: PlanPoint;
  to: PlanPoint;
  lengthM: number;
  label: string;
}

/** Interior walls shorter than this carry no dimension string — the label would not fit. */
export const MIN_DIMENSIONED_WALL_M = 0.3;

/** "4.00 m": two decimals, the precision the wall tools snap to. */
export function formatDimension(metres: number): string {
  const value = Math.round(metres * 100) / 100;
  return `${(Object.is(value, -0) ? 0 : value).toFixed(2)} m`;
}

/**
 * The room's overall dimensions (#424): the south edge's width and the west
 * edge's depth, measured along the footprint. Exporters offset them out into
 * the margin band beyond the plan content.
 */
export function roomDimensions(layout: Pick<RoomLayout, 'width' | 'height'>): { width: PlanDimension; depth: PlanDimension } {
  const hw = layout.width / 2;
  const hd = layout.height / 2;
  return {
    width: { from: { x: -hw, z: hd }, to: { x: hw, z: hd }, lengthM: layout.width, label: formatDimension(layout.width) },
    depth: { from: { x: -hw, z: -hd }, to: { x: -hw, z: hd }, lengthM: layout.height, label: formatDimension(layout.height) },
  };
}

/** One dimension per interior wall at least `MIN_DIMENSIONED_WALL_M` long (#424). */
export function interiorWallDimensions(floor: Pick<FloorLayout, 'interiorWalls'>): PlanDimension[] {
  const dims: PlanDimension[] = [];
  for (const wall of floor.interiorWalls ?? []) {
    const lengthM = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
    if (lengthM < MIN_DIMENSIONED_WALL_M) continue;
    dims.push({ from: { x: wall.x1, z: wall.z1 }, to: { x: wall.x2, z: wall.z2 }, lengthM, label: formatDimension(lengthM) });
  }
  return dims;
}

/** One line of the item schedule: identical placed items counted together. */
export interface ScheduleRow {
  name: string;
  type: string;
  width: number;
  depth: number;
  height: number;
  count: number;
  /** Price of one item (0 when it has none). */
  unitPrice: number;
  /** `unitPrice × count`. */
  totalPrice: number;
}

/**
 * The floor's item schedule (#424): every placed item, grouped by name,
 * type, size and price, sorted by name — a parts list for the builder or the
 * furniture shop. Unplaced (tray) items are not on the plan, so not listed.
 */
export function itemSchedule(items: readonly FurnitureItem[]): ScheduleRow[] {
  const rows = new Map<string, ScheduleRow>();
  for (const item of items) {
    if (!item.position) continue;
    const unitPrice = item.price ?? 0;
    const key = JSON.stringify([item.name, item.type, item.width, item.depth, item.height, unitPrice]);
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      row.totalPrice += unitPrice;
    } else {
      rows.set(key, {
        name: item.name,
        type: item.type,
        width: item.width,
        depth: item.depth,
        height: item.height,
        count: 1,
        unitPrice,
        totalPrice: unitPrice,
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

