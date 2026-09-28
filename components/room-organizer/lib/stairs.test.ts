import { describe, expect, it } from 'vitest';
import {
  MAX_STAIRS_LEAD_IN,
  STAIR_HEADROOM,
  STAIR_STEP_COUNT,
  WINDER_TREADS,
  isStairsLeadIn,
  isStairsShape,
  stairSteps,
  stairwellRect,
  winderFlights,
  winderStairwellOutline,
} from './stairs';

const straight = { width: 1.2, depth: 2.4 };
const winder = { width: 2, depth: 2.6, stairsShape: 'winder' as const };

const area = (outline: Array<[number, number]>) =>
  Math.abs(outline.reduce((sum, [x, z], i) => {
    const [nx, nz] = outline[(i + 1) % outline.length]!;
    return sum + x * nz - nx * z;
  }, 0)) / 2;

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
