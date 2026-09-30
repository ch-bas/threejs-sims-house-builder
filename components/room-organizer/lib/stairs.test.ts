import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem } from './__testfixtures__/fixtures';
import {
  MAX_STAIRS_LEAD_IN,
  MIN_WINDER_TREAD,
  STAIR_HEADROOM,
  STAIR_STEP_COUNT,
  WINDER_TREADS,
  computeFloorOpenings,
  floorOpeningOutline,
  isStairsLeadIn,
  isStairsShape,
  stairPlanSymbol,
  stairSteps,
  stairToWorld,
  stairTreadLines,
  stairwellRect,
  winderFlights,
  winderLayout,
  winderStairwellOutline,
} from './stairs';

type Outline = Array<[number, number]>;

const straight = { width: 1.2, depth: 2.4 };
const winder = { width: 2, depth: 2.6, stairsShape: 'winder' as const };

const area = (outline: Outline) =>
  Math.abs(outline.reduce((sum, [x, z], i) => {
    const [nx, nz] = outline[(i + 1) % outline.length]!;
    return sum + x * nz - nx * z;
  }, 0)) / 2;

const EPS = 1e-9;

const withinBox = (outline: Outline, hw: number, hd: number, slack = 0) =>
  outline.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)
    && Math.abs(x) <= hw + slack + EPS && Math.abs(z) <= hd + slack + EPS);

const cross = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;

/** Proper crossing of two segments (shared endpoints and touching don't count). */
const segmentsCross = (p: [number, number], q: [number, number], r: [number, number], s: [number, number]) => {
  const d1 = cross(q[0] - p[0], q[1] - p[1], r[0] - p[0], r[1] - p[1]);
  const d2 = cross(q[0] - p[0], q[1] - p[1], s[0] - p[0], s[1] - p[1]);
  const d3 = cross(s[0] - r[0], s[1] - r[1], p[0] - r[0], p[1] - r[1]);
  const d4 = cross(s[0] - r[0], s[1] - r[1], q[0] - r[0], q[1] - r[1]);
  return d1 * d2 < -EPS && d3 * d4 < -EPS;
};

/** No two non-adjacent edges cross: the outline is a simple polygon. */
const isSimple = (outline: Outline) => {
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(outline[i]!, outline[(i + 1) % n]!, outline[j]!, outline[(j + 1) % n]!)) return false;
    }
  }
  return true;
};

const distanceToSegment = ([px, pz]: [number, number], [ax, az]: [number, number], [bx, bz]: [number, number]) => {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
};

