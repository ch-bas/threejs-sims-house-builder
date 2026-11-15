import { floorHoleOutlines } from './floor-holes';
import { shellWalls } from './footprint';
import { INTERIOR_WALL_THICKNESS, interiorWallOpeningSpan } from './opening-snap';
import { computeFloorOpenings, stairToWorld, stairTopNosing, winderLayout } from './stairs';
import { stairRise } from './storeys';
import type { FloorLayout, FootprintCutout, FurnitureItem } from './types';

/**
 * The guard rail round a stairwell on the floor above (#923). Pure: the 3D
 * rail (`three/stairwell-rail.ts`), its walker colliders, the plan and the
 * exports all draw these segments.
 *
 * The rail follows the holes the slab is cut with (`floorHoleOutlines`, so
 * stairs that overlap get one rail round their one hole and the L's cut is
 * respected), set into the hole's margin by `STAIRWELL_RAIL_INSET`, so it
 * stands over the drop, not on the floor furniture is placed on. It leaves
 * out:
 * - the way off every flight: the strip from its top nosing forward to the
 *   floor, wherever that crosses the hole's edge (a flight whose head is
 *   inside a merged hole too), at least a walker wide and reaching a
 *   walker's radius back over the top tread;
 * - the edges along an outer wall or a partition, which the wall guards,
 *   except across a door in it or along a wall the storey hides;
 * - an edge's run inside another hole.
 */

/** One straight run of rail, in world XZ, on its storey's floor. */
export interface RailSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** Height of the rail's top above the floor (m), as the flight's handrail. */
export const STAIRWELL_RAIL_HEIGHT = 0.9;
/** How far the rail's centreline stands inside the hole's edge (m): half the hole's 5 cm margin. */
export const STAIRWELL_RAIL_INSET = 0.025;
/** A run shorter than this (m) is no rail: the stub beside an arrival or a wall. */
const MIN_RAIL_SEGMENT = 0.15;
/** A hole edge this close (m) to an outer wall's line is guarded by the wall. */
const OUTER_WALL_REACH = 0.1;
/** ... and this close to a partition's centreline. */
const PARTITION_REACH = INTERIOR_WALL_THICKNESS / 2 + 0.05;
/** A door this close (m) to a wall's line is in it. */
const DOOR_REACH = 0.4;
/** How far past the floor's edge the way off a flight reaches, give or take float noise. */
const ARRIVAL_REACH = 0.01;
/** The way off a flight is at least this wide (m): the walker (0.3 m radius) with room to spare. */
const ARRIVAL_MIN_WIDTH = 0.7;
/** ... and reaches this far back over the top tread (m): the walker's radius. */
const ARRIVAL_BACK = 0.3;
/** Lines this close to parallel (sine of the angle) count as parallel. */
const PARALLEL = 0.01;

/** On a plan the rail stands this many pixels inside the hole's dashed outline, so the two read apart. */
const PLAN_RAIL_GAP_PX = 5;
/** ... but never more than this far in (m): a small minimap must not fold the rail over itself. */
const PLAN_RAIL_MAX_INSET = 0.12;

/** The inset a plan draws the rail at (`stairwellRailSegments`'s `inset`) for its scale, in pixels per metre. */
export function planRailInset(pxPerMetre: number): number {
  if (!(pxPerMetre > 0)) return STAIRWELL_RAIL_INSET;
  return Math.min(PLAN_RAIL_MAX_INSET, Math.max(STAIRWELL_RAIL_INSET, PLAN_RAIL_GAP_PX / pxPerMetre));
}

type Point = [number, number];

/** What the rail is worked out from: the footprint, the stairs below, the walls and doors upstairs. */
export interface RailBuilding {
  width: number;
  /** Room depth (`RoomLayout.height`). */
  height: number;
  cutout?: FootprintCutout | undefined;
  floors: readonly Pick<FloorLayout, 'items' | 'height' | 'interiorWalls' | 'hiddenWalls'>[];
}

/** A wall line that guards part of any hole edge running along it. */
interface Blocker {
  a: Point;
  b: Point;
  reach: number;
}

/** The way off a flight, kept clear of rail: a rectangle from `origin`, `halfWidth` along `u`, from −`back` to `front` along `f`. */
interface Clearing {
  origin: Point;
  u: Point;
  f: Point;
  halfWidth: number;
  back: number;
  front: number;
}

