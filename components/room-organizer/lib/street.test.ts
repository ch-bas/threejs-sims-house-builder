import { describe, expect, it } from 'vitest';
import { WINDOW_SILL_HEIGHT } from './constants';
import {
  STREET_TOLERANCE,
  clampEntrance,
  entranceBackWall,
  entranceFloorIndex,
  entranceGeometry,
  entranceKeepOut,
  entranceOffsetRange,
  entrancePlanOutline,
  entranceProblem,
  entranceSteps,
  entranceWallCut,
  isEntranceSpec,
  isSillHeight,
  planFloorIndex,
  sameEntrance,
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

  it('builds nothing when the street is above every floor, and says why (#274)', () => {
    // The default "Sloped site" preset: one 3 m storey, street at 3.
    const buried = { width: 8, depth: 8, floors: [{}], terrain: { frontY: 3, backY: 0 } };
    expect(entranceFloorIndex(buried.floors, 3)).toBeNull();
    expect(entranceGeometry({ width: 1.4, depth: 1.2 }, buried)).toBeNull();
    expect(entranceProblem({ width: 1.4, depth: 1.2 }, buried)).toBe('no-street-storey');
    // Half a metre of street above a single storey blocks the opening the same way.
    expect(entranceGeometry({ width: 1.4, depth: 1.2 }, { ...buried, terrain: { frontY: 0.5, backY: 0 } })).toBeNull();
    // A storey above the street hosts it, up the steps.
    const g = entranceGeometry({ width: 1.4, depth: 1.2 }, { ...buried, floors: [{}, {}] })!;
    expect(g.floorIndex).toBe(1);
    expect(entranceProblem({ width: 1.4, depth: 1.2 }, { ...buried, floors: [{}, {}] })).toBeNull();
  });

  it('keeps the porch on the storey a kerb below the street instead of a flight up (#274)', () => {
    const kerb = { ...flat, terrain: { frontY: 0.1, backY: 0 } };
    expect(entranceFloorIndex(kerb.floors, 0.1)).toBe(0);
    const g = entranceGeometry({ width: 1.4, depth: 1.2 }, kerb)!;
    expect(g).toMatchObject({ floorIndex: 0, bottomY: 0, streetY: 0.1 });
    expect(entranceSteps(g).count).toBe(0);
    expect(entranceFloorIndex(flat.floors, STREET_TOLERANCE)).toBe(0);
    expect(entranceFloorIndex(flat.floors, STREET_TOLERANCE + 0.05)).toBe(1);
    // The nearest floor wins on either side of the street.
    expect(entranceFloorIndex(flat.floors, 3 - STREET_TOLERANCE)).toBe(1);
  });

  it('exposes the offsets the recess can reach, and clamps to exactly them (#281)', () => {
    expect(entranceOffsetRange({ width: 1.4 }, 6)).toEqual([-2, 2]);
    const [, max] = entranceOffsetRange({ width: 1.4 }, 6);
    const g = entranceGeometry({ width: 1.4, depth: 1.2, offset: 8 }, flat)!;
    expect((g.x0 + g.x1) / 2).toBeCloseTo(max);
    // A recess wider than the wall allows is fitted first, then has no play.
    const [none0, none1] = entranceOffsetRange({ width: 4 }, 4);
    expect(none0).toBeCloseTo(0);
    expect(none1).toBeCloseTo(0);
    expect(entranceProblem({ width: 1.4, depth: 1.2 }, { ...flat, width: 1.2 })).toBe('facade-too-narrow');
    expect(entranceProblem({ width: 1.4, depth: 1.2 }, { ...flat, depth: 1.2 })).toBe('house-too-shallow');
    expect(entranceProblem({ width: 1.4, depth: 1.2 }, { ...flat, floors: [{ height: 1.5 }] })).toBe('too-low');
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

  it('keeps the deleted-door flag through validation, clamping and comparison (#273)', () => {
    expect(isEntranceSpec({ width: 1.4, depth: 1.2, door: false })).toBe(true);
    expect(isEntranceSpec({ width: 1.4, depth: 1.2, door: true })).toBe(false);
    expect(clampEntrance({ width: 1.4, depth: 1.2, door: false })).toEqual({ width: 1.4, depth: 1.2, door: false });
    expect(sameEntrance({ width: 1.4, depth: 1.2 }, { width: 1.4, depth: 1.2 })).toBe(true);
    expect(sameEntrance({ width: 1.4, depth: 1.2 }, { width: 1.4, depth: 1.2, door: false })).toBe(false);
    expect(sameEntrance({ width: 1.4, depth: 1.2, offset: 0 }, { width: 1.4, depth: 1.2 })).toBe(false);
  });
});

describe('entrance on the plan (#285)', () => {
  const building = {
    width: 6,
    height: 9,
    floors: [{ id: 'g', height: 3 }, { id: 'u', height: 3 }],
    entrance: { width: 1.4, depth: 1.2, offset: 1 },
  };

  it('is the fitted recess on the storey it opens onto, and nothing on the others', () => {
    const g = entranceGeometry(building.entrance, { width: 6, depth: 9, floors: building.floors })!;
    const outline = entrancePlanOutline(building, 0)!;
    expect(outline).toEqual({ x0: g.x0, x1: g.x1, frontZ: g.frontZ, backZ: g.backZ });
    expect(outline.x1 - outline.x0).toBeCloseTo(1.4);
    expect(outline.frontZ).toBe(-4.5);
    expect(outline.backZ - outline.frontZ).toBeCloseTo(1.2);
    expect((outline.x0 + outline.x1) / 2).toBeCloseTo(1);
    expect(entrancePlanOutline(building, 1)).toBeNull();
    expect(entrancePlanOutline(building, -1)).toBeNull();
    expect(entrancePlanOutline(building, 2)).toBeNull();
  });

  it('notches every storey the porch crosses — exactly the walls 3D cuts', () => {
    const tall = { ...building, entrance: { ...building.entrance, height: 4 } };
    expect(entrancePlanOutline(tall, 0)).not.toBeNull();
    expect(entrancePlanOutline(tall, 1)).toEqual(entrancePlanOutline(tall, 0));
  });

  it('draws nothing for a house without an entrance, or one that can’t be built', () => {
    expect(entrancePlanOutline({ ...building, entrance: undefined }, 0)).toBeNull();
    // Street above the only storey: no-street-storey.
    expect(
      entrancePlanOutline({ ...building, floors: [{ height: 3 }], terrain: { frontY: 3, backY: 0 } }, 0)
    ).toBeNull();
  });

  it('follows the porch up the hill to the storey at street level', () => {
    const hillside = {
      ...building,
      floors: [{ id: 'b', height: 2.5 }, { id: 'g', height: 3 }],
      terrain: { frontY: 2.5, backY: 0 },
    };
    expect(entrancePlanOutline(hillside, 0)).toBeNull();
    expect(entrancePlanOutline(hillside, 1)).not.toBeNull();
  });

  it('is the collision keep-out, and finds a plan’s storey by identity or id', () => {
    const outline = entrancePlanOutline(building, 0)!;
    expect(entranceKeepOut(building, 0)).toEqual([
      { x0: outline.x0, x1: outline.x1, z0: outline.frontZ, z1: outline.backZ },
    ]);
    expect(entranceKeepOut(building, 1)).toEqual([]);
    expect(planFloorIndex(building.floors, building.floors[1]!)).toBe(1);
    // The 2D drag paints a copy of the active floor.
    expect(planFloorIndex(building.floors, { id: 'u' })).toBe(1);
    expect(planFloorIndex(building.floors, { id: 'attic' })).toBe(-1);
  });
});
