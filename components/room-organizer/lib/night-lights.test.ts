import { describe, expect, it } from 'vitest';
import { makeItem, makeUnplacedItem } from './__testfixtures__/fixtures';
import { collectLampLights, isNightLit, LAMP_POOL_SIZE, nearestLamps, pendantBulbY, planLampPool, type LampLight } from './night-lights';
import type { FloorLayout, FurnitureItem } from './types';

function item(type: string, height: number, x = 1, z = 2): FurnitureItem {
  return makeItem({ id: `${type}-${x}-${z}`, type, height, position: { x, z } });
}

function floor(items: FurnitureItem[], height?: number): FloorLayout {
  return { items, ...(height !== undefined ? { height } : {}) } as FloorLayout;
}

const GROUND = { activeFloorIndex: 0, showAllFloors: false };
const ALL = { activeFloorIndex: 0, showAllFloors: true };

function lamp(x: number, z: number, y = 1): LampLight {
  return { x, y, z, candela: 8, range: 7 };
}

describe('collectLampLights (#215)', () => {
  it('lights lamps, floor lamps, pendants and lampposts, nothing else', () => {
    for (const type of ['lamp', 'floor-lamp', 'pendant-light', 'lamppost']) expect(isNightLit(type)).toBe(true);
    for (const type of ['sofa', 'tv', 'window', 'toString']) expect(isNightLit(type)).toBe(false);
    const lights = collectLampLights(
      [floor([item('lamp', 1.5), item('sofa', 0.9), item('lamppost', 3.2), item('pendant-light', 1)])],
      GROUND
    );
    expect(lights).toHaveLength(3);
  });

  it('puts each bulb where its builder draws it', () => {
    const [lamp, post] = collectLampLights([floor([item('lamp', 1.5), item('lamppost', 3.2)])], GROUND);
    expect(lamp!.y).toBeCloseTo(1.35, 10);
    expect(post!.y).toBeCloseTo(3.2 * 0.93, 10);
  });

  it("puts a pendant's bulb where pendantBulbY says, given its storey's height", () => {
    const floors = [floor([], 2.5), floor([item('pendant-light', 1)], 2.8)];
    const [pendant] = collectLampLights(floors, { activeFloorIndex: 1, showAllFloors: false });
    expect(pendant!.y).toBeCloseTo(2.5 + pendantBulbY(item('pendant-light', 1), 2.8), 10);
  });

  it('offsets an upper floor by the storeys below, not by the bulb factor (#146)', () => {
    const [upper] = collectLampLights([floor([], 2.5), floor([item('lamp', 1.5, 3, 4)])], ALL);
    expect(upper).toMatchObject({ x: 3, z: 4 });
    expect(upper!.y).toBeCloseTo(2.5 + 1.35, 10);
  });

  it('only lights storeys the view draws', () => {
    const floors = [floor([item('lamp', 1.5, 1, 1)]), floor([item('lamp', 1.5, 2, 2), item('floor-lamp', 1.6, 3, 3)])];
    expect(collectLampLights(floors, GROUND).map((l) => l.x)).toEqual([1]);
    expect(collectLampLights(floors, { activeFloorIndex: 1, showAllFloors: false }).map((l) => l.x)).toEqual([2, 3]);
    expect(collectLampLights(floors, ALL).map((l) => l.x)).toEqual([1, 2, 3]);
  });

  it('skips unplaced items', () => {
    expect(collectLampLights([floor([makeUnplacedItem({ type: 'lamp', height: 1.5 })])], GROUND)).toEqual([]);
  });
});

describe('planLampPool (#393)', () => {
  const ORIGIN = { x: 0, y: 0, z: 0 };
  const many = Array.from({ length: 60 }, (_, i) => lamp(i, 0));

  it('always has the same number of lights, whatever the hour or the lamp count', () => {
    for (const lamps of [[], [lamp(1, 1)], many.slice(0, 4), many]) {
      for (const level of [0, 0.3, 1]) {
        expect(planLampPool(lamps, ORIGIN, level).slots).toHaveLength(LAMP_POOL_SIZE);
      }
    }
  });

  it('is dark and unlit by day', () => {
    const plan = planLampPool(many, ORIGIN, 0);
    expect(plan.lit).toBe(false);
    for (const slot of plan.slots) expect(slot.intensity).toBe(0);
  });

  it('is unlit at night with no lamp to light', () => {
    expect(planLampPool([], ORIGIN, 1).lit).toBe(false);
  });

  it('lights the lamps nearest the focus at their night level, the spares dark', () => {
    const plan = planLampPool([lamp(10, 0), lamp(1, 0), lamp(-2, 0)], { x: 0.5, y: 1, z: 0 }, 0.5);
    expect(plan.lit).toBe(true);
    expect(plan.slots.slice(0, 3).map((s) => s.x)).toEqual([1, -2, 10]);
    expect(plan.slots[0]!.intensity).toBeCloseTo(4, 10);
    expect(plan.slots[0]!.distance).toBe(7);
    for (const slot of plan.slots.slice(3)) expect(slot.intensity).toBe(0);
  });

  it('gives a big house only the pool-size nearest lamps', () => {
    const plan = planLampPool(many, { x: 30.2, y: 1, z: 0 }, 1);
    expect(plan.slots.map((s) => s.x).sort((a, b) => a - b)).toEqual([27, 28, 29, 30, 31, 32, 33, 34]);
    for (const slot of plan.slots) expect(slot.intensity).toBe(8);
  });

  it('measures height too: a lamp on another storey is further away', () => {
    const [nearest] = nearestLamps([lamp(0, 0, 4), lamp(1, 0, 1)], { x: 0, y: 1, z: 0 }, 1);
    expect(nearest!.x).toBe(1);
  });
});
