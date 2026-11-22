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
  // or genuinely rotated. Axis-aligned holes that overlap fuse into one hole,
  // their rectangles' union (overlapping holes are illegal for earcut).
  // Rotated holes are cut as individual rotated rectangles matching the
  // stairs' footprint — no over-inflated AABB, so no corner gaps.
  const axisAligned: FloorOpening[] = [];
  const rotated: FloorOpening[] = [];
  const outlined: FloorOpening[] = [];
  for (const o of openings) {
    if (isAxisAlignedRotation(o.rotation)) axisAligned.push(o);
    else (o.outline ? outlined : rotated).push(o);
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

  // Every axis-aligned hole as its stair's own rectangles (a winder's legs,
  // #572), clamped. Holes that overlap or touch are cut as the exact union of
  // those rectangles (#963), the floor the walker and the furniture keep-out
  // see between them kept, not the box around them; a hole alone is cut as
  // before. A union is taken with the L's cut already out of each rectangle,
  // so two stairs round its inner corner both keep their holes.
  const notch = cutoutRect({ width: roomWidth, height: roomDepth, cutout });
  const notchShape: Rect | null = notch ? [notch.x0 - HOLE_INSET, -notch.z1 - HOLE_INSET, notch.x1 + HOLE_INSET, -notch.z0 + HOLE_INSET] : null;
  const pieces = axisAligned.map((o) => openingRects(o).map(([x0, y0, x1, y1]): Rect => [clampX(x0), clampY(y0), clampX(x1), clampY(y1)]).filter(([x0, y0, x1, y1]) => x1 - x0 > 0 && y1 - y0 > 0));
  const unions: Array<Array<[number, number]>> = [];
  let unionFailed = false;
  for (const cluster of touchingClusters(pieces)) {
    if (cluster.length === 1) {
      const o = axisAligned[cluster[0]!]!;
      if (o.outline) {
        pushPolygon(o.outline.map(([x, z]): [number, number] => [x, -z]));
      } else {
        for (const [x0, y0, x1, y1] of pieces[cluster[0]!]!) pushBox(x0, y0, x1, y1);
      }
      continue;
    }
    const rects = cluster.flatMap((index) => pieces[index]!);
    const outlines = rectUnionOutlines(notchShape ? rects.flatMap((rect) => subtractRect(rect, notchShape)) : rects);
    if (outlines) unions.push(...outlines);
    else unionFailed = true;
  }
  if (unionFailed) {
    // Never reached by real stairs: every axis-aligned hole as the old
    // disjoint boxes, which can't overlap one another.
    holes.length = 0;
    unions.length = 0;
    for (const [x0, y0, x1, y1] of mergeHoleRects(pieces.flat())) pushBox(x0, y0, x1, y1);
  }

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

  // Turned outlined holes (a winder's L, #205): cut as given, or as their clamped
  // bounding box when they cross the floor outline, like rotated holes.
  for (const o of outlined) pushPolygon(o.outline!.map(([x, z]): [number, number] => [x, -z]));

  return [...(notch ? holes.flatMap((hole) => clearOfNotch(hole, notch, HOLE_INSET)) : holes), ...unions];
}

type Rect = [number, number, number, number];

/**
 * An axis-aligned opening's rectangles in shape space, [x0, y0, x1, y1]: a
 * winder's legs (`parts`), else its one box. At 90°/270° the footprint's
 * width and depth swap in world space.
 */
function openingRects(o: FloorOpening): Rect[] {
  const swap = Math.abs(Math.sin(o.rotation)) > 0.5;
  return (o.parts ?? [o]).map(({ centerX, centerZ, width, depth }): Rect => {
    const worldW = swap ? depth : width;
    const worldD = swap ? width : depth;
    return [centerX - worldW / 2, -(centerZ + worldD / 2), centerX + worldW / 2, -(centerZ - worldD / 2)];
  });
}

