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
import { entrancePlanOutline, planFloorIndex } from '../street';
import type { FloorLayout, FurnitureItem, RoomLayout, WallId } from '../types';

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
 * Consistent with `rotatedHalfExtents` in lib/footprint.ts, whose AABB is the
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

/** A door's plan symbol, in world metres (#576). */
export interface DoorSwing {
  /** The jamb the leaf turns on: local −X, or +X on a mirrored door (#386). */
  hinge: { x: number; z: number };
  /** The other jamb: where the leaf's tip rests when it is shut. */
  strike: { x: number; z: number };
  /** The leaf's tip when it stands open, square to the wall, into the room. */
  leafTip: { x: number; z: number };
}

/**
 * The swing the SVG (`renderOpening`) and DXF (`emitOpening`) draw and the 2D
 * plan shares: a leaf as wide as the opening, hinged at one jamb, opened into
 * the room, with the arc its tip sweeps from `strike` to `leafTip`.
 */
export function doorSwing(item: PlacedItem): DoorSwing {
  const { along, into } = openingAxes(item);
  const side = item.mirrored ? 1 : -1;
  const half = item.width / 2;
  const hinge = { x: item.position.x + side * along.x * half, z: item.position.z + side * along.z * half };
  return {
    hinge,
    strike: { x: item.position.x - side * along.x * half, z: item.position.z - side * along.z * half },
    leafTip: { x: hinge.x + into.x * item.width, z: hinge.z + into.z * item.width },
  };
}

/**
 * True when (x, z) is within `reach` of an open door's leaf (#576): the line
 * the plan draws out into the room, which the footprint in the wall doesn't
 * cover.
 */
export function isOnDoorLeaf(item: PlacedItem, x: number, z: number, reach: number): boolean {
  const { hinge, leafTip } = doorSwing(item);
  const dx = leafTip.x - hinge.x;
  const dz = leafTip.z - hinge.z;
  const length2 = dx * dx + dz * dz;
  if (length2 === 0) return false;
  const t = Math.max(0, Math.min(1, ((x - hinge.x) * dx + (z - hinge.z) * dz) / length2));
  return Math.hypot(x - (hinge.x + t * dx), z - (hinge.z + t * dz)) <= reach;
}

/**
 * The strip of wall an opening takes out, as four world corners: as wide as
 * the opening, `thickness` across the wall, centred on the opening.
 */