/**
 * The rail segments round every stairwell cut through storey `floorIndex`'s
 * floor by the stairs on the storey below. Empty on the ground floor.
 * `inset` sets the rail further into the hole: the plan draws it clear of
 * the hole's outline.
 */
export function stairwellRailSegments(layout: RailBuilding, floorIndex: number, inset = STAIRWELL_RAIL_INSET): RailSegment[] {
  const floor = layout.floors[floorIndex];
  const floorBelow = floorIndex > 0 ? layout.floors[floorIndex - 1] : undefined;
  if (!floor || !floorBelow) return [];
  const openings = computeFloorOpenings(floorBelow);
  if (openings.length === 0) return [];
  // Shape space is [x, -z]: back to the world.
  const holes = floorHoleOutlines(layout.width, layout.height, openings, layout.cutout).map((hole) =>
    hole.map(([x, y]): Point => [x, -y])
  );

  const clearings: Clearing[] = [];
  for (const item of floorBelow.items) {
    if (item.type !== 'stairs' || !item.position) continue;
    const clearing = arrivalClearing(item, stairRise(item, floorBelow), holes);
    if (clearing) clearings.push(clearing);
  }
  const doors = floor.items.filter((item) => item.type === 'door' && item.position);
  const blockers: Blocker[] = [];
  for (const wall of shellWalls(layout)) {
    if (floor.hiddenWalls?.includes(wall.side)) continue;
    blockers.push(...solidPieces(wall, doors, OUTER_WALL_REACH));
  }
  for (const wall of floor.interiorWalls ?? []) blockers.push(...solidPieces(wall, doors, PARTITION_REACH));

  const segments: RailSegment[] = [];
  holes.forEach((hole, holeIndex) => {
    const others = holes.filter((_other, index) => index !== holeIndex);
    segments.push(...holeRail(hole, blockers, clearings, others, inset));
  });
  return segments;
}

/** A wall's runs between the doors in it: a doorway guards nothing. */
function solidPieces(
  wall: { x1: number; z1: number; x2: number; z2: number },
  doors: readonly FurnitureItem[],
  reach: number
): Blocker[] {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  if (length < 1e-9) return [];
  const ux = (wall.x2 - wall.x1) / length;
  const uz = (wall.z2 - wall.z1) / length;
  const spans: Array<[number, number]> = [];
  for (const door of doors) {
    const position = door.position!;
    const off = Math.abs((position.x - wall.x1) * uz - (position.z - wall.z1) * ux);
    if (off > DOOR_REACH) continue;
    const span = interiorWallOpeningSpan(wall, { width: door.width, position });
    if (!span) continue;
    // Centred on the wall's middle; to a fraction of its length.
    const mid = 0.5 + span.centre / length;
    spans.push([mid - span.width / 2 / length, mid + span.width / 2 / length]);
  }
  return subtract([0, 1], spans).map(([t0, t1]) => ({
    a: [wall.x1 + ux * length * t0, wall.z1 + uz * length * t0],
    b: [wall.x1 + ux * length * t1, wall.z1 + uz * length * t1],
    reach,
  }));
}

/**
 * The way off a flight: across its top nosing (widened to a walker), back
 * over the top tread by a walker's radius and forward to the floor. A head
 * on the hole's edge reaches just past it; a head inside a hole merged with
 * a neighbour's reaches across that hole to its far edge.
 */
function arrivalClearing(item: FurnitureItem, rise: number, holes: ReadonlyArray<readonly Point[]>): Clearing | null {
  const edge = arrivalEdge(item, rise);
  if (!edge || !item.position) return null;
  const toWorld = stairToWorld(item, item.position);
  const a = toWorld(...edge[0]);
  const b = toWorld(...edge[1]);
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1e-9) return null;
  const u: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  // Forward, off the flight: a straight flight's head is +z in its frame, a winder's −z.
  const head = toWorld(0, winderLayout(item) ? -1 : 1);
  const base = toWorld(0, 0);
  const f: Point = [head[0] - base[0], head[1] - base[1]];
  const origin: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let reach = 0;
  for (const along of [-0.45, 0, 0.45]) {
    const from: Point = [origin[0] + u[0] * length * along, origin[1] + u[1] * length * along];
    reach = Math.max(reach, acrossHole(from, f, holes));
  }
  return { origin, u, f, halfWidth: Math.max(length, ARRIVAL_MIN_WIDTH) / 2, back: ARRIVAL_BACK, front: reach + ARRIVAL_REACH };
}

