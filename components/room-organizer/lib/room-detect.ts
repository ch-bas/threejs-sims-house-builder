import { floorKeepOut, type KeepOutBuilding } from './floor-keep-out';
import { footprintOutline } from './footprint';
import { INTERIOR_WALL_THICKNESS } from './opening-snap';
import type { KeepOutRect } from './geometry';
import type { FloorLayout, InteriorWall, Vec2 } from './types';

/**
 * Rooms from walls (#719). A pure planar-graph walk: the footprint, the
 * partitions and the keep-out shapes are cut into edges at every junction,
 * and each face of the graph that lies inside the house and outside the
 * keep-out is a room. Doors and windows are not in the graph: an opening
 * doesn't break a boundary. Areas run to the wall centrelines, as the
 * footprint's own area does.
 */

/** A room's boundary: an outer ring and, around anything nested inside it, holes. */
export interface PlanRegion {
  outline: Vec2[];
  holes?: Vec2[][];
  /** Net of the holes, in m². */
  area: number;
  /** A point inside the region, in its largest clear stretch. */
  anchor: Vec2;
}

export type DetectedRoom = PlanRegion;

/** A clear stretch of a region: a run from x0 to x1, the same all the way from z0 to z1. */
export interface PlanBand {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** A wall end this close to a wall reads as touching it: half a wall's thickness hides the gap. */
const JOIN_TOLERANCE = INTERIOR_WALL_THICKNESS / 2;
/** Two graph vertices this close are one vertex (1 mm). */
const VERTEX_TOLERANCE = 1e-3;
/** A room narrower or smaller than this is the space between two walls (see MIN_ZONE_SIZE). */
const MIN_ROOM_SIZE = 0.3;
const MIN_ROOM_AREA = MIN_ROOM_SIZE * MIN_ROOM_SIZE;
/** Hydraulic width, 2·area / perimeter: a square's is half its side. */
const MIN_ROOM_WIDTH = MIN_ROOM_SIZE / 2;
const COORDINATE_PRECISION = 1e6;

interface Segment {
  a: Vec2;
  b: Vec2;
}

/** Positive when the ring winds from +x towards +z. */
function signedArea(ring: readonly Vec2[]): number {
  let sum = 0;
  ring.forEach((p, index) => {
    const q = ring[(index + 1) % ring.length]!;
    sum += p.x * q.z - q.x * p.z;
  });
  return sum / 2;
}

export function ringArea(ring: readonly Vec2[]): number {
  return Math.abs(signedArea(ring));
}

/** Even-odd; a point on the ring may land either way (see `onRing`). */
export function pointInRing(ring: readonly Vec2[], x: number, z: number): boolean {
  let inside = false;
  ring.forEach((p, index) => {
    const q = ring[(index + 1) % ring.length]!;
    if (p.z > z !== q.z > z && x < p.x + ((z - p.z) / (q.z - p.z)) * (q.x - p.x)) inside = !inside;
  });
  return inside;
}

function closestOnSegment(segment: Segment, x: number, z: number): Vec2 {
  const dx = segment.b.x - segment.a.x;
  const dz = segment.b.z - segment.a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - segment.a.x) * dx + (z - segment.a.z) * dz) / lengthSq));
  return { x: segment.a.x + t * dx, z: segment.a.z + t * dz };
}

function ringSegments(ring: readonly Vec2[]): Segment[] {
  return ring.map((a, index) => ({ a, b: ring[(index + 1) % ring.length]! }));
}

/** Whether the point lies on the ring itself, to `tolerance` metres. */
export function onRing(ring: readonly Vec2[], x: number, z: number, tolerance: number = VERTEX_TOLERANCE): boolean {
  return ringSegments(ring).some((segment) => {
    const nearest = closestOnSegment(segment, x, z);
    return Math.hypot(nearest.x - x, nearest.z - z) <= tolerance;
  });
}

/** Whether two of the ring's edges cross. Touching at a corner, as a room on a cut vertex does, isn't crossing. */
export function ringCrossesItself(ring: readonly Vec2[]): boolean {
  const edges = ringSegments(ring);
  const side = (p: Vec2, q: Vec2, r: Vec2): number => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return edges.some((e, i) =>
    edges.slice(i + 1).some((f) => side(e.a, e.b, f.a) * side(e.a, e.b, f.b) < 0 && side(f.a, f.b, e.a) * side(f.a, f.b, e.b) < 0)
  );
}