export function openingGap(item: PlacedItem, thickness: number): Array<{ x: number; z: number }> {
  const { along, into } = openingAxes(item);
  const hw = item.width / 2;
  const ht = thickness / 2;
  const signs: ReadonlyArray<readonly [number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  return signs.map(([sa, si]) => ({
    x: item.position.x + sa * hw * along.x + si * ht * into.x,
    z: item.position.z + sa * hw * along.z + si * ht * into.z,
  }));
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
 * corner poked past it and shifted the room off the sheet layout (#401). A
 * camera mounted on the outside of a wall (its centre beyond the walls)
 * does count, or it would sit on the dimension strings.
 */
export function planContentBounds(layout: RoomLayout, floor: FloorLayout): PlanBounds {
  const hw = layout.width / 2;
  const hd = layout.height / 2;
  const bounds: PlanBounds = { minX: -hw, minZ: -hd, maxX: hw, maxZ: hd };
  for (const item of splitPlanItems(floor.items).furniture) {
    const outside = Math.abs(item.position.x) > hw || Math.abs(item.position.z) > hd;
    if (isWallMounted(item.type) && !outside) continue;
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
const MIN_DIMENSIONED_WALL_M = 0.3;

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

/** An interior wall's dimension: the run plus the side it is drawn on. */
export interface WallDimension extends PlanDimension {
  /** Unit world-space normal (x right, z down) pointing to the side the dimension line and label sit on. */
  normal: PlanPoint;
  /** Metres the label slides off the wall's midpoint towards `to` (negative: towards `from`) to clear what stands there. */
  labelShiftM: number;
}

/** How far off a wall's centreline its dimension label sits, metres — for choosing a side. */
const WALL_LABEL_PROBE_M = 0.36;
/** Clearance around an item footprint a dimension label should keep, metres. */
const LABEL_CLEARANCE_M = 0.25;
/** Half the printed length of a label such as "5.00 m", metres: how near a wall's end its centre may slide. */
const WALL_LABEL_HALF_WIDTH_M = 0.35;
/** How far a crowded label moves along its wall per try, metres. */
const WALL_LABEL_SHIFT_STEP_M = 0.25;

/** The bounding box of a door's swing: the `width × width` square on its `into` side (#592). */
function doorSwingBounds(door: PlacedItem): PlanBounds {
  const { along, into } = openingAxes(door);
  const half = door.width / 2;
  const jambs = [-half, half].map((t) => ({ x: door.position.x + along.x * t, z: door.position.z + along.z * t }));
  const corners = [...jambs, ...jambs.map((j) => ({ x: j.x + into.x * door.width, z: j.z + into.z * door.width }))];
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    maxX: Math.max(...corners.map((c) => c.x)),
    minZ: Math.min(...corners.map((c) => c.z)),
    maxZ: Math.max(...corners.map((c) => c.z)),
  };
}

/** The nearest clear spot along a wall, within `reach` of its middle, trying the preferred side first. */
function clearLabelSpot(probe: (side: number, shift: number) => number, preferred: number, reach: number): { side: number; shift: number } | null {
  for (let step = WALL_LABEL_SHIFT_STEP_M; step <= reach; step += WALL_LABEL_SHIFT_STEP_M) {
    for (const shift of [step, -step]) {
      for (const side of [preferred, -preferred]) {
        if (probe(side, shift) === 0) return { side, shift };
      }
    }
  }
  return null;
}

/**
 * One dimension per interior wall at least `MIN_DIMENSIONED_WALL_M` long
 * (#424), each on one side of the wall in world space so the SVG and the DXF
 * agree: the wall's left-hand normal (x right, z down) unless the label
 * there would land on more item footprints and door swings (#592) than on the
 * other side. When both sides are crowded the label slides along the wall to
 * the nearest clear spot, and stays at the middle if there is none.
 */
export function interiorWallDimensions(floor: Pick<FloorLayout, 'interiorWalls' | 'items'>): WallDimension[] {
  const { openings, furniture } = splitPlanItems(floor.items);
  const footprints = [
    ...furniture.map((item) => {
      const corners = itemWorldCorners(item);
      return {
        minX: Math.min(...corners.map((c) => c.x)),
        maxX: Math.max(...corners.map((c) => c.x)),
        minZ: Math.min(...corners.map((c) => c.z)),
        maxZ: Math.max(...corners.map((c) => c.z)),
      };
    }),
    ...openings.filter((item) => item.type === 'door').map(doorSwingBounds),
  ].map((b) => growBounds(b, LABEL_CLEARANCE_M));
  const dims: WallDimension[] = [];
  for (const wall of floor.interiorWalls ?? []) {
    const lengthM = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
    if (lengthM < MIN_DIMENSIONED_WALL_M) continue;
    const along = { x: (wall.x2 - wall.x1) / lengthM, z: (wall.z2 - wall.z1) / lengthM };
    const left = { x: -along.z, z: along.x };
    const mid = { x: (wall.x1 + wall.x2) / 2, z: (wall.z1 + wall.z2) / 2 };
    // How many footprints the label would touch, end to end, off this side of the wall.
    const probe = (side: number, shift = 0): number => {
      const centre = {
        x: mid.x + left.x * WALL_LABEL_PROBE_M * side + along.x * shift,
        z: mid.z + left.z * WALL_LABEL_PROBE_M * side + along.z * shift,
      };
      const span = [-WALL_LABEL_HALF_WIDTH_M, 0, WALL_LABEL_HALF_WIDTH_M].map((t) => ({ x: centre.x + along.x * t, z: centre.z + along.z * t }));
      return footprints.filter((b) => span.some((p) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ)).length;
    };
    const preferred = probe(-1) < probe(1) ? -1 : 1;
    const slid = probe(preferred) > 0 ? clearLabelSpot(probe, preferred, lengthM / 2 - WALL_LABEL_HALF_WIDTH_M) : null;
    const sign = slid?.side ?? preferred;
    dims.push({
      from: { x: wall.x1, z: wall.z1 },
      to: { x: wall.x2, z: wall.z2 },
      lengthM,
      label: formatDimension(lengthM),
      normal: { x: left.x * sign + 0, z: left.z * sign + 0 },
      labelShiftM: slid?.shift ?? 0,
    });
  }
  return dims;
}

/** One run of an opening chain: wall-to-opening, opening width or opening-to-opening. */
export interface ChainSegment extends PlanDimension {
  /** 0 beside the line; each row above is one further out, to clear the label before it. */
  labelRow: number;
}

/** The chained dimension along one exterior wall (#630), measured on the wall line. */
export interface OpeningChain {
  wall: WallId;
  /** Unit world-space normal (x right, z down) pointing away from the room. */
  outward: PlanPoint;
  segments: ChainSegment[];
}

/** An opening further than this off a wall line is not in that wall, metres. */
const CHAIN_WALL_TOLERANCE_M = 0.1;
/** Runs shorter than this are not drawn: two stations a builder would call the same. */
const CHAIN_MIN_RUN_M = 0.005;
/** Centre to centre of two labels such as "0.90 m" on one row, metres: at the 50 px/m default and the DXF's text height. */
const CHAIN_LABEL_SPACING_M = 0.72;

/**
 * Where each exterior opening sits along its wall (#630): one chain per wall
 * with an opening, corner to corner, so the runs add up to the wall — corner
 * to opening, the opening's width, opening to opening. The recessed entrance
 * is a break in the north wall like any other, and a door in its back wall is
 * not on the exterior line. An opening wholly past a corner measures nothing.
 * Interior walls carry no chain. Each label takes the first row where it
 * stands `labelSpacingM` clear of the label before it.
 */
export function wallOpeningDimensions(layout: RoomLayout, floor: FloorLayout, labelSpacingM = CHAIN_LABEL_SPACING_M): OpeningChain[] {
  const hw = layout.width / 2;
  const hd = layout.height / 2;
  const spans: Record<WallId, Array<[number, number]>> = { north: [], east: [], south: [], west: [] };
  for (const item of splitPlanItems(floor.items).openings) {
    const { along } = openingAxes(item);
    const horizontal = Math.abs(along.x) >= Math.abs(along.z);
    const offWall = horizontal ? Math.abs(Math.abs(item.position.z) - hd) : Math.abs(Math.abs(item.position.x) - hw);
    if (offWall > CHAIN_WALL_TOLERANCE_M) continue;
    const wall: WallId = horizontal ? (item.position.z < 0 ? 'north' : 'south') : item.position.x > 0 ? 'east' : 'west';
    const centre = horizontal ? item.position.x + hw : item.position.z + hd;
    const [from, to] = [centre - item.width / 2, centre + item.width / 2];
    if (to > 0 && from < (horizontal ? layout.width : layout.height)) spans[wall].push([from, to]);
  }
  const recess = entrancePlanOutline(layout, planFloorIndex(layout.floors, floor));
  if (recess) spans.north.push([recess.x0 + hw, recess.x1 + hw]);

  const walls: Array<{ wall: WallId; outward: PlanPoint; start: PlanPoint; along: PlanPoint; length: number }> = [
    { wall: 'north', outward: { x: 0, z: -1 }, start: { x: -hw, z: -hd }, along: { x: 1, z: 0 }, length: layout.width },
    { wall: 'east', outward: { x: 1, z: 0 }, start: { x: hw, z: -hd }, along: { x: 0, z: 1 }, length: layout.height },
    { wall: 'south', outward: { x: 0, z: 1 }, start: { x: -hw, z: hd }, along: { x: 1, z: 0 }, length: layout.width },
    { wall: 'west', outward: { x: -1, z: 0 }, start: { x: -hw, z: -hd }, along: { x: 0, z: 1 }, length: layout.height },
  ];
  const chains: OpeningChain[] = [];
  for (const { wall, outward, start, along, length } of walls) {
    const wallSpans = spans[wall];
    if (wallSpans.length === 0) continue;
    const stations = chainStations(wallSpans, length);
    const at = (t: number): PlanPoint => ({ x: start.x + along.x * t, z: start.z + along.z * t });
    const segments: ChainSegment[] = [];
    // The centre of the last label on each row.
    const rows: number[] = [];
    for (let i = 0; i + 1 < stations.length; i++) {
      const lengthM = stations[i + 1]! - stations[i]!;
      const centre = stations[i]! + lengthM / 2;
      const free = rows.findIndex((last) => centre - last >= labelSpacingM);
      const labelRow = free === -1 ? rows.length : free;
      rows[labelRow] = centre;
      segments.push({ from: at(stations[i]!), to: at(stations[i + 1]!), lengthM, label: formatDimension(lengthM), labelRow });
    }
    chains.push({ wall, outward, segments });
  }
  return chains;
}

/** The chain's stops along a wall, ascending from corner to corner: each span's ends, clamped to the wall. */
function chainStations(spans: ReadonlyArray<readonly [number, number]>, length: number): number[] {
  const stations = [0];
  const stop = (t: number): void => {
    const clamped = Math.min(length, Math.max(stations[stations.length - 1]!, t));
    if (clamped - stations[stations.length - 1]! >= CHAIN_MIN_RUN_M) stations.push(clamped);
  };
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    stop(from);
    stop(to);
  }
  // Always the corner: a stop a hair short of it gives way, so the runs add up to the wall.
  if (stations.length > 1 && length - stations[stations.length - 1]! < CHAIN_MIN_RUN_M) stations.pop();
  stations.push(length);
  return stations;
}

/**
 * How far coverage may carry the sheet past the plan content by default,
 * metres (#420): enough to show an outward camera covering the garden or the
 * street, not so far that a 30 m lens shrinks the house to a dot.
 */
export const COVERAGE_MARGIN_M = 5;

/** How the coverage layer frames the sheet. */
export type CoverageMode = 'off' | 'capped' | 'full';

/** The tightest rectangle around everything the coverage layer draws, or null when it draws nothing. */
export function coverageExtents(items: readonly FurnitureItem[]): PlanBounds | null {
  let bounds: PlanBounds | null = null;
  const add = (p: PlanPoint): void => {
    bounds = bounds
      ? { minX: Math.min(bounds.minX, p.x), minZ: Math.min(bounds.minZ, p.z), maxX: Math.max(bounds.maxX, p.x), maxZ: Math.max(bounds.maxZ, p.z) }
      : { minX: p.x, minZ: p.z, maxX: p.x, maxZ: p.z };
  };
  for (const { center, radii } of coverageRings(items)) {
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) add(polarPoint(center, radii[2], angle));
  }
  for (const wedge of visionWedges(items)) {
    add(wedge.apex);
    const sweep = wedge.full ? 2 * Math.PI : wedge.endAngle - wedge.startAngle;
    add(polarPoint(wedge.apex, wedge.radius, wedge.startAngle));
    add(polarPoint(wedge.apex, wedge.radius, wedge.startAngle + sweep));
    for (let k = 0; k < 4; k++) {
      const axis = (k * Math.PI) / 2;
      if (normalizeRad(axis - wedge.startAngle) <= sweep) add(polarPoint(wedge.apex, wedge.radius, axis));
    }
  }
  return bounds;
}

/**
 * The rectangle a floor's sheet frames (#420): the plan content, grown to
 * take in the coverage layer — by at most `COVERAGE_MARGIN_M` past the
 * content when `capped`, all of it when `full`. The SVG clips its coverage
 * to this rectangle and the DXF trims its rings and wedges to it, so the two
 * formats show the same coverage.
 */
export function planFrameBounds(layout: RoomLayout, floor: FloorLayout, coverage: CoverageMode = 'capped'): PlanBounds {
  const content = planContentBounds(layout, floor);
  if (coverage === 'off') return content;
  const reach = coverageExtents(floor.items);
  if (!reach) return content;
  const cap = coverage === 'full' ? null : growBounds(content, COVERAGE_MARGIN_M);
  const union = unionBounds([content, reach]);
  return cap ? intersectBounds(union, cap) : union;
}

/**
 * The union of every floor's `planFrameBounds` (#405): the frame a
 * whole-building SVG or an every-floor print gives each storey's sheet, so
 * the rooms sit at the same place on every sheet.
 */
export function buildingFrameBounds(layout: RoomLayout, coverage: CoverageMode = 'capped'): PlanBounds {
  if (layout.floors.length === 0) return growBounds({ minX: -layout.width / 2, minZ: -layout.height / 2, maxX: layout.width / 2, maxZ: layout.height / 2 }, 0);
  return unionBounds(layout.floors.map((floor) => planFrameBounds(layout, floor, coverage)));
}

/** The smallest rectangle containing every one of `all` (at least one). */
export function unionBounds(all: readonly PlanBounds[]): PlanBounds {
  return all.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minZ: Math.min(acc.minZ, b.minZ),
    maxX: Math.max(acc.maxX, b.maxX),
    maxZ: Math.max(acc.maxZ, b.maxZ),
  }));
}