/** How far from `from` along `dir` the hole it looks into ends: 0 when it looks onto floor. */
function acrossHole(from: Point, dir: Point, holes: ReadonlyArray<readonly Point[]>): number {
  const ahead: Point = [from[0] + dir[0] * 1e-3, from[1] + dir[1] * 1e-3];
  const hole = holes.find((candidate) => insidePolygon(ahead, candidate));
  if (!hole) return 0;
  const far: Point = [from[0] + dir[0] * 1e3, from[1] + dir[1] * 1e3];
  let nearest = Infinity;
  for (let i = 0; i < hole.length; i++) {
    const t = crossingT(from, far, hole[i]!, hole[(i + 1) % hole.length]!);
    if (t !== null && t * 1e3 > 1e-6) nearest = Math.min(nearest, t * 1e3);
  }
  return Number.isFinite(nearest) ? nearest : 0;
}

/** The part of segment a→b (as [t0, t1]) inside a clearing, or null: Liang–Barsky in its frame. */
function clearingSpan(a: Point, b: Point, c: Clearing): [number, number] | null {
  const local = (p: Point): Point => {
    const dx = p[0] - c.origin[0];
    const dz = p[1] - c.origin[1];
    return [dx * c.u[0] + dz * c.u[1], dx * c.f[0] + dz * c.f[1]];
  };
  const [p0, q0] = local(a);
  const [p1, q1] = local(b);
  // Strictly inside: an edge on the clearing's side line (a winder's inner edge) keeps its rail.
  const hw = c.halfWidth - 1e-6;
  let from = 0;
  let to = 1;
  for (const [start, delta, lo, hi] of [
    [p0, p1 - p0, -hw, hw],
    [q0, q1 - q0, -c.back, c.front],
  ] as const) {
    if (Math.abs(delta) < 1e-12) {
      if (start <= lo || start >= hi) return null;
      continue;
    }
    const ta = (lo - start) / delta;
    const tb = (hi - start) / delta;
    from = Math.max(from, Math.min(ta, tb));
    to = Math.min(to, Math.max(ta, tb));
  }
  return to > from ? [from, to] : null;
}

/** The head edge of the top tread's nosing, in the stair's frame: where the walker steps off. */
function arrivalEdge(item: Parameters<typeof stairTopNosing>[0], rise: number): [Point, Point] | null {
  const nosing = stairTopNosing(item, rise);
  const zs = nosing.map(([, z]) => z);
  const head = winderLayout(item) ? Math.min(...zs) : Math.max(...zs);
  const edge = nosing.filter(([, z]) => Math.abs(z - head) < 1e-9);
  if (edge.length < 2) return null;
  const xs = edge.map(([x]) => x);
  return [
    [Math.min(...xs), head],
    [Math.max(...xs), head],
  ];
}

