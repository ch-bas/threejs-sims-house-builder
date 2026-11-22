import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { layoutToDxf } from './plan-export/dxf';
import { stairwellOutlines } from './plan-export/plan-geometry';
import { layoutToSvg } from './plan-export/svg';
import { STAIRWELL_RAIL_INSET, planRailInset, stairwellRailSegments, type RailSegment } from './stairwell-rail';
import { advanceWalker, buildWalkerColliders, stairwellRailColliders, type WalkerState } from './walk-collision';
import { buildWalkWorld } from './walk-world';
import type { FurnitureItem, InteriorWall, RoomLayout } from './types';

const stair = (overrides: Partial<FurnitureItem> = {}) =>
  makeItem({ id: 's', type: 'stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 0, z: 0 }, rotation: 0, ...overrides });
const winder = (overrides: Partial<FurnitureItem> = {}) =>
  stair({ id: 'w', width: 2, depth: 2.6, stairsShape: 'winder', ...overrides });

const twoStoreys = (items: FurnitureItem[], extra: Partial<RoomLayout> = {}, interiorWalls: InteriorWall[] = []) =>
  makeLayout({ width: 8, height: 8, floors: [makeFloor({ items }), makeFloor({ id: 'f1', interiorWalls })], ...extra });

const length = (s: RailSegment) => Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
/** Whether a segment runs along z = `z` (within `tol`) for its whole length. */
const alongZ = (s: RailSegment, z: number, tol = 0.05) => Math.abs(s.z1 - z) < tol && Math.abs(s.z2 - z) < tol;
const alongX = (s: RailSegment, x: number, tol = 0.05) => Math.abs(s.x1 - x) < tol && Math.abs(s.x2 - x) < tol;
const total = (segments: RailSegment[]) => segments.reduce((sum, s) => sum + length(s), 0);

function insidePolygon(x: number, z: number, polygon: ReadonlyArray<{ x: number; z: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

describe('stairwellRailSegments (#923)', () => {
  it('has no rail on the ground floor, nor over a storey with no stairs below', () => {
    const layout = twoStoreys([stair()]);
    expect(stairwellRailSegments(layout, 0)).toEqual([]);
    expect(stairwellRailSegments(twoStoreys([]), 1)).toEqual([]);
    expect(stairwellRailSegments(layout, 5)).toEqual([]);
  });

  it('guards three sides of a straight flight’s hole and leaves the arrival open', () => {
    const segments = stairwellRailSegments(twoStoreys([stair()]), 1);
    expect(segments).toHaveLength(3);
    // The flight climbs toward +z: its head, at z = 1.25, is open.
    const head = 2.4 / 2 + 0.05;
    expect(segments.some((s) => alongZ(s, head - STAIRWELL_RAIL_INSET))).toBe(false);
    // Both long sides, inset into the hole's margin.
    expect(segments.filter((s) => alongX(s, 0.65 - STAIRWELL_RAIL_INSET, 1e-6))).toHaveLength(1);
    expect(segments.filter((s) => alongX(s, -0.65 + STAIRWELL_RAIL_INSET, 1e-6))).toHaveLength(1);
  });

  it('stands the rail inside the hole it guards', () => {
    const layout = twoStoreys([stair({ rotation: 0.4 }), winder({ position: { x: -2, z: 2 } })]);
    const holes = stairwellOutlines(layout, 1);
    for (const s of stairwellRailSegments(layout, 1)) {
      const mid = { x: (s.x1 + s.x2) / 2, z: (s.z1 + s.z2) / 2 };
      expect(holes.some((hole) => insidePolygon(mid.x, mid.z, hole))).toBe(true);
    }
  });

  it('follows a winder’s L and leaves the return flight’s head open', () => {
    const segments = stairwellRailSegments(twoStoreys([winder()]), 1);
    // The return flight climbs toward −z on the +x half: its head is at z = −1.35.
    expect(segments.some((s) => alongZ(s, -1.35 + STAIRWELL_RAIL_INSET) && Math.max(s.x1, s.x2) > 0.1)).toBe(false);
    // The L's inner edge, between the hole and the floor over the up flight's foot.
    expect(segments.some((s) => alongX(s, STAIRWELL_RAIL_INSET, 1e-6) && length(s) > 1.5)).toBe(true);
    expect(segments.some((s) => alongZ(s, 0.25 + STAIRWELL_RAIL_INSET, 1e-6))).toBe(true);
  });

  it('turns and mirrors with the winder', () => {
    const plain = stairwellRailSegments(twoStoreys([winder()]), 1);
    const turned = stairwellRailSegments(twoStoreys([winder({ rotation: Math.PI / 2, mirrored: true })]), 1);
    expect(turned).toHaveLength(plain.length);
    expect(total(turned)).toBeCloseTo(total(plain), 6);
  });

  it('runs one rail round stairs whose holes overlap, open in front of each arrival', () => {
    const layout = twoStoreys([stair({ id: 'a' }), stair({ id: 'b', position: { x: 0.5, z: 0.5 } })]);
    expect(stairwellOutlines(layout, 1)).toHaveLength(1);
    const segments = stairwellRailSegments(layout, 1);
    // b's head is the hole's edge at z = 1.75 (x −0.15…1.15); a's, at z = 1.25, is open
    // where it is the hole's edge (x −0.65…−0.15), and so is the side of b's hole in
    // front of it, up to b's head: the way off a.
    expect(segments.some((s) => alongZ(s, 1.75 - STAIRWELL_RAIL_INSET, 1e-6))).toBe(false);
    expect(segments.some((s) => alongZ(s, 1.25 - STAIRWELL_RAIL_INSET, 1e-6))).toBe(false);
    expect(segments.some((s) => alongX(s, -0.15 + STAIRWELL_RAIL_INSET, 1e-6))).toBe(false);
    // Both outer sides, and the foot of the hole with its step where b's starts later (#963).
    expect(segments).toHaveLength(5);
    expect(segments.filter((s) => alongZ(s, -0.0643 + STAIRWELL_RAIL_INSET, 1e-3))).toHaveLength(1);
  });

  it('never runs across the way off a flight whose head is inside a merged hole', () => {
    // b's head (z = 0.75) is inside the box merged with a; the box's edge in front of it is open.
    const layout = twoStoreys([stair({ id: 'a' }), stair({ id: 'b', position: { x: 1.2, z: -0.5 } })]);
    expect(stairwellOutlines(layout, 1)).toHaveLength(1);
    const across = stairwellRailSegments(layout, 1).filter((s) => alongZ(s, 1.25 - STAIRWELL_RAIL_INSET, 1e-6));
    expect(across.every((s) => Math.max(s.x1, s.x2) <= 0.6 + 1e-6 || Math.min(s.x1, s.x2) >= 1.8 - 1e-6)).toBe(true);
  });

  it('keeps the way off a narrow flight a walker wide', () => {
    const segments = stairwellRailSegments(twoStoreys([stair({ width: 0.5 })]), 1);
    // The side runs stop a walker's radius short of the head (z = 1.25).
    for (const s of segments.filter((run) => Math.abs(run.x1 - run.x2) < 1e-6)) {
      expect(Math.max(s.z1, s.z2)).toBeLessThanOrEqual(1.25 - 0.3 + 1e-6);
    }
    // A wide flight's side runs go all the way.
    const wide = stairwellRailSegments(twoStoreys([stair()]), 1).filter((run) => Math.abs(run.x1 - run.x2) < 1e-6);
    expect(Math.max(...wide.map((s) => Math.max(s.z1, s.z2)))).toBeGreaterThan(1.2);
  });

  it('keeps a rail out of a rotated neighbour’s hole', () => {
    const layout = twoStoreys([stair({ id: 'a', rotation: 0.3 }), stair({ id: 'b', rotation: 0.3, position: { x: 0.6, z: 0.2 } })]);
    const holes = stairwellOutlines(layout, 1);
    expect(holes).toHaveLength(2);
    for (const s of stairwellRailSegments(layout, 1)) {
      const mid = { x: (s.x1 + s.x2) / 2, z: (s.z1 + s.z2) / 2 };
      expect(holes.filter((hole) => insidePolygon(mid.x, mid.z, hole))).toHaveLength(1);
    }
  });

  it('leaves the edge along an outer wall to the wall', () => {
    // Flush with the east wall: the hole stops just inside it.
    const segments = stairwellRailSegments(twoStoreys([stair({ position: { x: 4 - 0.6, z: 0 } })]), 1);
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => Math.max(s.x1, s.x2) < 4)).toBe(true);
    expect(segments.some((s) => alongX(s, 4, 0.1))).toBe(false);
  });

  it('leaves the edge along the L’s cut to the cut’s wall', () => {
    // The north-east notch spans x 1…4, z −4…−1; the stair sits flush with its west wall.
    const cutout = { corner: 'ne' as const, width: 3, depth: 3 };
    const segments = stairwellRailSegments(twoStoreys([stair({ position: { x: 0.4, z: -2.5 } })], { cutout }), 1);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.some((s) => alongX(s, 1, 0.1))).toBe(false);
    expect(segments.every((s) => Math.max(s.x1, s.x2) < 1)).toBe(true);
  });

  it('leaves an edge along a partition upstairs to the partition', () => {
    const wall: InteriorWall = { id: 'p', x1: -0.73, z1: -3, x2: -0.73, z2: 3 };
    const without = stairwellRailSegments(twoStoreys([stair()]), 1);
    const withWall = stairwellRailSegments(twoStoreys([stair()], {}, [wall]), 1);
    expect(without.some((s) => alongX(s, -0.65 + STAIRWELL_RAIL_INSET, 1e-6))).toBe(true);
    expect(withWall.some((s) => alongX(s, -0.65 + STAIRWELL_RAIL_INSET, 1e-6))).toBe(false);
    expect(withWall).toHaveLength(2);
  });

  it('rails the doorway in a partition along the hole, and the edge along a hidden outer wall', () => {
    const wall: InteriorWall = { id: 'p', x1: -0.73, z1: -3, x2: -0.73, z2: 3 };
    const door = makeItem({ id: 'd', type: 'door', width: 0.9, depth: 0.1, height: 2.1, position: { x: -0.73, z: 0 }, rotation: Math.PI / 2 });
    const layout = twoStoreys([stair()], {}, [wall]);
    const withDoor = { ...layout, floors: [layout.floors[0]!, { ...layout.floors[1]!, items: [door] }] };
    const west = stairwellRailSegments(withDoor, 1).filter((s) => alongX(s, -0.65 + STAIRWELL_RAIL_INSET, 1e-6));
    expect(west).toHaveLength(1);
    expect(Math.abs(west[0]!.z2 - west[0]!.z1)).toBeCloseTo(0.9, 6);

    const flush = twoStoreys([stair({ position: { x: 4 - 0.6, z: 0 } })]);
    expect(stairwellRailSegments(flush, 1)).toHaveLength(2);
    const hidden = { ...flush, floors: [flush.floors[0]!, { ...flush.floors[1]!, hiddenWalls: ['east' as const] }] };
    expect(stairwellRailSegments(hidden, 1)).toHaveLength(3);
  });

  it('gives a plan a few pixels between the rail and the outline, within bounds', () => {
    expect(planRailInset(50)).toBeCloseTo(0.1, 9);
    expect(planRailInset(1000)).toBe(STAIRWELL_RAIL_INSET);
    expect(planRailInset(10)).toBe(0.12);
    expect(planRailInset(0)).toBe(STAIRWELL_RAIL_INSET);
  });

  it('sets the rail further in for the plan when asked', () => {
    const layout = twoStoreys([stair()]);
    const plan = stairwellRailSegments(layout, 1, 0.1);
    expect(plan).toHaveLength(3);
    expect(plan.some((s) => alongX(s, 0.65 - 0.1, 1e-6))).toBe(true);
  });

  it('is quick on a floor with many stairs', () => {
    const items = Array.from({ length: 30 }, (_unused, i) => stair({ id: `s${i}`, position: { x: -3 + (i % 6), z: -3 + Math.floor(i / 6) * 1.2 }, rotation: i * 0.2 }));
    const layout = twoStoreys(items, { width: 20, height: 20 });
    const started = performance.now();
    stairwellRailSegments(layout, 1);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('the stairwell rail stops the walker (#923)', () => {
  const R = 0.3;
  const building = (items: FurnitureItem[]) => ({ width: 8, depth: 8, floors: [{ items }, { items: [] }] });
  const walk = (b: ReturnType<typeof building>, w: WalkerState, dx: number, dz: number) => {
    const world = buildWalkWorld(b);
    const byStorey = buildWalkerColliders(b);
    const len = Math.hypot(dx, dz);
    for (let i = 0; i < Math.ceil(len / 0.05); i++) advanceWalker(world, byStorey[w.floorIndex]!, w, (dx / len) * 0.05, (dz / len) * 0.05, R);
    return w;
  };

  it('gives each run a box from the floor to the handrail, upstairs only', () => {
    const b = building([stair()]);
    expect(stairwellRailColliders(b, 0)).toEqual([]);
    const boxes = stairwellRailColliders(b, 1);
    expect(boxes).toHaveLength(3);
    expect(boxes.every((box) => box.bottom === 3 && box.top === 3.9 && !box.wall)).toBe(true);
  });

  it('still lets the walker climb the flight and step off at its head, and come back down', () => {
    const b = building([stair()]);
    const w = walk(b, { x: 0, z: -1.5, y: 0, kind: 'floor', floorIndex: 0 }, 0, 4);
    expect(w.floorIndex).toBe(1);
    walk(b, w, 0, -4.5);
    expect(w.floorIndex).toBe(0);
    expect(w.y).toBe(0);
  });

  it('climbs and descends a flight whose head is inside a hole merged with its neighbour’s', () => {
    const b = building([stair({ id: 'a' }), stair({ id: 'b', position: { x: 1.2, z: -0.5 } })]);
    const up = walk(b, { x: 1.2, z: -2, y: 0, kind: 'floor', floorIndex: 0 }, 0, 4);
    expect(up.floorIndex).toBe(1);
    expect(up.z).toBeGreaterThan(1.5);
    const down = walk(b, { x: 1.2, z: 3, y: 3, kind: 'floor', floorIndex: 1 }, 0, -5);
    expect(down.floorIndex).toBe(0);
    expect(down.y).toBe(0);
  });

  it('descends a 0.5 m flight from upstairs', () => {
    const b = building([stair({ width: 0.5 })]);
    const down = walk(b, { x: 0, z: 3, y: 3, kind: 'floor', floorIndex: 1 }, 0, -5);
    expect(down.floorIndex).toBe(0);
    expect(down.y).toBe(0);
  });

  it('can’t sidestep off the top treads through the rail, at any pace', () => {
    const b = building([stair()]);
    const world = buildWalkWorld(b);
    const byStorey = buildWalkerColliders(b);
    for (const z of [1.15, 0.95, 0.8]) {
      for (const frame of [0.05, 0.1, 0.12, 0.15, 0.2]) {
        const w: WalkerState = { x: 0, z: -1.5, y: 0, kind: 'floor', floorIndex: 0 };
        for (let i = 0; i < 200 && w.z < z; i++) advanceWalker(world, byStorey[w.floorIndex]!, w, 0, Math.min(0.05, z - w.z), R);
        for (let i = 0; i < 11; i++) advanceWalker(world, byStorey[w.floorIndex]!, w, 0.05, 0, R);
        for (let i = 0; i < 5; i++) advanceWalker(world, byStorey[w.floorIndex]!, w, frame, 0, R);
        expect(w.x).toBeLessThan(0.625);
        expect(w.floorIndex).toBe(0);
      }
    }
  });

  it('upstairs, the walker stops at the rail beside the hole', () => {
    const b = building([stair()]);
    const w = walk(b, { x: 2, z: 0, y: 3, kind: 'floor', floorIndex: 1 }, -2, 0);
    expect(w.floorIndex).toBe(1);
    expect(w.x).toBeCloseTo(0.625 + 0.03 + R, 2);
  });
});

describe('the stairwell rail in the exports (#923)', () => {
  const layout = twoStoreys([stair()]);
  const runs = stairwellRailSegments(layout, 1).length;

  it('draws one SVG line per run upstairs, none downstairs', () => {
    expect(layoutToSvg(layout, layout.floors[1]!).match(/class="stairwell-rail"/g)).toHaveLength(runs);
    expect(layoutToSvg(layout, layout.floors[0]!)).not.toContain('stairwell-rail');
  });

  it('draws one DXF line per run on the STAIRWELL layer', () => {
    const lines = (dxf: string) => {
      const rows = dxf.split(/\r?\n/).map((row) => row.trim());
      let type = '';
      let count = 0;
      for (let i = 0; i + 1 < rows.length; i += 2) {
        if (rows[i] === '0') type = rows[i + 1]!;
        if (rows[i] === '8' && rows[i + 1] === 'STAIRWELL' && type === 'LINE') count++;
      }
      return count;
    };
    expect(lines(layoutToDxf(layout, layout.floors[1]!))).toBe(runs);
    expect(lines(layoutToDxf(layout, layout.floors[0]!))).toBe(0);
  });
});
