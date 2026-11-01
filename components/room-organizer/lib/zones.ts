import { MAX_ROOM_DIMENSION } from './constants';
import { clampToFootprint, cutoutRect, footprintOutline, trimRectToCutout } from './footprint';
import { autoOrganize, type AutoOrganizeStrategy, type CollisionContext, type KeepOutRect, totalCost } from './geometry';
import {
  type DetectedRoom,
  floorRooms,
  largestBand,
  onRing,
  type PlanRegion,
  pointInRing,
  regionsOutside,
  ringArea,
  ringCrossesItself,
} from './room-detect';
import { ENTRANCE_WALL_ID, type EntrancePlanOutline } from './street';
import type { KeepOutBuilding } from './floor-keep-out';
import type { FloorLayout, FloorPattern, FootprintCutout, FurnitureItem, InteriorWall, RoomZone, Vec2 } from './types';

/**
 * Room zones (#155): named, coloured parts of a floor — "Bedroom",
 * "Kitchen" — so the plan, the blueprint and the stats panel can measure and
 * cost each room. A zone is either a rectangle drawn by hand or a polygon
 * made from a detected room (#719), which then follows its walls; an item
 * belongs to a zone when its centre lies inside it. Everything here is pure:
 * the validation the schema uses, the rectangle normalisation the 2D draw
 * gesture and the reducer share, the re-fit to the walls, and the stats.
 */

export const MAX_ZONES = 32;
/**
 * All the corners of a polygon zone, holes included. Past what a real room
 * has, and what keeps the worst legal file fast: the floor patch walks a
 * graph that grows with the square of this.
 */
export const MAX_ZONE_POINTS = 128;
/** Sample points per side that measure how much of a zone a room still covers. */
const OVERLAP_SAMPLES = 16;
/** A room this many times the zone's area is mostly somewhere else: not the zone's to take. */
const ROOM_TOO_BIG = 2;
/** How much of such a room must have been named floor for a zone to take it after all. */
const NAMED_SHARE = 0.9;
/** How far a polygon's rectangle may sit from the polygon's own bounds, in metres. */
const RECT_TOLERANCE = 1e-6;
/** A drawn rectangle thinner than this on either side is a slip, not a room. */
export const MIN_ZONE_SIZE = 0.3;
/** Drawn corners round to this many metres so areas read as clean numbers. */
const ZONE_GRID = 0.1;

/** Fill / label colours handed out in turn as zones are added. */
export const ZONE_COLORS: readonly string[] = [
  '#3b82f6',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#ef4444',
  '#f97316',
];

/** The geometry of a zone: its north-west corner and its extent (see `RoomZone`). */
export type ZoneRect = Pick<RoomZone, 'x' | 'z' | 'w' | 'd'>;
/** A zone's whole footprint: the rectangle, or the polygon when it has one. */
export type ZoneShape = ZoneRect & Partial<Pick<RoomZone, 'outline' | 'holes'>>;

export interface ZoneStats {
  itemCount: number;
  /** Sum of the prices of the items inside, in §. */
  cost: number;
  /** The zone's floor less any part over the porch, in m². */
  area: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Bounded like a room dimension: a non-finite corner or a zero, negative or
 * absurd size must not reach the renderer (it would paint nothing, or a
 * rectangle the size of the street).
 */
export function isZoneRect(value: unknown): value is ZoneRect {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isFiniteNumber(v.x) &&
    isFiniteNumber(v.z) &&
    Math.abs(v.x) <= MAX_ROOM_DIMENSION &&
    Math.abs(v.z) <= MAX_ROOM_DIMENSION &&
    isFiniteNumber(v.w) &&
    isFiniteNumber(v.d) &&
    v.w > 0 &&
    v.d > 0 &&
    v.w <= MAX_ROOM_DIMENSION &&
    v.d <= MAX_ROOM_DIMENSION
  );
}

function isZoneRing(value: unknown): value is Vec2[] {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.every((point: unknown) => {
      if (typeof point !== 'object' || point === null) return false;
      const { x, z } = point as Record<string, unknown>;
      return isFiniteNumber(x) && isFiniteNumber(z) && Math.abs(x) <= MAX_ROOM_DIMENSION && Math.abs(z) <= MAX_ROOM_DIMENSION;
    })
  );
}