/** The rail round one hole: its edges, less what is blocked, set into the hole. */
function holeRail(
  hole: readonly Point[],
  blockers: readonly Blocker[],
  clearings: readonly Clearing[],
  others: ReadonlyArray<readonly Point[]>,
  inset: number
): RailSegment[] {
  const n = hole.length;
  if (n < 3) return [];
  // Which way is into the hole: left of each edge for a counter-clockwise outline.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = hole[i]!;
    const [bx, bz] = hole[(i + 1) % n]!;
    area += ax * bz - bx * az;
  }
  const side = area >= 0 ? 1 : -1;
  const inward = (i: number): Point => {
    const [ax, az] = hole[i]!;
    const [bx, bz] = hole[(i + 1) % n]!;
    const length = Math.hypot(bx - ax, bz - az) || 1;
    return [(side * -(bz - az)) / length, (side * (bx - ax)) / length];
  };
  // The inset outline's corners: where neighbouring inset edges meet.
  const corner = (i: number): Point => {
    const prev = (i + n - 1) % n;
    const [nx0, nz0] = inward(prev);
    const [nx1, nz1] = inward(i);
    const [px, pz] = hole[i]!;
    // Mitre: the bisector, lengthened so each edge is moved by exactly the inset.
    const mx = nx0 + nx1;
    const mz = nz0 + nz1;
    const dot = (mx * nx1 + mz * nz1) || 1;
    const scale = inset / dot;
    return [px + mx * scale, pz + mz * scale];
  };

  const segments: RailSegment[] = [];
  for (let i = 0; i < n; i++) {
    const a = hole[i]!;
    const b = hole[(i + 1) % n]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-9) continue;
    const blocked: Array<[number, number]> = [];
    for (const blocker of blockers) {
      const span = alongSpan(a, b, length, blocker);
      if (span) blocked.push(span);
    }
    for (const clearing of clearings) {
      const span = clearingSpan(a, b, clearing);
      if (span) blocked.push(span);
    }
    blocked.push(...insideOthers(a, b, others));
    const [nx, nz] = inward(i);
    const start = corner(i);
    const end = corner((i + 1) % n);
    for (const [t0, t1] of subtract([0, 1], blocked)) {
      const from: Point = t0 <= 1e-9 ? start : [a[0] + (b[0] - a[0]) * t0 + nx * inset, a[1] + (b[1] - a[1]) * t0 + nz * inset];
      const to: Point = t1 >= 1 - 1e-9 ? end : [a[0] + (b[0] - a[0]) * t1 + nx * inset, a[1] + (b[1] - a[1]) * t1 + nz * inset];
      if (Math.hypot(to[0] - from[0], to[1] - from[1]) < MIN_RAIL_SEGMENT) continue;
      segments.push({ x1: from[0], z1: from[1], x2: to[0], z2: to[1] });
    }
  }
  return segments;
}

/** The part of edge a→b (as [t0, t1]) a parallel blocker within its reach runs along, or null. */
function alongSpan(a: Point, b: Point, length: number, blocker: Blocker): [number, number] | null {
  const ux = (b[0] - a[0]) / length;
  const uz = (b[1] - a[1]) / length;
  const bLength = Math.hypot(blocker.b[0] - blocker.a[0], blocker.b[1] - blocker.a[1]);
  if (bLength < 1e-9) return null;
  const cross = (ux * (blocker.b[1] - blocker.a[1]) - uz * (blocker.b[0] - blocker.a[0])) / bLength;
  if (Math.abs(cross) > PARALLEL) return null;
  const offset = (p: Point) => Math.abs((p[0] - a[0]) * uz - (p[1] - a[1]) * ux);
  if (offset(blocker.a) > blocker.reach || offset(blocker.b) > blocker.reach) return null;
  const t = (p: Point) => ((p[0] - a[0]) * ux + (p[1] - a[1]) * uz) / length;
  const t0 = Math.max(0, Math.min(t(blocker.a), t(blocker.b)));
  const t1 = Math.min(1, Math.max(t(blocker.a), t(blocker.b)));
  return t1 > t0 ? [t0, t1] : null;
}

/** The parts of edge a→b inside any of the other holes. */
function insideOthers(a: Point, b: Point, others: ReadonlyArray<readonly Point[]>): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const other of others) {
    const cuts = [0, 1];
    for (let i = 0; i < other.length; i++) {
      const t = crossingT(a, b, other[i]!, other[(i + 1) % other.length]!);
      if (t !== null) cuts.push(t);
    }
    cuts.sort((p, q) => p - q);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const t0 = cuts[i]!;
      const t1 = cuts[i + 1]!;
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      if (insidePolygon([a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm], other)) spans.push([t0, t1]);
    }
  }
  return spans;
}

/** Where segment a→b crosses segment c→d, as a fraction of a→b, or null. */
function crossingT(a: Point, b: Point, c: Point, d: Point): number | null {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / denom;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / denom;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

function insidePolygon([x, z]: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** `range` less every span in `spans`, in order. */
function subtract(range: [number, number], spans: ReadonlyArray<[number, number]>): Array<[number, number]> {
  let kept: Array<[number, number]> = [range];
  for (const [s0, s1] of spans) {
    kept = kept.flatMap(([k0, k1]): Array<[number, number]> => {
      if (s1 <= k0 || s0 >= k1) return [[k0, k1]];
      const parts: Array<[number, number]> = [];
      if (s0 > k0) parts.push([k0, s0]);
      if (s1 < k1) parts.push([s1, k1]);
      return parts;
    });
  }
  return kept;
}
