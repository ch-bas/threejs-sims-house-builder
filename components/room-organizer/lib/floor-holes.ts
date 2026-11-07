import { cutoutRect } from './footprint';
import type { FloorOpening } from './stairs';
import type { FootprintCutout } from './types';

/**
 * The stairwell holes cut through a floor (#559): one outline shared by the
 * 3D slab (`three/room-builder.ts`), the walkthrough shafts and the plan and
 * its exports (`stairwellOutlines`), so what the plan shows is what is cut.
 * Pure: no three.js. Outlines are in the floor plate's shape space, [x, -z].
 */

/**
 * Merge overlapping/touching axis-aligned hole rectangles so no two holes on a
 * wall overlap — overlapping holes are illegal for earcut and produce phantom
 * fill or self-intersecting triangles. Rectangles are `[x0, y0, x1, y1]`.
 * Returns a disjoint set covering the same area (rectangle union via a sweep
 * that unions any pair whose AABBs intersect, iterated to a fixed point).
 */
export function mergeHoleRects(
  rects: ReadonlyArray<readonly [number, number, number, number]>
): Array<[number, number, number, number]> {
  const merged: Array<[number, number, number, number]> = rects.map(
    (r) => [r[0], r[1], r[2], r[3]] as [number, number, number, number]
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i]!;
        const b = merged[j]!;
        // AABB overlap test (touching edges count as overlapping so adjacent
        // holes fuse into one clean rectangle instead of leaving a zero-width
        // sliver of wall that earcut can choke on).
        const overlap = a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
        if (!overlap) continue;
        // Union into the bounding rectangle. For like-height openings on a wall
        // (equal y0/y1) this is an exact interval union; otherwise the bounding
        // box slightly over-cuts, which is safe (no phantom fill) and rare.
        a[0] = Math.min(a[0], b[0]);
        a[1] = Math.min(a[1], b[1]);
        a[2] = Math.max(a[2], b[2]);
        a[3] = Math.max(a[3], b[3]);
        merged.splice(j, 1);
        changed = true;
        j--;
      }
    }
  }
  return merged;
}

/**
 * The holes the floor plate (`buildFloorGeometryWithOpenings`) cuts, as closed polygons in its
 * shape space, [x, -z]. Shared so whatever lines a stairwell (the walkthrough
 * shafts, #359) follows the plate's clamped, merged holes, not the raw stairs.
 */
export function floorHoleOutlines(
  roomWidth: number,
  roomDepth: number,
  openings: readonly FloorOpening[],
  cutout?: FootprintCutout
): Array<Array<[number, number]>> {
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const holes: Array<Array<[number, number]>> = [];

  // Split openings by whether they're axis-aligned (rotation a multiple of 90°)
  // or genuinely rotated. Axis-aligned holes go through mergeHoleRects so two
  // stacked stairwells fuse into one clean rectangle (overlapping holes are
  // illegal for earcut). Rotated holes are cut as individual rotated rectangles
  // matching the stairs' footprint — no over-inflated AABB, so no corner gaps.
  const axisAligned: FloorOpening[] = [];
  const rotated: FloorOpening[] = [];
  const outlined: FloorOpening[] = [];
  for (const o of openings) {
    if (o.outline) outlined.push(o);
    else (isAxisAlignedRotation(o.rotation) ? axisAligned : rotated).push(o);
  }

  // Clamp every hole inside the floor contour, inset by an epsilon: a hole
  // crossing — or even sharing an edge with — the outer ring is illegal for
  // earcut and produces phantom fill on the floor above (#146). Stairs can
  // legally sit at (or past) the room edge, so this is reachable.
  const HOLE_INSET = 0.001;
  const clampX = (v: number) => Math.min(halfW - HOLE_INSET, Math.max(-halfW + HOLE_INSET, v));
  const clampY = (v: number) => Math.min(halfD - HOLE_INSET, Math.max(-halfD + HOLE_INSET, v));
  const pushBox = (x0: number, y0: number, x1: number, y1: number): void => {
    if (x1 - x0 <= 0 || y1 - y0 <= 0) return;
    holes.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  };
  // A hole with any corner outside the contour is clipped to the inset
  // contour, so a winder's L against a wall stays an L (#572). Should the
  // clip leave a polygon that touches itself (the hole split in two), it is
  // cut as its clamped AABB instead — a slightly larger hole beats corrupt
  // triangulation (#146).
  const pushPolygon = (points: Array<[number, number]>): void => {
    if (!points.some(([x, y]) => x <= -halfW || x >= halfW || y <= -halfD || y >= halfD)) {
      holes.push(points);
      return;
    }
    const clipped = clipToRect(points, -halfW + HOLE_INSET, -halfD + HOLE_INSET, halfW - HOLE_INSET, halfD - HOLE_INSET);
    if (clipped.length >= 3 && isSimplePolygon(clipped)) {
      if (Math.abs(polygonArea(clipped)) > 1e-9) holes.push(clipped);
      return;
    }
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    pushBox(clampX(Math.min(...xs)), clampY(Math.min(...ys)), clampX(Math.max(...xs)), clampY(Math.max(...ys)));
  };

  const rects: Array<[number, number, number, number]> = [];
  for (const o of axisAligned) {
    // At 90°/270° the footprint's width and depth swap in world space.
    const swap = Math.abs(Math.sin(o.rotation)) > 0.5;
    const worldW = swap ? o.depth : o.width;
    const worldD = swap ? o.width : o.depth;
    const x0 = clampX(o.centerX - worldW / 2);
    const y0 = clampY(-(o.centerZ + worldD / 2));
    const x1 = clampX(o.centerX + worldW / 2);
    const y1 = clampY(-(o.centerZ - worldD / 2));
    if (x1 - x0 > 0 && y1 - y0 > 0) rects.push([x0, y0, x1, y1]);
  }
  for (const [x0, y0, x1, y1] of mergeHoleRects(rects)) pushBox(x0, y0, x1, y1);

  for (const o of rotated) {
    if (o.width <= 0 || o.depth <= 0) continue;
    // Rotate the footprint corners about the opening centre. rotation.y turns
    // local +X toward world -Z, so a world-space point is
    // (cx + lx·cos + lz·sin, cz - lx·sin + lz·cos); shape-Y is world -Z.
    const cos = Math.cos(o.rotation);
    const sin = Math.sin(o.rotation);
    const hw = o.width / 2;
    const hd = o.depth / 2;
    const localCorners: Array<[number, number]> = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
    pushPolygon(
      localCorners.map(([lx, lz]): [number, number] => {
        const worldX = o.centerX + lx * cos + lz * sin;
        const worldZ = o.centerZ - lx * sin + lz * cos;
        return [worldX, -worldZ];
      })
    );
  }

  // Outlined holes (a winder's L, #205): cut as given, or as their clamped
  // bounding box when they cross the floor outline, like rotated holes.
  for (const o of outlined) pushPolygon(o.outline!.map(([x, z]): [number, number] => [x, -z]));

  const notch = cutoutRect({ width: roomWidth, height: roomDepth, cutout });
  return notch ? holes.flatMap((hole) => clearOfNotch(hole, notch, HOLE_INSET)) : holes;
}