/** Indices of `pieces` grouped by touch (as `mergeHoleRects`: shared edges and corners count). */
function touchingClusters(pieces: ReadonlyArray<readonly Rect[]>): number[][] {
  const touches = (a: readonly Rect[], b: readonly Rect[]) =>
    a.some((p) => b.some((q) => p[0] <= q[2] && q[0] <= p[2] && p[1] <= q[3] && q[1] <= p[3]));
  const cluster = pieces.map((_piece, index) => index);
  const root = (i: number): number => (cluster[i] === i ? i : (cluster[i] = root(cluster[i]!)));
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (touches(pieces[i]!, pieces[j]!)) cluster[root(j)] = root(i);
    }
  }
  const groups = new Map<number, number[]>();
  pieces.forEach((piece, index) => {
    if (piece.length === 0) return;
    const key = root(index);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  return [...groups.values()];
}

/** `rect` less `cut`: up to four rectangles. */
function subtractRect(rect: Rect, cut: Rect): Rect[] {
  const [x0, y0, x1, y1] = rect;
  const [cx0, cy0, cx1, cy1] = cut;
  if (cx0 >= x1 || cx1 <= x0 || cy0 >= y1 || cy1 <= y0) return [rect];
  const out: Rect[] = [];
  if (cy0 > y0) out.push([x0, y0, x1, cy0]);
  if (cy1 < y1) out.push([x0, cy1, x1, y1]);
  const my0 = Math.max(y0, cy0);
  const my1 = Math.min(y1, cy1);
  if (cx0 > x0) out.push([x0, my0, cx0, my1]);
  if (cx1 < x1) out.push([cx1, my0, x1, my1]);
  return out.filter(([a0, b0, a1, b1]) => a1 > a0 && b1 > b0);
}

/** Coordinates this close are one grid line, so float noise leaves no sliver of floor between two holes. */
const UNION_SNAP = 1e-6;
/**
 * Where two holes meet only at a corner, a square this size (m) joins them;
 * where holes ring a pocket of floor, a strip this wide (m) joins it to the
 * rest of the floor. A cell under twice this is taken whole, on its own grid
 * lines, so nothing made here is ever snapped away.
 */
const CORNER_BRIDGE = 0.001;

/**
 * The union of axis-aligned rectangles as simple closed outlines,
 * counter-clockwise from the lowest-then-leftmost corner (as `pushBox`), for
 * cutting stairwells that overlap (#963): exactly the floor the stairs'
 * own rectangles cut, nothing between them. Outlines never touch
 * themselves or each other, as earcut needs: rectangles meeting only at a
 * corner are joined by a millimetre square, and a pocket of floor holes
 * close round on every side stays floor, joined to the rest by a
 * millimetre strip across the hole (a floor shape can't hold an island).
 * Null when that doesn't settle (no case known); the caller then cuts boxes.
 */
export function rectUnionOutlines(rects: ReadonlyArray<readonly [number, number, number, number]>): Array<Array<[number, number]>> | null {
  const fill: Rect[] = rects.filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0).map(([x0, y0, x1, y1]): Rect => [x0, y0, x1, y1]);
  if (fill.length === 0) return [];
  const clear: Rect[] = [];
  // Each round mends one corner or one pocket; real stairs need a few.
  const rounds = 8 * fill.length + 16;
  for (let round = 0; round < rounds; round++) {
    const grid = coverGrid(fill, clear);
    const bridge = cornerBridge(grid);
    if (bridge) {
      fill.push(bridge);
      continue;
    }
    const strip = pocketStrip(grid);
    if (strip) {
      clear.push(strip);
      continue;
    }
    const outlines = traceOutlines(grid);
    return outlines.every((outline) => polygonArea(outline) > 0) ? outlines : null;
  }
  return null;
}

interface CoverGrid {
  xs: number[];
  ys: number[];
  /** covered[i][j]: the cell between xs[i]..xs[i+1] and ys[j]..ys[j+1] is hole. */
  covered: boolean[][];
}

function snappedLines(values: number[]): { lines: number[]; snap: (v: number) => number } {
  const sorted = [...values].sort((a, b) => a - b);
  const lines: number[] = [];
  for (const v of sorted) if (lines.length === 0 || v - lines[lines.length - 1]! > UNION_SNAP) lines.push(v);
  const snap = (v: number) => lines.reduce((best, line) => (Math.abs(line - v) < Math.abs(best - v) ? line : best), lines[0]!);
  return { lines, snap };
}

/** Cells inside a `fill` rectangle and in no `clear` one. */
function coverGrid(fill: readonly Rect[], clear: readonly Rect[]): CoverGrid {
  const all = [...fill, ...clear];
  const { lines: xs, snap: snapX } = snappedLines(all.flatMap(([x0, , x1]) => [x0, x1]));
  const { lines: ys, snap: snapY } = snappedLines(all.flatMap(([, y0, , y1]) => [y0, y1]));
  const snap = (rects: readonly Rect[]) => rects.map(([x0, y0, x1, y1]) => [snapX(x0), snapY(y0), snapX(x1), snapY(y1)] as const);
  const filled = snap(fill);
  const cleared = snap(clear);
  const inAny = (rects: ReadonlyArray<readonly [number, number, number, number]>, cx: number, cy: number) =>
    rects.some(([x0, y0, x1, y1]) => cx > x0 && cx < x1 && cy > y0 && cy < y1);
  const covered = Array.from({ length: xs.length - 1 }, (_c, i) =>
    Array.from({ length: ys.length - 1 }, (_r, j) => {
      const cx = (xs[i]! + xs[i + 1]!) / 2;
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      return inAny(filled, cx, cy) && !inAny(cleared, cx, cy);
    })
  );
  return { xs, ys, covered };
}