/** The corners of a keep-out rect, with its rotation about its centre (see `itemEntersRect`). */
function keepOutRing(rect: KeepOutRect): Vec2[] {
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  const hw = (rect.x1 - rect.x0) / 2;
  const hd = (rect.z1 - rect.z0) / 2;
  const cos = Math.cos(rect.rotation ?? 0);
  const sin = Math.sin(rect.rotation ?? 0);
  return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as const).map(([lx, lz]) => ({
    x: cx + lx * cos + lz * sin,
    z: cz - lx * sin + lz * cos,
  }));
}

function wallSegment(wall: InteriorWall): Segment {
  return { a: { x: wall.x1, z: wall.z1 }, b: { x: wall.x2, z: wall.z2 } };
}

/** A wall with each end pulled onto whatever it nearly touches; null if nothing is left of it. */
function joinWall(wall: Segment, others: readonly Segment[]): Segment | null {
  const pull = (end: Vec2): Vec2 => {
    let best = end;
    let bestDistance = JOIN_TOLERANCE;
    for (const other of others) {
      const nearest = closestOnSegment(other, end.x, end.z);
      const distance = Math.hypot(nearest.x - end.x, nearest.z - end.z);
      if (distance <= bestDistance) {
        best = nearest;
        bestDistance = distance;
      }
    }
    return best;
  };
  const a = pull(wall.a);
  const b = pull(wall.b);
  return Math.hypot(a.x - b.x, a.z - b.z) > VERTEX_TOLERANCE ? { a, b } : null;
}

/** Where two segments cross, if they do; collinear overlaps are found through their ends. */
function crossing(p: Segment, q: Segment): Vec2 | null {
  const rx = p.b.x - p.a.x;
  const rz = p.b.z - p.a.z;
  const sx = q.b.x - q.a.x;
  const sz = q.b.z - q.a.z;
  const denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const qpx = q.a.x - p.a.x;
  const qpz = q.a.z - p.a.z;
  const t = (qpx * sz - qpz * sx) / denominator;
  const u = (qpx * rz - qpz * rx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: p.a.x + t * rx, z: p.a.z + t * rz } : null;
}

class PlanarGraph {
  readonly vertices: Vec2[] = [];
  /** Sorted by angle by `sortByAngle`, which `faces` relies on. */
  readonly neighbours: number[][] = [];

  vertexAt(point: Vec2): number {
    const found = this.vertices.findIndex((v) => Math.hypot(v.x - point.x, v.z - point.z) <= VERTEX_TOLERANCE);
    if (found >= 0) return found;
    this.vertices.push({
      x: Math.round(point.x * COORDINATE_PRECISION) / COORDINATE_PRECISION,
      z: Math.round(point.z * COORDINATE_PRECISION) / COORDINATE_PRECISION,
    });
    this.neighbours.push([]);
    return this.vertices.length - 1;
  }

  connect(u: number, v: number): void {
    if (u === v || this.neighbours[u]!.includes(v)) return;
    this.neighbours[u]!.push(v);
    this.neighbours[v]!.push(u);
  }

  disconnect(u: number, v: number): void {
    this.neighbours[u] = this.neighbours[u]!.filter((n) => n !== v);
    this.neighbours[v] = this.neighbours[v]!.filter((n) => n !== u);
  }

  sortByAngle(): void {
    this.neighbours.forEach((list, index) => {
      const origin = this.vertices[index]!;
      const angle = (n: number) => Math.atan2(this.vertices[n]!.z - origin.z, this.vertices[n]!.x - origin.x);
      list.sort((a, b) => angle(a) - angle(b));
    });
  }

  /**
   * Every face boundary: from each directed edge, take the next edge round at
   * each vertex. Bounded faces wind positive, and each connected piece's
   * outside winds negative. `spurs` are the edges with one face on both sides,
   * which close nothing.
   */
  faces(): { rings: number[][]; spurs: Array<[number, number]> } {
    const faceOf = new Map<string, number>();
    const rings: number[][] = [];
    this.neighbours.forEach((list, start) => {
      for (const first of list) {
        if (faceOf.has(`${start}>${first}`)) continue;
        const ring: number[] = [];
        let u = start;
        let v = first;
        do {
          faceOf.set(`${u}>${v}`, rings.length);
          ring.push(u);
          const around = this.neighbours[v]!;
          const next = around[(around.indexOf(u) - 1 + around.length) % around.length]!;
          u = v;
          v = next;
        } while (u !== start || v !== first);
        rings.push(ring);
      }
    });
    const spurs: Array<[number, number]> = [];
    this.neighbours.forEach((list, u) => {
      for (const v of list) {
        if (u < v && faceOf.get(`${u}>${v}`) === faceOf.get(`${v}>${u}`)) spurs.push([u, v]);
      }
    });
    return { rings, spurs };
  }
}