/** Ray-cast point-in-polygon, counting a point on the boundary as inside. */
const containsPoint = (polygon: Outline, point: [number, number]) => {
  const n = polygon.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    if (distanceToSegment(point, polygon[i]!, polygon[j]!) <= EPS) return true;
    if (zi > point[1] !== zj > point[1] && point[0] < ((xj - xi) * (point[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

/** Every invariant a stair layout must keep whatever its dims (#278). */
const expectValidLayout = (item: { width: number; depth: number; stairsShape?: 'winder'; stairsLeadIn?: number }, rise: number) => {
  const hw = item.width / 2;
  const hd = item.depth / 2;
  const steps = stairSteps(item, rise);
  expect(steps).toHaveLength(STAIR_STEP_COUNT);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    expect(Number.isFinite(step.top)).toBe(true);
    if (i > 0) expect(step.top).toBeGreaterThan(steps[i - 1]!.top);
    expect(area(step.outline)).toBeGreaterThan(0);
    expect(withinBox(step.outline, hw, hd)).toBe(true);
  }
  const layout = winderLayout(item);
  const outline = winderStairwellOutline(item, rise);
  const hole = stairwellRect(item, rise);
  if (!layout) {
    // Straight fallback: the treads are the straight flight's and the hole is its plain rectangle.
    expect(outline).toBeNull();
    expect(steps).toEqual(stairSteps({ width: item.width, depth: item.depth }, rise));
    return;
  }
  expect(layout.going).toBeGreaterThanOrEqual(MIN_WINDER_TREAD - EPS);
  expect(layout.fan).toBeGreaterThanOrEqual(Math.min(MIN_WINDER_TREAD, hw) - EPS);
  expect(layout.fan).toBeLessThanOrEqual(hw + EPS);
  expect(outline).not.toBeNull();
  expect(hole).not.toBeNull();
  expect(isSimple(outline!)).toBe(true);
  expect(area(outline!)).toBeGreaterThan(0);
  expect(withinBox(outline!, hw, hd, 0.05)).toBe(true);
  // The hole and the treads agree: every tread that needs headroom sits under the hole,
  // and the rectangle around those treads never reaches outside the outline.
  for (const step of steps) {
    if (step.top > rise - STAIR_HEADROOM) step.outline.forEach((p) => expect(containsPoint(outline!, p)).toBe(true));
  }
  const xs = outline!.map(([x]) => x);
  const zs = outline!.map(([, z]) => z);
  expect(hole!.centerX - hole!.width / 2).toBeGreaterThanOrEqual(Math.min(...xs) - EPS);
  expect(hole!.centerX + hole!.width / 2).toBeLessThanOrEqual(Math.max(...xs) + EPS);
  expect(hole!.centerZ - hole!.depth / 2).toBeGreaterThanOrEqual(Math.min(...zs) - EPS);
  expect(hole!.centerZ + hole!.depth / 2).toBeLessThanOrEqual(Math.max(...zs) + EPS);
  // The fan ends where the up flight does, and its winders tile the fan exactly.
  const { up, fan, fanZ } = layout;
  expect(Math.max(...steps[up - 1]!.outline.map(([, z]) => z))).toBeCloseTo(fanZ);
  const winders = steps.slice(up, up + WINDER_TREADS);
  expect(winders.reduce((sum, s) => sum + area(s.outline), 0)).toBeCloseTo(item.width * fan);
  expect(winders.every((s) => s.outline.every(([, z]) => z >= fanZ - EPS && z <= hd + EPS))).toBe(true);
};

describe('stair layout (#205)', () => {
  it('lays a straight flight out as equal treads climbing to the rise', () => {
    const steps = stairSteps(straight, 3);
    expect(steps).toHaveLength(STAIR_STEP_COUNT);
    expect(steps[STAIR_STEP_COUNT - 1]!.top).toBeCloseTo(3);
    expect(steps[0]!.outline[0]).toEqual([-0.6, -1.2]);
  });

  it('splits a winder into up flight, a 180° fan and a return flight', () => {
    expect(winderFlights()).toEqual({ up: 4, back: 4 });
    expect(winderFlights(2)).toEqual({ up: 6, back: 2 });
    expect(winderFlights(99)).toEqual({ up: 7, back: 1 });
    const steps = stairSteps(winder, 3);
    expect(steps).toHaveLength(STAIR_STEP_COUNT);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.top).toBeGreaterThan(steps[i - 1]!.top);
    // Up flight on the −x half, return flight on the +x half.
    expect(steps.slice(0, 4).every((s) => s.outline.every(([x]) => x <= 0))).toBe(true);
    expect(steps.slice(-4).every((s) => s.outline.every(([x]) => x >= 0))).toBe(true);
    // The winders tile the fan (full width × half-width) exactly.
    const fan = steps.slice(4, 4 + WINDER_TREADS);
    expect(fan.reduce((sum, s) => sum + area(s.outline), 0)).toBeCloseTo(2 * 1);
    expect(fan.every((s) => s.outline.every(([, z]) => z >= 0.3 - 1e-9 && z <= 1.3 + 1e-9))).toBe(true);
  });

  it('runs the lead-in onto the up flight at the same going', () => {
    const steps = stairSteps({ ...winder, stairsLeadIn: 2 }, 3);
    const up = steps.slice(0, 6);
    const back = steps.slice(-2);
    const going = (s: (typeof steps)[number]) => Math.max(...s.outline.map(([, z]) => z)) - Math.min(...s.outline.map(([, z]) => z));
    expect(going(up[0]!)).toBeCloseTo(going(back[0]!));
    expect(Math.min(...back.flatMap((s) => s.outline.map(([, z]) => z)))).toBeGreaterThan(-1.3);
  });
});

describe('headroom stairwell (#205)', () => {
  it('cuts only above the treads within 2 m of the floor above, not the whole flight', () => {
    const rect = stairwellRect(straight, 3)!;
    // Treads whose top is above 3 − 2 = 1 m: from the 5th (15/14 m) up.
    const going = 2.4 / STAIR_STEP_COUNT;
    expect(rect.depth).toBeCloseTo(2.4 - 4 * going + 0.1);
    expect(rect.centerZ + rect.depth / 2).toBeCloseTo(1.2 + 0.05);
    expect(rect.width).toBeCloseTo(1.3);
    expect(rect.depth).toBeLessThan(2.4 + 0.1);
    // Every tread under the kept floor still clears the headroom.
    const keptEdge = rect.centerZ - rect.depth / 2;
    for (const step of stairSteps(straight, 3)) {
      if (Math.max(...step.outline.map(([, z]) => z)) <= keptEdge) expect(3 - step.top).toBeGreaterThanOrEqual(STAIR_HEADROOM);
    }
  });

  it('opens a winder as an L over its turn and return flight, keeping floor over the up flight', () => {
    const outline = winderStairwellOutline(winder, 3)!;
    // Fan + full return flight: from the newel line on the up side, to the return foot on +x.
    const expected = [
      [-1.05, 0.25],
      [0, 0.25],
      [0, -1.35],
      [1.05, -1.35],
      [1.05, 1.35],
      [-1.05, 1.35],
    ];
    expect(outline).toHaveLength(expected.length);
    outline.forEach(([x, z], i) => {
      expect(x).toBeCloseTo(expected[i]![0]!);
      expect(z).toBeCloseTo(expected[i]![1]!);
    });
    // A short storey needs part of the up flight too; a tall one only part of the return.
    expect(winderStairwellOutline(winder, 2.4)![0]![1]).toBeLessThan(0.25);
    const tall = winderStairwellOutline(winder, 7)!;
    expect(tall).toHaveLength(4);
    expect(Math.min(...tall.map(([x]) => x))).toBeCloseTo(-0.05);
    expect(winderStairwellOutline({ width: 1.2, depth: 2.4 }, 3)).toBeNull();
  });

  it('validates shapes and lead-ins', () => {
    expect(isStairsShape('winder')).toBe(true);
    expect(isStairsShape('spiral')).toBe(false);
    expect(isStairsLeadIn(0)).toBe(true);
    expect(isStairsLeadIn(MAX_STAIRS_LEAD_IN)).toBe(true);
    expect(isStairsLeadIn(MAX_STAIRS_LEAD_IN + 1)).toBe(false);
    expect(isStairsLeadIn(1.5)).toBe(false);
  });
});

describe('shallow winders (#278)', () => {
  const shallow = (depth: number, stairsLeadIn?: number) => ({ ...winder, depth, stairsLeadIn });

  it('keeps the catalogue winder exactly as before: a full half-width fan', () => {
    expect(winderLayout(winder)).toEqual({ up: 4, back: 4, fan: 1, fanZ: 1.3 - 1, going: (1.3 - 1 + 1.3) / 4 });
    expect(winderLayout(shallow(1.6))).toMatchObject({ fan: 1 });
    expect(winderLayout(straight)).toBeNull();
    expectValidLayout(winder, 3);
    expectValidLayout({ ...winder, stairsLeadIn: MAX_STAIRS_LEAD_IN }, 3);
  });

  it('clamps the fan to what the depth leaves once the flights get short', () => {
    // 2.0 × 1.0: depth = width/2 used to give zero-area flight treads.
    const half = winderLayout(shallow(1))!;
    expect(half.fan).toBeCloseTo(1 - 4 * MIN_WINDER_TREAD);
    expect(half.going).toBeCloseTo(MIN_WINDER_TREAD);
    expectValidLayout(shallow(1), 3);
    // 2.0 × 0.8: depth < width/2 used to lay the treads out backwards.
    const under = winderLayout(shallow(0.8))!;
    expect(under.fan).toBeCloseTo(0.8 - 4 * MIN_WINDER_TREAD);
    expect(under.fan).toBeGreaterThanOrEqual(MIN_WINDER_TREAD);
    expectValidLayout(shallow(0.8), 3);
    // Just above the old threshold the fan is already clamped, so nothing jumps there.
    expect(winderLayout(shallow(1.01))!.fan).toBeCloseTo(1.01 - 4 * MIN_WINDER_TREAD);
    expectValidLayout(shallow(1.01), 3);
    expectValidLayout(shallow(1.6 - 0.01), 3);
    expectValidLayout(shallow(1.6 + 0.01), 3);
  });

  it('lays out straight, hole included, when not even the shortest fan fits', () => {
    // Below (up + 1) treads of depth: 0.75 m at the default lead-in, about 1.2 m at the longest.
    expect(winderLayout(shallow(0.75))).not.toBeNull();
    expect(winderLayout(shallow(0.74))).toBeNull();
    expect(winderLayout(shallow(1.21, MAX_STAIRS_LEAD_IN))).not.toBeNull();
    expect(winderLayout(shallow(1.19, MAX_STAIRS_LEAD_IN))).toBeNull();
    for (const depth of [0.74, 0.5, 0.1]) {
      expectValidLayout(shallow(depth), 3);
      expect(winderStairwellOutline(shallow(depth), 3)).toBeNull();
      expect(stairwellRect(shallow(depth), 3)).toEqual(stairwellRect({ width: 2, depth }, 3));
    }
    expectValidLayout(shallow(1, MAX_STAIRS_LEAD_IN), 3);
  });

  it('stays valid across every size the schema accepts', () => {
    for (const width of [0.1, 0.5, 1, 2, 4, 50]) {
      for (const depth of [0.1, 0.3, 0.75, 1, 1.3, 2.6, 5, 50]) {
        for (const stairsLeadIn of [undefined, 2, MAX_STAIRS_LEAD_IN]) {
          for (const rise of [2.4, 3, 7]) expectValidLayout({ width, depth, stairsShape: 'winder', stairsLeadIn }, rise);
        }
      }
    }
  });
});

describe('stairwell openings and plan symbol (#290)', () => {
  const placedWinder = { ...makeItem({ id: 'w', type: 'stairs', ...winder, height: 3 }), position: { x: 1, z: 2 } };
  const placedStraight = { ...makeItem({ id: 's', type: 'stairs', ...straight, height: 3 }), position: { x: -2, z: 0 } };

  it('maps the stair frame to the world like the mesh: rotated, and mirrored across local x first', () => {
    expect(stairToWorld({ rotation: 0 }, { x: 1, z: 2 })(0.5, -1)).toEqual([1.5, 1]);
    // Three's rotateY(π/2) takes local +x to world −z and local +z to world +x.
    const [x, z] = stairToWorld({ rotation: Math.PI / 2 }, { x: 0, z: 0 })(1, 0);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1);
    expect(stairToWorld({ rotation: 0, mirrored: true }, { x: 1, z: 2 })(0.5, -1)).toEqual([0.5, 1]);
  });

  it('computes the openings a floor cuts from the stairs below it, in the stair’s own frame', () => {
    expect(computeFloorOpenings(undefined)).toEqual([]);
    expect(computeFloorOpenings(makeFloor({ items: [makeItem({ id: 'c' })] }))).toEqual([]);
    const [plain] = computeFloorOpenings(makeFloor({ items: [placedWinder] }));
    const [turned] = computeFloorOpenings(makeFloor({ items: [{ ...placedWinder, rotation: Math.PI }] }));
    const [mirrored] = computeFloorOpenings(makeFloor({ items: [{ ...placedWinder, mirrored: true }] }));
    expect(plain!.id).toBe('w');
    expect(plain!.outline).toHaveLength(6);
    const lowestZOnSide = (o: typeof plain, side: (x: number) => boolean) =>
      Math.min(...o!.outline!.filter(([x]) => side(x)).map(([, z]) => z));
    // The return flight (+x of the stair at x = 1) is open to its foot; a mirror swaps the sides.
    expect(lowestZOnSide(plain, (x) => x > 1.01)).toBeLessThan(lowestZOnSide(plain, (x) => x < 0.99));
    expect(lowestZOnSide(mirrored, (x) => x < 0.99)).toBeLessThan(lowestZOnSide(mirrored, (x) => x > 1.01));
    turned!.outline!.forEach(([x, z], i) => {
      expect(x).toBeCloseTo(2 - plain!.outline![i]![0]);
      expect(z).toBeCloseTo(4 - plain!.outline![i]![1]);
    });
    // A straight flight: a rotated rectangle, no outline; taller storeys cut less.
    const [classic] = computeFloorOpenings(makeFloor({ items: [placedStraight] }));
    const [tall] = computeFloorOpenings(makeFloor({ items: [placedStraight], height: 4 }));
    expect(classic!.outline).toBeUndefined();
    expect(classic!.rotation).toBe(0);
    expect(tall!.depth).toBeLessThan(classic!.depth);
  });

  it('turns an opening into a closed world outline for the plan', () => {
    const [classic] = computeFloorOpenings(makeFloor({ items: [{ ...placedStraight, rotation: Math.PI / 2 }] }));
    const outline = floorOpeningOutline(classic!);
    expect(outline).toHaveLength(4);
    // Rotated a quarter turn, the hole's 1.3 m width runs along world z.
    const xs = outline.map(([x]) => x);
    const zs = outline.map(([, z]) => z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(1.3);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(classic!.depth);
    const [plain] = computeFloorOpenings(makeFloor({ items: [placedWinder] }));
    expect(floorOpeningOutline(plain!)).toBe(plain!.outline);
  });

  it('lays the plan symbol out in world space, foot first, mirrored and rotated like the mesh', () => {
    const symbol = stairPlanSymbol(placedStraight);
    expect(symbol.treads).toHaveLength(STAIR_STEP_COUNT);
    expect(symbol.walkLine).toHaveLength(STAIR_STEP_COUNT);
    // The straight flight climbs local +z: the walk line runs down the plan at x = −2.
    expect(symbol.walkLine[0]![0]).toBeCloseTo(-2);
    expect(symbol.walkLine[0]![1]).toBeCloseTo(-1.2 + 2.4 / STAIR_STEP_COUNT / 2);
    expect(symbol.walkLine[STAIR_STEP_COUNT - 1]![1]).toBeCloseTo(1.2 - 2.4 / STAIR_STEP_COUNT / 2);

    const plain = stairPlanSymbol(placedWinder);
    const mirrored = stairPlanSymbol({ ...placedWinder, mirrored: true });
    // Up flight on the stair's −x side, return on +x; a mirror swaps them.
    expect(plain.walkLine[0]![0]).toBeLessThan(1);
    expect(plain.walkLine[STAIR_STEP_COUNT - 1]![0]).toBeGreaterThan(1);
    expect(mirrored.walkLine[0]![0]).toBeGreaterThan(1);
    expect(mirrored.walkLine[STAIR_STEP_COUNT - 1]![0]).toBeLessThan(1);
    mirrored.walkLine.forEach(([x, z], i) => {
      expect(x).toBeCloseTo(2 - plain.walkLine[i]![0]);
      expect(z).toBeCloseTo(plain.walkLine[i]![1]);
    });
    // The rise never changes what the plan shows.
    const tall = { ...placedWinder, height: 7 };
    expect(stairPlanSymbol(tall)).toEqual(plain);
  });

  it('draws each shared nosing once', () => {
    const lines = stairTreadLines(stairPlanSymbol(placedStraight).treads);
    // 14 rectangles share 13 nosings: 14 × 4 edges − 13 shared.
    expect(lines).toHaveLength(14 * 4 - 13);
    const keys = lines.map(([a, b]) => [a, b].map(([x, z]) => `${x.toFixed(5)},${z.toFixed(5)}`).sort().join('|'));
    expect(new Set(keys).size).toBe(lines.length);
  });
});