/**
 * A stairwell hole kept off the L's cut (#727): stairs stay out of the corner,
 * but one flush with a notch wall still shares an edge with the floor outline,
 * which earcut can't take. A hole that reaches the cut is clipped to the side
 * of it that leaves the most hole.
 */
function clearOfNotch(
  hole: Array<[number, number]>,
  notch: { x0: number; x1: number; z0: number; z1: number },
  inset: number
): Array<Array<[number, number]>> {
  // In shape space, where y is world −z.
  const x0 = notch.x0 - inset;
  const x1 = notch.x1 + inset;
  const y0 = -notch.z1 - inset;
  const y1 = -notch.z0 + inset;
  const xs = hole.map(([x]) => x);
  const ys = hole.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (maxX <= x0 || minX >= x1 || maxY <= y0 || minY >= y1) return [hole];
  const far = 1e4;
  const candidates = [
    clipToRect(hole, -far, -far, x0, far),
    clipToRect(hole, x1, -far, far, far),
    clipToRect(hole, -far, -far, far, y0),
    clipToRect(hole, -far, y1, far, far),
  ].filter((clipped) => clipped.length >= 3);
  const best = candidates.reduce<Array<[number, number]>>(
    (kept, clipped) => (Math.abs(polygonArea(clipped)) > Math.abs(polygonArea(kept)) ? clipped : kept),
    []
  );
  return best.length >= 3 ? [best] : [];
}

/**
 * Sutherland–Hodgman: `points` clipped to the rectangle [x0, x1] × [y0, y1],
 * with repeated and collinear vertices dropped.
 */
function clipToRect(points: ReadonlyArray<[number, number]>, x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const edges: Array<[(p: [number, number]) => number, number]> = [
    [([x]) => x - x0, 0],
    [([x]) => x1 - x, 0],
    [([, y]) => y - y0, 1],
    [([, y]) => y1 - y, 1],
  ];
  let polygon: Array<[number, number]> = [...points];
  for (const [inside] of edges) {
    const next: Array<[number, number]> = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!;
      const b = polygon[(i + 1) % polygon.length]!;
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) next.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    polygon = next;
    if (polygon.length === 0) return [];
  }
  // Drop repeated points, then points in line with their neighbours.
  const unique = polygon.filter((p, i) => {
    const q = polygon[(i + 1) % polygon.length]!;
    return Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9;
  });
  return unique.filter((p, i) => {
    const prev = unique[(i + unique.length - 1) % unique.length]!;
    const next = unique[(i + 1) % unique.length]!;
    return Math.abs((p[0] - prev[0]) * (next[1] - prev[1]) - (p[1] - prev[1]) * (next[0] - prev[0])) > 1e-12;
  });
}

function polygonArea(points: ReadonlyArray<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[(i + 1) % points.length]!;
    sum += ax * by - bx * ay;
  }
  return sum / 2;
}

/** No two non-adjacent edges touch or cross, and no vertex repeats. */
function isSimplePolygon(points: ReadonlyArray<[number, number]>): boolean {
  const n = points.length;
  const orient = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const onSegment = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.min(p[0], q[0]) - 1e-12 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-12 &&
    Math.min(p[1], q[1]) - 1e-12 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-12;
  const touch = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean => {
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
    const eps = 1e-12;
    return (
      (Math.abs(o1) < eps && onSegment(a, b, c)) ||
      (Math.abs(o2) < eps && onSegment(a, b, d)) ||
      (Math.abs(o3) < eps && onSegment(c, d, a)) ||
      (Math.abs(o4) < eps && onSegment(c, d, b))
    );
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (touch(points[i]!, points[(i + 1) % n]!, points[j]!, points[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

/**
 * True when a rotation is (within a small tolerance) a multiple of 90°, so the
 * footprint stays axis-aligned in world space and can be cut — and merged with
 * neighbours — as an ordinary AABB rectangle.
 */
function isAxisAlignedRotation(rotation: number): boolean {
  const twist = Math.abs(Math.sin(2 * rotation));
  return twist < 1e-3;
}