/** Cut every segment at every junction and collect the pieces into a graph. */
function buildGraph(segments: readonly Segment[]): PlanarGraph {
  const cuts: Vec2[][] = segments.map((segment) => [segment.a, segment.b]);
  const cutAtEnd = (end: Vec2, segment: Segment, index: number): void => {
    const nearest = closestOnSegment(segment, end.x, end.z);
    if (Math.hypot(nearest.x - end.x, nearest.z - end.z) <= VERTEX_TOLERANCE) cuts[index]!.push(end);
  };
  segments.forEach((p, i) => {
    for (let j = i + 1; j < segments.length; j++) {
      const q = segments[j]!;
      const point = crossing(p, q);
      if (point) {
        cuts[i]!.push(point);
        cuts[j]!.push(point);
      }
      cutAtEnd(p.a, q, j);
      cutAtEnd(p.b, q, j);
      cutAtEnd(q.a, p, i);
      cutAtEnd(q.b, p, i);
    }
  });
  const graph = new PlanarGraph();
  segments.forEach((segment, index) => {
    const along = (point: Vec2): number => Math.hypot(point.x - segment.a.x, point.z - segment.a.z);
    const ids = [...cuts[index]!].sort((a, b) => along(a) - along(b)).map((point) => graph.vertexAt(point));
    for (let i = 1; i < ids.length; i++) graph.connect(ids[i - 1]!, ids[i]!);
  });
  graph.sortByAngle();
  return graph;
}

/** A ring without the vertices that only mark a junction on a straight run. */
function cornersOf(ring: readonly Vec2[]): Vec2[] {
  const corners = ring.filter((point, index) => {
    const before = ring[(index - 1 + ring.length) % ring.length]!;
    const after = ring[(index + 1) % ring.length]!;
    const cross = (point.x - before.x) * (after.z - point.z) - (point.z - before.z) * (after.x - point.x);
    return Math.abs(cross) > 1e-9;
  });
  return corners.length >= 3 ? corners : [...ring];
}

function perimeter(ring: readonly Vec2[]): number {
  return ringSegments(ring).reduce((sum, { a, b }) => sum + Math.hypot(b.x - a.x, b.z - a.z), 0);
}

/**
 * The largest clear stretch of the rings, cut along every corner's `z`
 * (even-odd, so a hole splits a run). Null for rings with no area.
 */
export function largestBand(rings: readonly (readonly Vec2[])[]): PlanBand | null {
  const zs = [...new Set(rings.flatMap((ring) => ring.map((point) => point.z)))].sort((a, b) => a - b);
  const segments = rings.flatMap(ringSegments);
  let best: PlanBand | null = null;
  for (let i = 1; i < zs.length; i++) {
    const z0 = zs[i - 1]!;
    const z1 = zs[i]!;
    if (z1 - z0 < 1e-9) continue;
    const z = (z0 + z1) / 2;
    const xs = segments
      .filter(({ a, b }) => a.z > z !== b.z > z)
      .map(({ a, b }) => a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x))
      .sort((p, q) => p - q);
    for (let k = 1; k < xs.length; k += 2) {
      const x0 = xs[k - 1]!;
      const x1 = xs[k]!;
      const size = (x1 - x0) * (z1 - z0);
      if (!best || size > (best.x1 - best.x0) * (best.z1 - best.z0) + 1e-9) best = { x0, x1, z0, z1 };
    }
  }
  return best;
}

interface RegionQuery {
  segments: readonly Segment[];
  /** Whether the face around this point counts. */
  keeps(x: number, z: number): boolean;
  minArea: number;
  minWidth: number;
}

function planarRegions({ segments, keeps, minArea, minWidth }: RegionQuery): PlanRegion[] {
  const graph = buildGraph(segments);
  let { rings, spurs } = graph.faces();
  // Taking a spur away can leave another one, so walk until none is left.
  while (spurs.length > 0) {
    for (const [u, v] of spurs) graph.disconnect(u, v);
    ({ rings, spurs } = graph.faces());
  }

  const polygons = rings.map((ring) => ring.map((id) => graph.vertices[id]!));
  const bounded = polygons.filter((ring) => signedArea(ring) > 0);
  const holes = new Map<readonly Vec2[], Vec2[][]>();
  for (const ring of polygons) {
    if (signedArea(ring) >= 0) continue;
    const { x, z } = ring[0]!;
    // The smallest face around this piece; the piece's own faces touch the point.
    const around = bounded
      .filter((face) => !onRing(face, x, z) && pointInRing(face, x, z))
      .sort((a, b) => signedArea(a) - signedArea(b))[0];
    if (around) holes.set(around, [...(holes.get(around) ?? []), ring]);
  }

  const regions: PlanRegion[] = [];
  for (const ring of bounded) {
    const inner = holes.get(ring) ?? [];
    const band = largestBand([ring, ...inner]);
    if (!band) continue;
    const anchor = { x: (band.x0 + band.x1) / 2, z: (band.z0 + band.z1) / 2 };
    if (!keeps(anchor.x, anchor.z)) continue;
    const area = signedArea(ring) - inner.reduce((sum, hole) => sum + ringArea(hole), 0);
    const length = perimeter(ring) + inner.reduce((sum, hole) => sum + perimeter(hole), 0);
    if (area < minArea || (2 * area) / length < minWidth) continue;
    regions.push({
      outline: cornersOf(ring),
      ...(inner.length > 0 ? { holes: inner.map(cornersOf) } : {}),
      area,
      anchor,
    });
  }
  return regions.sort((a, b) => a.anchor.z - b.anchor.z || a.anchor.x - b.anchor.x);
}