/** A cell's span along one axis from line `k`: whole when narrow, else CORNER_BRIDGE from the `from` end. */
function bridgeSpan(lines: readonly number[], k: number, fromHigh: boolean): [number, number] {
  const lo = lines[k]!;
  const hi = lines[k + 1]!;
  if (hi - lo < 2 * CORNER_BRIDGE) return [lo, hi];
  return fromHigh ? [hi - CORNER_BRIDGE, hi] : [lo, lo + CORNER_BRIDGE];
}

/** A square joining two cells that meet only at a corner, or null when none do. */
function cornerBridge({ xs, ys, covered }: CoverGrid): Rect | null {
  const at = (i: number, j: number) => covered[i]?.[j] ?? false;
  for (let i = 1; i < xs.length - 1; i++) {
    for (let j = 1; j < ys.length - 1; j++) {
      const sw = at(i - 1, j - 1);
      const se = at(i, j - 1);
      const nw = at(i - 1, j);
      const ne = at(i, j);
      if (sw !== ne || se !== nw || sw === se) continue;
      // Fill the corner of the empty cell east of the vertex: south-east when
      // SW and NE are hole, north-east when NW and SE are.
      const [bx0, bx1] = bridgeSpan(xs, i, false);
      const [by0, by1] = sw ? bridgeSpan(ys, j - 1, true) : bridgeSpan(ys, j, false);
      return [bx0, by0, bx1, by1];
    }
  }
  return null;
}

/**
 * A strip of floor across the hole from a pocket that holes close round to
 * the floor west of them, or null when there is no pocket: along the foot
 * of the pocket's westernmost (then lowest) cell, west until floor.
 */
function pocketStrip({ xs, ys, covered }: CoverGrid): Rect | null {
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const outside = covered.map((column) => column.map(() => false));
  const queue: Array<[number, number]> = [];
  const visit = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny || covered[i]![j] || outside[i]![j]) return;
    outside[i]![j] = true;
    queue.push([i, j]);
  };
  for (let i = 0; i < nx; i++) {
    visit(i, 0);
    visit(i, ny - 1);
  }
  for (let j = 0; j < ny; j++) {
    visit(0, j);
    visit(nx - 1, j);
  }
  while (queue.length > 0) {
    const [i, j] = queue.pop()!;
    visit(i + 1, j);
    visit(i - 1, j);
    visit(i, j + 1);
    visit(i, j - 1);
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (covered[i]![j] || outside[i]![j]) continue;
      // Westernmost pocket cell: the cells west of it are hole up to the next floor.
      let k = i - 1;
      while (k >= 0 && covered[k]![j]) k--;
      const [y0, y1] = bridgeSpan(ys, j, false);
      return [xs[k + 1]!, y0, xs[i]!, y1];
    }
  }
  return null;
}

function traceOutlines({ xs, ys, covered }: CoverGrid): Array<Array<[number, number]>> {
  const at = (i: number, j: number) => covered[i]?.[j] ?? false;
  // Boundary edges between grid vertices, the hole on their left (counter-clockwise).
  const next = new Map<number, number>();
  const stride = ys.length;
  const key = (i: number, j: number) => i * stride + j;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!covered[i]![j]) continue;
      if (!at(i, j - 1)) next.set(key(i, j), key(i + 1, j));
      if (!at(i + 1, j)) next.set(key(i + 1, j), key(i + 1, j + 1));
      if (!at(i, j + 1)) next.set(key(i + 1, j + 1), key(i, j + 1));
      if (!at(i - 1, j)) next.set(key(i, j + 1), key(i, j));
    }
  }
  const outlines: Array<Array<[number, number]>> = [];
  // Lowest row first, then leftmost: each loop starts at its lowest-left corner.
  const starts = [...next.keys()].sort((a, b) => a % stride - (b % stride) || a - b);
  for (const start of starts) {
    if (!next.has(start)) continue;
    const loop: Array<[number, number]> = [];
    let at = start;
    do {
      loop.push([xs[Math.floor(at / stride)]!, ys[at % stride]!]);
      const to = next.get(at)!;
      next.delete(at);
      at = to;
    } while (at !== start && next.has(at));
    // Keep the corners only.
    const corners = loop.filter((p, index) => {
      const prev = loop[(index + loop.length - 1) % loop.length]!;
      const after = loop[(index + 1) % loop.length]!;
      return (p[0] - prev[0]) * (after[1] - prev[1]) - (p[1] - prev[1]) * (after[0] - prev[0]) !== 0;
    });
    if (corners.length >= 4) outlines.push(corners);
  }
  return outlines;
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