function isZoneHoles(value: unknown): boolean {
  return Array.isArray(value) && value.every(isZoneRing);
}

export function isRoomZone(value: unknown): value is RoomZone {
  if (!isZoneRect(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.outline !== undefined && !isZoneRing(v.outline)) return false;
  if (v.holes !== undefined && (v.outline === undefined || !isZoneHoles(v.holes))) return false;
  return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.color === 'string';
}

/**
 * The rectangle spanned by two dragged corners (any order), clamped to the
 * room's footprint; `null` when what's left is too small to be a room. A
 * corner rounds to ZONE_GRID, except one within half a step of a wall (or
 * past it), which lands on the wall, so a zone drawn edge to edge on a
 * 5.05 m floor ends at the wall rather than 5 cm past it (#618). Used by
 * the 2D draw gesture and, on every add/update, by the reducer — so a
 * stored zone always fits its floor, and re-fitting it changes nothing. On a
 * house with a `cutout` a corner lands on a notch wall the same way, and a
 * rectangle across the cut keeps its larger part (#727).
 */
export function zoneFromCorners(a: Vec2, b: Vec2, roomWidth: number, roomDepth: number, cutout?: FootprintCutout | undefined): ZoneRect | null {
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const notch = cutoutRect({ width: roomWidth, height: roomDepth, cutout });
  const notchX = notch && (cutout?.corner.endsWith('e') ? notch.x0 : notch.x1);
  const notchZ = notch && (cutout?.corner.startsWith('n') ? notch.z1 : notch.z0);
  const cornerAt = (value: number, half: number, line: number | null): number =>
    line !== null && Math.abs(value - line) < ZONE_GRID / 2 - 1e-9 ? line : snapCorner(value, half);
  const x0 = cornerAt(Math.min(a.x, b.x), halfW, notchX);
  const x1 = cornerAt(Math.max(a.x, b.x), halfW, notchX);
  const z0 = cornerAt(Math.min(a.z, b.z), halfD, notchZ);
  const z1 = cornerAt(Math.max(a.z, b.z), halfD, notchZ);
  // Sizes from the corners, without re-rounding to the grid; only float
  // noise is trimmed, and never past the far wall.
  const w = Math.min(trimNoise(x1 - x0), halfW - x0);
  const d = Math.min(trimNoise(z1 - z0), halfD - z0);
  if (!(w >= MIN_ZONE_SIZE) || !(d >= MIN_ZONE_SIZE)) return null;
  const rect = trimRectToCutout({ x: x0, z: z0, w, d }, notch);
  return rect && rect.w >= MIN_ZONE_SIZE && rect.d >= MIN_ZONE_SIZE ? rect : null;
}

/** A corner on the grid, or on the wall when it is within half a grid step of it or beyond. */
function snapCorner(value: number, half: number): number {
  // Round first, then test the rounded corner: a value that rounds to within
  // half a step of the wall must land on it, or the next re-fit would move it.
  const snapped = round(value);
  if (snapped >= half - ZONE_GRID / 2 || value >= half - ZONE_GRID / 2) return half;
  if (snapped <= -half + ZONE_GRID / 2 || value <= -half + ZONE_GRID / 2) return -half;
  return snapped;
}

/** Drops binary float noise (2.9999999999 → 3) without moving a value off the wall. */
function trimNoise(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/** `zoneFromCorners` for a rectangle already expressed as corner + size. */
export function clampZoneRect(rect: ZoneRect, roomWidth: number, roomDepth: number, cutout?: FootprintCutout | undefined): ZoneRect | null {
  if (!isZoneRect(rect)) return null;
  return zoneFromCorners({ x: rect.x, z: rect.z }, { x: rect.x + rect.w, z: rect.z + rect.d }, roomWidth, roomDepth, cutout);
}

/**
 * Where a zone that keeps its size stops: clear of the notch, the shorter way
 * out. One too big for either wing is left where it is, for the fit to trim.
 */
export function zoneClearOfCutout(rect: ZoneRect, roomWidth: number, roomDepth: number, cutout: FootprintCutout | undefined): ZoneRect {
  if (!cutout) return rect;
  const size = { width: rect.w, depth: rect.d };
  const centre = clampToFootprint(size, { x: rect.x + rect.w / 2, z: rect.z + rect.d / 2 }, roomWidth, roomDepth, cutout);
  return { ...rect, x: centre.x - rect.w / 2, z: centre.z - rect.d / 2 };
}

/**
 * Whether a polygon zone can stand on this footprint. `isRoomZone` checks its
 * types and refuses a whole file; what's wrong here only costs the zone its
 * polygon (see `plainZone`), so a house never fails to open over one. A
 * rectangle zone always can.
 */
export function zoneShapeFits(zone: ZoneShape, footprint: readonly Vec2[]): boolean {
  if (!zone.outline) return true;
  const rings = zoneRings(zone);
  if (rings.reduce((sum, ring) => sum + ring.length, 0) > MAX_ZONE_POINTS) return false;
  if (rings.some((ring) => !(ringArea(ring) > 0) || ringCrossesItself(ring))) return false;
  const bounds = ringBounds(zone.outline);
  const off = (a: number, b: number): boolean => Math.abs(a - b) > RECT_TOLERANCE;
  if (off(bounds.x, zone.x) || off(bounds.z, zone.z) || off(bounds.w, zone.w) || off(bounds.d, zone.d)) return false;
  if (!ringOnFootprint(zone.outline, footprint)) return false;
  return (zone.holes ?? []).every((hole) => hole.every((point) => withinRing(zone.outline!, point)));
}

function withinRing(ring: readonly Vec2[], point: Vec2): boolean {
  return onRing(ring, point.x, point.z) || pointInRing(ring, point.x, point.z);
}

/** Where along a → b it crosses the sides of a ring, from 0 to 1. */
function ringCrossings(a: Vec2, b: Vec2, ring: readonly Vec2[]): number[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const hits = [0, 1];
  ring.forEach((from, index) => {
    const to = ring[(index + 1) % ring.length]!;
    const ex = to.x - from.x;
    const ez = to.z - from.z;
    const cross = dx * ez - dz * ex;
    if (Math.abs(cross) < 1e-12) return;
    const t = ((from.x - a.x) * ez - (from.z - a.z) * ex) / cross;
    const u = ((from.x - a.x) * dz - (from.z - a.z) * dx) / cross;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) hits.push(t);
  });
  return hits.sort((p, q) => p - q);
}

/**
 * Whether a ring stands on the footprint. Its corners decide on a rectangle;
 * on an L a side can leave them both on the house and cross the notch, so
 * each stretch of each side is tried too.
 */
function ringOnFootprint(ring: readonly Vec2[], footprint: readonly Vec2[]): boolean {
  if (!ring.every((point) => withinRing(footprint, point))) return false;
  if (footprint.length <= 4) return true;
  return ring.every((a, index) => {
    const b = ring[(index + 1) % ring.length]!;
    const hits = ringCrossings(a, b, footprint);
    return hits.every((t, at) => {
      const next = hits[at + 1];
      if (next === undefined) return true;
      const middle = (t + next) / 2;
      return withinRing(footprint, { x: a.x + (b.x - a.x) * middle, z: a.z + (b.z - a.z) * middle });
    });
  });
}

/** A zone with its polygon taken off, down to its rectangle. */
export function plainZone(zone: RoomZone): RoomZone {
  const { outline: _outline, holes: _holes, ...plain } = zone;
  return plain;
}

/** The rectangle around a polygon. */
function ringBounds(ring: readonly Vec2[]): ZoneRect {
  const xs = ring.map((point) => point.x);
  const zs = ring.map((point) => point.z);
  const x = Math.min(...xs);
  const z = Math.min(...zs);
  return { x, z, w: Math.max(...xs) - x, d: Math.max(...zs) - z };
}

/** A region as a zone's shape: its rings, and the rectangle around them. */
export function regionShape(room: Pick<DetectedRoom, 'outline' | 'holes'>): ZoneShape {
  return { ...ringBounds(room.outline), outline: room.outline, ...(room.holes ? { holes: room.holes } : {}) };
}

/** A detected room as a zone (#719). */
export function zoneFromRoom(room: DetectedRoom, name: string, color: string): Omit<RoomZone, 'id'> {
  return { name, color, ...regionShape(room) };
}

/** The zone's boundary as rings: the rectangle's, or the outline and its holes. */
export function zoneRings(zone: ZoneShape): Vec2[][] {
  if (zone.outline) return [zone.outline, ...(zone.holes ?? [])];
  const x1 = zone.x + zone.w;
  const z1 = zone.z + zone.d;
  return [[{ x: zone.x, z: zone.z }, { x: x1, z: zone.z }, { x: x1, z: z1 }, { x: zone.x, z: z1 }]];
}

/**
 * Where a zone's name goes: the top of the zone, or of a polygon's largest
 * clear stretch, so an L-shaped room's name never lands in its notch.
 */
export function zoneLabelSpot(zone: ZoneShape): ZoneRect {
  const band = zone.outline ? largestBand(zoneRings(zone)) : null;
  return band ? { x: band.x0, z: band.z0, w: band.x1 - band.x0, d: band.z1 - band.z0 } : zone;
}

/** Inclusive on every edge, so an item centred on a shared boundary counts for both rooms. */
export function zoneContains(zone: ZoneShape, x: number, z: number): boolean {
  if (!zone.outline) return x >= zone.x && x <= zone.x + zone.w && z >= zone.z && z <= zone.z + zone.d;
  if (zoneRings(zone).some((ring) => onRing(ring, x, z))) return true;
  return pointInRing(zone.outline, x, z) && !zone.holes?.some((hole) => pointInRing(hole, x, z));
}

/** The room at a world point, if any. */
export function roomAt(rooms: readonly DetectedRoom[], x: number, z: number): DetectedRoom | null {
  return rooms.find((room) => zoneContains(regionShape(room), x, z)) ?? null;
}

/** The items whose centre lies inside the zone (unplaced items never do). */
export function itemsInZone(zone: ZoneShape, items: readonly FurnitureItem[]): FurnitureItem[] {
  return items.filter((item) => item.position !== undefined && zoneContains(zone, item.position.x, item.position.z));
}

/**
 * The part of a zone's rectangle over the storey's recessed porch, or null.
 * One drawn across the front of the house keeps its shape, but the porch is
 * outside (#285): the plan clears it over the tint, and the area leaves it
 * out (#582).
 */
function zonePorchOverlap(zone: ZoneRect, recess: EntrancePlanOutline | null): ZoneRect | null {
  if (!recess) return null;
  const x0 = Math.max(zone.x, recess.x0);
  const x1 = Math.min(zone.x + zone.w, recess.x1);
  const z0 = Math.max(zone.z, recess.frontZ);
  const z1 = Math.min(zone.z + zone.d, recess.backZ);
  return x1 > x0 && z1 > z0 ? { x: x0, z: z0, w: x1 - x0, d: z1 - z0 } : null;
}

/**
 * The part of a ring inside an axis-aligned rectangle, in m², clipping side
 * by side. A concave ring clips to a polygon that doubles back along the
 * rectangle's edge, which leaves its area right.
 */
function ringAreaIn(ring: readonly Vec2[], rect: ZoneRect): number {
  const x1 = rect.x + rect.w;
  const z1 = rect.z + rect.d;
  const sides: ReadonlyArray<(point: Vec2) => number> = [
    (point) => point.x - rect.x,
    (point) => x1 - point.x,
    (point) => point.z - rect.z,
    (point) => z1 - point.z,
  ];
  let clipped: readonly Vec2[] = ring;
  for (const side of sides) {
    const kept: Vec2[] = [];
    clipped.forEach((from, index) => {
      const to = clipped[(index + 1) % clipped.length]!;
      const a = side(from);
      const b = side(to);
      if (a >= 0) kept.push(from);
      if (a >= 0 !== b >= 0) {
        const t = a / (a - b);
        kept.push({ x: from.x + t * (to.x - from.x), z: from.z + t * (to.z - from.z) });
      }
    });
    clipped = kept;
  }
  return clipped.length >= 3 ? ringArea(clipped) : 0;
}

/** The floor inside a polygon zone, net of its holes, less what lies in `rect`. */
function polygonFloor(zone: ZoneShape, rect: ZoneRect | null): number {
  const holes = zone.holes ?? [];
  const net = (measure: (ring: readonly Vec2[]) => number): number =>
    measure(zone.outline!) - holes.reduce((sum, hole) => sum + measure(hole), 0);
  return net(ringArea) - (rect ? net((ring) => ringAreaIn(ring, rect)) : 0);
}

/** The room floor a zone covers, in m²: its rectangle or polygon, less the porch. */
export function zoneArea(zone: ZoneShape, recess: EntrancePlanOutline | null): number {
  const porch = zonePorchOverlap(zone, recess);
  // Float noise must not print a zone that is all porch as "-0.0 m²".
  if (zone.outline) return Math.max(0, polygonFloor(zone, porch));
  return Math.max(0, zone.w * zone.d - (porch ? porch.w * porch.d : 0));
}

/** Whether all a zone would hold is porch: less room left than the smallest zone drawn (#582). */
export function zoneInPorch(zone: ZoneShape, recess: EntrancePlanOutline | null): boolean {
  return zonePorchOverlap(zone, recess) !== null && zoneArea(zone, recess) < MIN_ZONE_SIZE * MIN_ZONE_SIZE;
}

export function zoneStats(zone: ZoneShape, items: readonly FurnitureItem[], recess: EntrancePlanOutline | null): ZoneStats {
  const inside = itemsInZone(zone, items);
  return { itemCount: inside.length, cost: totalCost(inside), area: zoneArea(zone, recess) };
}

/** A zone's own floor, ready to draw: the storey's finish stands in for what the zone doesn't set. */
export interface ZoneFloorPatch {
  id: string;
  pattern: FloorPattern;
  color: string;
  regions: PlanRegion[];
  /** How many earlier patches it lies on: overlapping patches are stacked, others share a height. */
  layer: number;
}

export function hasFloorFinish(zone: RoomZone): boolean {
  return zone.floorPattern !== undefined || !!zone.floorColor;
}

/** What the patches are built from: a zone without a finish adds nothing. */
export function zoneFinishesKey(floor: Pick<FloorLayout, 'zones'>): unknown[] {
  return (floor.zones ?? []).filter(hasFloorFinish).map(({ x, z, w, d, outline, holes, floorPattern, floorColor }) => [x, z, w, d, outline, holes, floorPattern, floorColor]);
}

/**
 * The floor patches of a storey (#720), in painting order: every zone with a
 * finish of its own, less the porch and the stairwells. What the 3D floor
 * and the plan draw, so they can't disagree.
 */
export function zoneFloorPatches(floor: Pick<FloorLayout, 'zones' | 'floorColor' | 'floorPattern'>, keepOut: readonly KeepOutRect[]): ZoneFloorPatch[] {
  const laid: Array<{ zone: RoomZone; layer: number }> = [];
  return (floor.zones ?? []).filter(hasFloorFinish).map((zone) => {
    const [outline, ...holes] = zoneRings(zone);
    const layer = laid.filter((under) => rectsOverlap(under.zone, zone)).reduce((top, under) => Math.max(top, under.layer + 1), 0);
    laid.push({ zone, layer });
    return {
      id: zone.id,
      pattern: zone.floorPattern ?? floor.floorPattern ?? 'solid',
      color: zone.floorColor || floor.floorColor,
      regions: regionsOutside(outline!, holes, keepOut),
      layer,
    };
  });
}

/**
 * The detected rooms of a storey no zone stands on yet: what "Name this room"
 * offers (#719). A storey with no partitions is one room, not worth offering.
 */
export function roomsToName(building: KeepOutBuilding, floorIndex: number): DetectedRoom[] {
  const floor = building.floors[floorIndex];
  if (!floor?.interiorWalls?.some((wall) => wall.id !== ENTRANCE_WALL_ID)) return [];
  const zones = floor.zones ?? [];
  const footprint = footprintOutline(building);
  return floorRooms(building, floorIndex).filter(
    (room) => zoneShapeFits(regionShape(room), footprint) && !zones.some((zone) => zoneContains(zone, room.anchor.x, room.anchor.z))
  );
}

function rectsOverlap(a: ZoneRect, b: ZoneRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
}

/** The floor each moved wall passed over: a strip from where it stood to where it stands. */
export function sweptStrips(before: readonly InteriorWall[], after: readonly InteriorWall[]): Vec2[][] {
  return after.flatMap((wall) => {
    const old = before.find((entry) => entry.id === wall.id);
    if (!old || (old.x1 === wall.x1 && old.z1 === wall.z1 && old.x2 === wall.x2 && old.z2 === wall.z2)) return [];
    return [[{ x: old.x1, z: old.z1 }, { x: old.x2, z: old.z2 }, { x: wall.x2, z: wall.z2 }, { x: wall.x1, z: wall.z1 }]];
  });
}

const inStrip = (strips: readonly Vec2[][], x: number, z: number): boolean => strips.some((strip) => pointInRing(strip, x, z));

/** A room's floor outside the strips, in m². */
function roomOffStrips(room: DetectedRoom, strips: readonly Vec2[][]): number {
  if (strips.length === 0) return room.area;
  const shape = regionShape(room);
  let hits = 0;
  for (let i = 0.5; i < OVERLAP_SAMPLES; i++) {
    for (let j = 0.5; j < OVERLAP_SAMPLES; j++) {
      const x = shape.x + (i / OVERLAP_SAMPLES) * shape.w;
      const z = shape.z + (j / OVERLAP_SAMPLES) * shape.d;
      if (zoneContains(shape, x, z) && inStrip(strips, x, z)) hits += 1;
    }
  }
  return Math.max(0, room.area - (hits * shape.w * shape.d) / (OVERLAP_SAMPLES * OVERLAP_SAMPLES));
}

/** A zone's floor outside the strips, in m². */
function zoneOffStrips(zone: RoomZone, strips: readonly Vec2[][]): number {
  if (strips.length === 0) return zoneArea(zone, null);
  let hits = 0;
  for (let i = 0.5; i < OVERLAP_SAMPLES; i++) {
    for (let j = 0.5; j < OVERLAP_SAMPLES; j++) {
      const x = zone.x + (i / OVERLAP_SAMPLES) * zone.w;
      const z = zone.z + (j / OVERLAP_SAMPLES) * zone.d;
      if (zoneContains(zone, x, z) && !inStrip(strips, x, z)) hits += 1;
    }
  }
  return (hits * zone.w * zone.d) / (OVERLAP_SAMPLES * OVERLAP_SAMPLES);
}

/** How much of a zone lies in a room off the strips, in m², from a grid of sample points. */
function overlapArea(zone: RoomZone, room: DetectedRoom, strips: readonly Vec2[][]): number {
  const shape = regionShape(room);
  if (!rectsOverlap(zone, shape)) return 0;
  const holes = room.holes ?? [];
  let hits = 0;
  for (let i = 0.5; i < OVERLAP_SAMPLES; i++) {
    for (let j = 0.5; j < OVERLAP_SAMPLES; j++) {
      const x = zone.x + (i / OVERLAP_SAMPLES) * zone.w;
      const z = zone.z + (j / OVERLAP_SAMPLES) * zone.d;
      if (!pointInRing(room.outline, x, z) || holes.some((hole) => pointInRing(hole, x, z))) continue;
      if (zoneContains(zone, x, z) && !inStrip(strips, x, z)) hits += 1;
    }
  }
  return (hits * zone.w * zone.d) / (OVERLAP_SAMPLES * OVERLAP_SAMPLES);
}

/**
 * Polygon zones after the walls moved (#719): each takes the room that holds
 * the largest share of it, keeping its name and colour, one zone to a room,
 * and the larger overlap on a tie. A room at least ROOM_TOO_BIG times the zone
 * is no home: taking down a wall doesn't flood the storey with one name. The
 * exception is a moved wall: the rest of the room was the floor of zones that
 * have another room to go to. A zone left with no room keeps the shape it
 * had, so opening a wall never loses a name; one that no longer fits the
 * `footprint` falls back to its clamped rectangle, off any `cutout`, and goes
 * when nothing of that is left. A room the schema would not keep is no home either. Rectangle
 * zones are the player's own and don't move. Returns `zones` when nothing changed.
 *
 * After a wall move, `swept` holds the strips it passed over, and zones and
 * rooms are measured off them: that floor changed hands, so it says nothing
 * about whose room is whose. A zone keeps the room it stood in as that room
 * grows or shrinks, whether or not the room beyond has a name. One the wall
 * swept whole is measured as a whole.
 */
export function refitZonesToRooms(
  zones: RoomZone[],
  rooms: readonly DetectedRoom[],
  footprint: readonly Vec2[],
  roomWidth: number,
  roomDepth: number,
  cutout?: FootprintCutout | undefined,
  swept: readonly Vec2[][] = []
): RoomZone[] {
  const polygons = zones.filter((zone) => zone.outline);
  const measured = new Map(
    polygons.map((zone) => {
      const area = zoneOffStrips(zone, swept);
      return [zone, area > 0 ? { strips: swept, area } : { strips: [], area: zoneArea(zone, null) }];
    })
  );
  const measure = (zone: RoomZone): { strips: readonly Vec2[][]; area: number } => measured.get(zone)!;
  const overlap = new Map(polygons.map((zone) => [zone, rooms.map((room) => overlapArea(zone, room, measure(zone).strips))]));
  const roomFloor = new Map<number, number>();
  const floorOf = (index: number): number => {
    const known = roomFloor.get(index);
    if (known !== undefined) return known;
    const area = roomOffStrips(rooms[index]!, swept);
    roomFloor.set(index, area);
    return area;
  };
  const isHome = (zone: RoomZone, index: number): boolean => {
    const roomArea = floorOf(index);
    if (roomArea < ROOM_TOO_BIG * measure(zone).area) return true;
    const others = polygons.filter((other) => other !== zone && overlap.get(other)![index]! > 0);
    const named = [zone, ...others].reduce((sum, entry) => sum + overlap.get(entry)![index]!, 0);
    return named >= NAMED_SHARE * roomArea && others.every((other) => overlap.get(other)!.some((area, at) => at !== index && area > 0));
  };
  const overlaps = polygons
    .flatMap((zone) =>
      rooms.flatMap((room, index) => {
        const area = overlap.get(zone)![index]!;
        return area > 0 && isHome(zone, index) ? [{ zone, room, area, share: area / measure(zone).area }] : [];
      })
    )
    .sort((a, b) => b.share - a.share || b.area - a.area);
  const homes = new Map<string, DetectedRoom>();
  const taken = new Set<DetectedRoom>();
  for (const { zone, room } of overlaps) {
    if (homes.has(zone.id) || taken.has(room)) continue;
    homes.set(zone.id, room);
    taken.add(room);
  }
  let changed = false;
  const next = zones.flatMap((zone) => {
    if (!zone.outline) return [zone];
    const home = homes.get(zone.id);
    const housed: RoomZone | null = home ? { ...plainZone(zone), ...regionShape(home) } : null;
    if (housed && isRoomZone(housed) && zoneShapeFits(housed, footprint)) {
      if (sameZone(zone, housed)) return [zone];
      changed = true;
      return [housed];
    }
    if (ringOnFootprint(zone.outline, footprint)) return [zone];
    changed = true;
    const rect = clampZoneRect(zone, roomWidth, roomDepth, cutout);
    return rect ? [{ ...plainZone(zone), ...rect }] : [];
  });
  return changed ? next : zones;
}

/** The first palette colour no zone uses yet, cycling once they're all taken. */
export function nextZoneColor(existing: readonly RoomZone[]): string {
  const used = new Set(existing.map((zone) => zone.color));
  const free = ZONE_COLORS.find((color) => !used.has(color));
  return free ?? ZONE_COLORS[existing.length % ZONE_COLORS.length]!;
}

/** "Zone 1", "Zone 2", … — the first number no zone on the floor is named after. */
export function defaultZoneName(existing: readonly RoomZone[]): string {
  const names = new Set(existing.map((zone) => zone.name));
  for (let n = 1; ; n++) {
    const name = `Zone ${n}`;
    if (!names.has(name)) return name;
  }
}

/**
 * Arrange (#629) zone by zone, so a house with rooms keeps each room's
 * furniture in it: each zone's items (centre inside, the first zone wins on
 * a shared edge) are packed inside that zone, around the locked items and
 * the zones already done; then the items outside every zone are packed into
 * the space the zones leave. Without zones it is plain `autoOrganize`. The
 * result keeps the input order.
 */
export function arrangeByZone(
  items: readonly FurnitureItem[],
  roomWidth: number,
  roomDepth: number,
  strategy: AutoOrganizeStrategy,
  options: { zones?: readonly ZoneShape[] | undefined; context?: CollisionContext; margin?: number }
): FurnitureItem[] {
  const zones = options.zones ?? [];
  const shared = {
    ...(options.context ? { context: options.context } : {}),
    ...(options.margin !== undefined ? { margin: options.margin } : {}),
  };
  if (zones.length === 0) return autoOrganize(items, roomWidth, roomDepth, strategy, shared);

  const locked = items.filter((item) => item.locked);
  let rest = items.filter((item) => !item.locked);
  const arranged: FurnitureItem[] = [];
  for (const zone of zones) {
    const inside = itemsInZone(zone, rest);
    if (inside.length === 0) continue;
    rest = rest.filter((item) => !inside.includes(item));
    const bounds = { x0: zone.x, x1: zone.x + zone.w, z0: zone.z, z1: zone.z + zone.d };
    // A polygon's rectangle holds more than the room: the rest is kept out.
    const context = zone.outline
      ? { context: { ...options.context, keepOut: [...(options.context?.keepOut ?? []), ...zoneCells(zone).outside] } }
      : {};
    arranged.push(
      ...autoOrganize(inside, roomWidth, roomDepth, strategy, { ...shared, ...context, bounds, obstacles: [...locked, ...arranged] })
    );
  }
  if (rest.length > 0) {
    const zoneRects = zones.flatMap((zone) =>
      zone.outline ? zoneCells(zone).inside : [{ x0: zone.x, x1: zone.x + zone.w, z0: zone.z, z1: zone.z + zone.d }]
    );
    const context = { ...options.context, keepOut: [...(options.context?.keepOut ?? []), ...zoneRects] };
    arranged.push(
      ...autoOrganize(rest, roomWidth, roomDepth, strategy, { ...shared, context, obstacles: [...locked, ...arranged] })
    );
  }
  const byId = new Map(arranged.map((item) => [item.id, item]));
  return items.map((item) => byId.get(item.id) ?? item);
}

/**
 * A polygon's rectangle cut along every corner into cells, each inside the
 * zone or outside it. Exact for walls on the axes; a cell across a diagonal
 * goes by its centre.
 */
function zoneCells(zone: ZoneShape): { inside: KeepOutRect[]; outside: KeepOutRect[] } {
  const rings = zoneRings(zone);
  const cuts = (axis: 'x' | 'z'): number[] => [...new Set(rings.flatMap((ring) => ring.map((point) => point[axis])))].sort((a, b) => a - b);
  const xs = cuts('x');
  const zs = cuts('z');
  const inside: KeepOutRect[] = [];
  const outside: KeepOutRect[] = [];
  for (let i = 1; i < xs.length; i++) {
    for (let j = 1; j < zs.length; j++) {
      const cell = { x0: xs[i - 1]!, x1: xs[i]!, z0: zs[j - 1]!, z1: zs[j]! };
      (zoneContains(zone, (cell.x0 + cell.x1) / 2, (cell.z0 + cell.z1) / 2) ? inside : outside).push(cell);
    }
  }
  return { inside, outside };
}

function sameRing(a: readonly Vec2[] | undefined, b: readonly Vec2[] | undefined): boolean {
  if (a === b) return true;
  return !!a && !!b && a.length === b.length && a.every((point, index) => point.x === b[index]!.x && point.z === b[index]!.z);
}

function sameRings(a: readonly Vec2[][] | undefined, b: readonly Vec2[][] | undefined): boolean {
  if (a === b) return true;
  return !!a && !!b && a.length === b.length && a.every((ring, index) => sameRing(ring, b[index]));
}

/** Field-wise equality, so re-submitting a zone unchanged keeps state identity. */
export function sameZone(a: RoomZone, b: RoomZone): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.color === b.color &&
    a.x === b.x &&
    a.z === b.z &&
    a.w === b.w &&
    a.d === b.d &&
    sameRing(a.outline, b.outline) &&
    sameRings(a.holes, b.holes) &&
    a.floorPattern === b.floorPattern &&
    a.floorColor === b.floorColor
  );
}

function round(value: number): number {
  const steps = 1 / ZONE_GRID;
  return Math.round(value * steps) / steps;
}