function intersectBounds(a: PlanBounds, b: PlanBounds): PlanBounds {
  return { minX: Math.max(a.minX, b.minX), minZ: Math.max(a.minZ, b.minZ), maxX: Math.min(a.maxX, b.maxX), maxZ: Math.min(a.maxZ, b.maxZ) };
}

function normalizeRad(angle: number): number {
  const turn = 2 * Math.PI;
  return ((angle % turn) + turn) % turn;
}

const CLIP_EPS = 1e-9;

function insideBounds(p: PlanPoint, rect: PlanBounds): boolean {
  return p.x >= rect.minX - 1e-7 && p.x <= rect.maxX + 1e-7 && p.z >= rect.minZ - 1e-7 && p.z <= rect.maxZ + 1e-7;
}

/** The part of segment a→b inside `rect` (Liang–Barsky), or null when none is. */
export function clipSegment(a: PlanPoint, b: PlanPoint, rect: PlanBounds): PlanSegment | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, a.x - rect.minX],
    [dx, rect.maxX - a.x],
    [-dz, a.z - rect.minZ],
    [dz, rect.maxZ - a.z],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < CLIP_EPS) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  // A segment that only touches the rectangle (or has no length) draws nothing.
  if ((t1 - t0) * Math.hypot(dx, dz) < 1e-9) return null;
  return { from: { x: a.x + dx * t0, z: a.z + dz * t0 }, to: { x: a.x + dx * t1, z: a.z + dz * t1 } };
}

