import { describe, expect, it } from 'vitest';
import { WINDOW_SILL_HEIGHT } from './constants';
import {
  clampEntrance,
  entranceBackWall,
  entranceFloorIndex,
  entranceGeometry,
  entranceSteps,
  entranceWallCut,
  isEntranceSpec,
  isSillHeight,
  windowSillHeight,
} from './street';

const flat = { width: 6, depth: 9, floors: [{}, {}] };
const hill = { width: 6, depth: 9, floors: [{ height: 2.5 }, {}, { height: 1.1 }], terrain: { frontY: 1.2, backY: 0 } };

describe('window sills (#204)', () => {
  it('uses a window’s own sill, else the shared datum', () => {
    expect(windowSillHeight({})).toBe(WINDOW_SILL_HEIGHT);
    expect(windowSillHeight({ sillHeight: 0.3 })).toBe(0.3);
    expect(isSillHeight(0)).toBe(true);
    expect(isSillHeight(-0.1)).toBe(false);
    expect(isSillHeight(3)).toBe(false);
    expect(isSillHeight(Number.NaN)).toBe(false);
  });
});

describe('recessed entrance (#204)', () => {
  it('opens onto the ground floor on a flat site, with no steps', () => {
    const g = entranceGeometry({ width: 1.4, depth: 1.2 }, flat)!;
    expect(g).toMatchObject({ floorIndex: 0, bottomY: 0, streetY: 0, frontZ: -4.5 });
    expect(g.backZ).toBeCloseTo(-3.3);
    expect(g.x1 - g.x0).toBeCloseTo(1.4);
    expect(entranceSteps(g).count).toBe(0);
  });

  it('skips a basement below the street and climbs to the ground floor on a hill', () => {
    expect(entranceFloorIndex(hill.floors, 1.2)).toBe(1);
    const g = entranceGeometry({ width: 1.4, depth: 1.2 }, hill)!;
    expect(g.floorIndex).toBe(1);
    expect(g.bottomY).toBe(2.5);
    const steps = entranceSteps(g);
    expect(steps.count).toBe(Math.ceil(1.3 / 0.18));
    expect(steps.rise * steps.count).toBeCloseTo(1.3);
  });

  it('fits the recess inside the facade and the house', () => {
    const g = entranceGeometry({ width: 4, depth: 3, offset: 10 }, { ...flat, width: 3, depth: 3.5 })!;
    expect(g.x0).toBeGreaterThanOrEqual(-1.5 + 0.3 - 1e-9);
    expect(g.x1).toBeLessThanOrEqual(1.5 - 0.3 + 1e-9);
    expect(g.backZ - g.frontZ).toBeCloseTo(2.5);
    expect(entranceGeometry({ width: 1.4, depth: 1 }, { ...flat, width: 1.2 })).toBeNull();
  });

  it('cuts the front wall of each storey it crosses, never splitting a wall in two', () => {
    const tall = entranceGeometry({ width: 1.4, depth: 1.2, height: 4 }, flat)!;
    const ground = entranceWallCut(tall, flat.floors, 0)!;
    const upper = entranceWallCut(tall, flat.floors, 1)!;
    expect(ground).toMatchObject({ bottomFromFloor: 0 });
    expect(ground.height).toBeCloseTo(2.99);
    expect(upper.bottomFromFloor).toBe(0);
    expect(upper.height).toBeCloseTo(1);
    const low = entranceGeometry({ width: 1.4, depth: 1.2 }, flat)!;
    expect(entranceWallCut(low, flat.floors, 1)).toBeNull();
  });

  it('closes the back of the recess with a wall across it', () => {
    const g = entranceGeometry({ width: 1.4, depth: 1.2, offset: 1 }, flat)!;
    expect(entranceBackWall(g)).toEqual({ x1: g.x0, z1: g.backZ, x2: g.x1, z2: g.backZ });
  });

  it('validates and clamps specs', () => {
    expect(isEntranceSpec({ width: 1.4, depth: 1.2 })).toBe(true);
    expect(isEntranceSpec({ width: 1.4, depth: 1.2, height: 9 })).toBe(false);
    expect(isEntranceSpec({ width: 0.2, depth: 1.2 })).toBe(false);
    expect(isEntranceSpec({ width: 1.4 })).toBe(false);
    expect(isEntranceSpec('porch')).toBe(false);
    expect(clampEntrance({ width: 99, depth: -1, height: Number.NaN })).toEqual({ width: 4, depth: 0.3, height: 2.4 });
  });
});
