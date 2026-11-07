import { describe, expect, it } from 'vitest';
import { makeItem, makeUnplacedItem } from './__testfixtures__/fixtures';
import { pendantBulbY } from './mount-band';
import { collectLampLights, isNightLit, LAMP_POOL_SIZE, nearestLamps, nightGlowPlan, planLampPool, roomLampReach, type LampLight } from './night-lights';
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

describe('lamps indoors and out (#664)', () => {
  const house = { width: 8, height: 6, cutout: { corner: 'ne', width: 3, depth: 2 } } as const;
  const outdoors = (x: number, z: number, type = 'lamppost') =>
    collectLampLights([floor([item(type, 3.2, x, z)])], GROUND, house)[0]?.outdoors === true;

  it('goes by where the lamp stands, not its type', () => {
    expect(outdoors(0, -6)).toBe(true);
    expect(outdoors(0, 0)).toBe(false);
    expect(outdoors(-6, 0, 'lamp')).toBe(true);
  });

  it('counts the cut corner of an L as outdoors', () => {
    expect(outdoors(3, -2.5)).toBe(true);
  });

  it('carries the flag onto the pool, spares dark and indoors', () => {
    const plan = planLampPool([{ x: 0, y: 1, z: 0, candela: 1, range: 1, outdoors: true }], { x: 0, y: 1, z: 0 }, 1);
    expect(plan.slots[0]?.outdoors).toBe(true);
    expect(plan.slots[1]?.outdoors).toBe(false);
  });
});

describe('nightGlowPlan (#759)', () => {
  const house = { width: 10, height: 8 };
  const windowAt = (x: number, z: number) => item('window', 1.2, x, z);

  it('lights a window a lamp reaches, more the nearer it is', () => {
    const near = windowAt(-5, 0);
    const middle = windowAt(0, -4);
    const out = windowAt(5, 0);
    const { windows } = nightGlowPlan([floor([item('lamp', 1.5, -4, 0), near, middle, out])], house);
    expect(windows[near.id]).toBe(1);
    expect(windows[middle.id]).toBeGreaterThan(0.25);
    expect(windows[middle.id]).toBeLessThan(1);
    expect(windows[out.id]).toBe(0);
  });

  it('leaves every window dark without a lamp on its own storey', () => {
    const pane = windowAt(-5, 0);
    expect(nightGlowPlan([floor([pane]), floor([item('lamp', 1.5, -4, 0)])], house).windows[pane.id]).toBe(0);
  });

  it('stops at a partition', () => {
    const pane = windowAt(-5, 0);
    const room = { ...floor([item('lamp', 1.5, -1, 0), pane]), interiorWalls: [{ id: 'w', x1: -3, z1: -4, x2: -3, z2: 4 }] };
    expect(nightGlowPlan([room], house).windows[pane.id]).toBe(0);
  });

  it('ignores a lamppost in the garden', () => {
    const pane = windowAt(-5, 0);
    expect(nightGlowPlan([floor([item('lamppost', 3.2, -7, 0), pane])], house).windows[pane.id]).toBe(0);
  });

  it('lists the lamps of every storey, and lights the dormers from the top one', () => {
    const upper = item('pendant-light', 0.6, 0, 0);
    const plan = nightGlowPlan([floor([]), floor([upper])], house);
    expect(plan.lamps).toEqual([upper.id]);
    expect(plan.dormers).toBe(1);
    expect(nightGlowPlan([floor([upper]), floor([])], house).dormers).toBe(0);
  });
});

describe('roomLampReach: the bounce around a walker (#759)', () => {
  const lamp = (x: number, z: number, outdoors = false): LampLight => ({ x, y: 1.5, z, candela: 10, range: 7, ...(outdoors ? { outdoors } : {}) });
  const partition = { id: 'p', x1: 0, z1: -5, x2: 0, z2: 5 };

  it('is lit by a lamp in the same room', () => {
    expect(roomLampReach([lamp(-2, 0)], { x: -3, z: 0 }, [partition])).toBe(1);
  });

  it('ignores a garden lamp, however near', () => {
    expect(roomLampReach([lamp(-5, 0, true)], { x: -3, z: 0 }, [])).toBe(0);
  });

  it('ignores a lamp in the other wing of an L, across the open corner', () => {
    const notch = { x0: 0.5, x1: 4.5, z0: -3.5, z1: -0.5 };
    // A window on the notch's own wall, a lamp in the other wing.
    expect(roomLampReach([lamp(-0.3, -2.6)], { x: 2.5, z: -0.5 }, [], notch)).toBe(0);
    // In the same wing, along the notch wall: lit.
    expect(roomLampReach([lamp(1.5, 0.5)], { x: 2.5, z: -0.5 }, [], notch)).toBe(1);
  });

  it('ignores a lamp in the next room, and one out of reach', () => {
    expect(roomLampReach([lamp(2, 0)], { x: -2, z: 0 }, [partition])).toBe(0);
    expect(roomLampReach([lamp(-20, 0)], { x: -2, z: 0 }, [])).toBe(0);
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

describe('a garden lamp on a sloped site (#665)', () => {
  const site = { width: 8, height: 6, terrain: { frontY: -3, backY: 0 } };
  const post = (x: number, z: number) => makeItem({ id: 'post', type: 'lamppost', category: 'outdoor', height: 3.2, position: { x, z } });

  it('hangs its bulb over the post where the post stands, on the ground', () => {
    const [flat] = collectLampLights([floor([post(0, -6)])], GROUND, { width: 8, height: 6 });
    const [front] = collectLampLights([floor([post(0, -6)])], GROUND, site);
    expect(front!.y).toBeCloseTo(flat!.y - 3);
  });

  it('leaves a lamp indoors on its floor', () => {
    const lamp = makeItem({ id: 'l', type: 'floor-lamp', category: 'outdoor', height: 1.7, position: { x: 0, z: 0 } });
    const [flat] = collectLampLights([floor([lamp])], GROUND, { width: 8, height: 6 });
    const [sloped] = collectLampLights([floor([lamp])], GROUND, site);
    expect(sloped!.y).toBe(flat!.y);
  });
});