/**
 * The closed rooms of a storey. `outline` is the footprint, any simple
 * polygon, wound either way. `keepOut` (the porch, the stairwells) is left
 * out of the rooms: a shape against a wall bites into its room's outline, one
 * in mid-floor becomes a hole. A closed partition inside a room is a hole in
 * that room, and a room of its own.
 */
export function detectRooms(walls: readonly InteriorWall[], outline: readonly Vec2[], keepOut: readonly KeepOutRect[]): DetectedRoom[] {
  const keepOutRings = keepOut.map(keepOutRing);
  const fixed = [...ringSegments(outline), ...keepOutRings.flatMap(ringSegments)];
  const raw = walls.map(wallSegment);
  const joined = raw.flatMap((wall) => joinWall(wall, [...fixed, ...raw.filter((other) => other !== wall)]) ?? []);
  return planarRegions({
    segments: [...fixed, ...joined],
    keeps: (x, z) => pointInRing(outline, x, z) && !keepOutRings.some((ring) => pointInRing(ring, x, z)),
    minArea: MIN_ROOM_AREA,
    minWidth: MIN_ROOM_WIDTH,
  });
}

/**
 * A shape less the keep-out: what of it is real floor. A rectangle drawn over
 * the porch or a stairwell keeps its shape as a zone, but a finish painted on
 * it can't cover a hole in the floor (#720).
 */
export function regionsOutside(outline: readonly Vec2[], holes: readonly (readonly Vec2[])[], keepOut: readonly KeepOutRect[]): PlanRegion[] {
  const xs = outline.map((point) => point.x);
  const zs = outline.map((point) => point.z);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  const keepOutRings = keepOut.map(keepOutRing).filter((ring) =>
    ring.some((point) => point.x > box.x0) &&
    ring.some((point) => point.x < box.x1) &&
    ring.some((point) => point.z > box.z0) &&
    ring.some((point) => point.z < box.z1)
  );
  // Nothing in the way, the usual case: no graph to walk on every plan paint.
  if (keepOutRings.length === 0) {
    const band = largestBand([outline, ...holes]);
    if (!band) return [];
    const area = ringArea(outline) - holes.reduce((sum, hole) => sum + ringArea(hole), 0);
    const anchor = { x: (band.x0 + band.x1) / 2, z: (band.z0 + band.z1) / 2 };
    return [{ outline: [...outline], ...(holes.length > 0 ? { holes: holes.map((hole) => [...hole]) } : {}), area, anchor }];
  }
  return planarRegions({
    segments: [...ringSegments(outline), ...holes.flatMap(ringSegments), ...keepOutRings.flatMap(ringSegments)],
    keeps: (x, z) => pointInRing(outline, x, z) && ![...holes, ...keepOutRings].some((ring) => pointInRing(ring, x, z)),
    minArea: 1e-4,
    minWidth: 0,
  });
}

/**
 * More walls than rooms are looked for on: the walk grows with the cube of the
 * walls (a crossing grid of 80 takes 53 ms, of 200 over a second, of 998 more
 * than three minutes), and it runs on commit. Past any real house. The panels
 * say so, and polygon zones keep the shape they have.
 */
export const MAX_ROOM_WALLS = 120;

export function hasTooManyWalls(floor: Pick<FloorLayout, 'interiorWalls'>): boolean {
  return (floor.interiorWalls?.length ?? 0) > MAX_ROOM_WALLS;
}

/** The rooms of one storey of a house, past its porch and stairwells. The outline already leaves out a cut corner. */
export function floorRooms(building: KeepOutBuilding, floorIndex: number): DetectedRoom[] {
  const floor = building.floors[floorIndex];
  if (!floor || hasTooManyWalls(floor)) return [];
  const keepOut = floorKeepOut(building, floorIndex).filter((rect) => !rect.cutout);
  return detectRooms(floor.interiorWalls ?? [], footprintOutline(building), keepOut);
}