/**
 * The pieces of the arc about `center` from `start` sweeping `sweep` radians
 * (plan angles, increasing clockwise on the sheet) that lie inside `rect`,
 * as [from, to] angle pairs with from < to. A whole circle inside the
 * rectangle comes back as one piece spanning the full sweep.
 */
export function clipArc(center: PlanPoint, radius: number, start: number, sweep: number, rect: PlanBounds): Array<[number, number]> {
  const cuts: number[] = [0, sweep];
  const crossX = (x: number): void => {
    const c = (x - center.x) / radius;
    if (Math.abs(c) > 1) return;
    const a = Math.acos(c);
    for (const angle of [a, -a]) cuts.push(normalizeRad(angle - start));
  };
  const crossZ = (z: number): void => {
    const s = (z - center.z) / radius;
    if (Math.abs(s) > 1) return;
    const a = Math.asin(s);
    for (const angle of [a, Math.PI - a]) cuts.push(normalizeRad(angle - start));
  };
  crossX(rect.minX);
  crossX(rect.maxX);
  crossZ(rect.minZ);
  crossZ(rect.maxZ);
  const sorted = [...new Set(cuts.filter((t) => t >= 0 && t <= sweep))].sort((p, q) => p - q);
  const pieces: Array<[number, number]> = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const t0 = sorted[i]!;
    const t1 = sorted[i + 1]!;
    if (t1 - t0 < 1e-9) continue;
    if (!insideBounds(polarPoint(center, radius, start + (t0 + t1) / 2), rect)) continue;
    const last = pieces[pieces.length - 1];
    if (last && Math.abs(last[1] - (start + t0)) < 1e-9) last[1] = start + t1;
    else pieces.push([start + t0, start + t1]);
  }
  // A whole circle cut open: the piece ending at the start angle carries on
  // into the one beginning there.
  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  if (sweep >= 2 * Math.PI - 1e-9 && pieces.length > 1 && first && last && Math.abs(first[0] - start) < 1e-9 && Math.abs(last[1] - (start + sweep)) < 1e-9) {
    pieces.pop();
    first[0] = last[0] - sweep;
  }
  return pieces;
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

/** A schedule row's W × D × H in metres, always to the centimetre, as the CSV writes them (#596). */
export function scheduleSizeText(row: Pick<ScheduleRow, 'width' | 'depth' | 'height'>): string {
  return [row.width, row.depth, row.height].map((value) => value.toFixed(2)).join(' × ');
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

