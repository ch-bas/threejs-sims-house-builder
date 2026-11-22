import { describe, expect, it } from 'vitest';
import { measureCpu } from './__testfixtures__/cpu-time';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { floorKeepOut } from './floor-keep-out';
import { GARDEN_CLOSES, GARDEN_OPENS, findGardenSeats, findGardenSpots, gardenNavInput, gardenOpen, gardenSignature, indoorOnly, onTheLot, reachableGardenSpots } from './npc-garden';
import { findNeedSpots, householdLacks } from './npc-needs';
import {
  MAX_PATH_POINTS,
  type NpcNav,
  buildNpcNav,
  cellAt,
  cellX,
  cellZ,
  cutOffOutside,
  findNpcPath,
  isFreeAt,
  isOutdoorCell,
  lineIsFree,
  nearestIndoorCell,
  npcGroundY,
  pickDestination,
  randomFreeCell,
} from './npc-path';
import { findNpcSeats } from './npc-seats';
import { ENTRANCE_DOOR_ID, ENTRANCE_WALL_ID, entranceGeometry } from './street';
import type { FurnitureItem, InteriorWall, RoomLayout } from './types';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A door in a wall running along x (rotation 0) or z (π/2). */
function door(id: string, x: number, z: number, rotation = 0, overrides: Partial<FurnitureItem> = {}): FurnitureItem {
  return makeItem({ id, type: 'door', name: 'Door', width: 0.9, depth: 0.12, height: 2.05, position: { x, z }, rotation, ...overrides });
}

function bench(x: number, z: number, rotation = 0): FurnitureItem {
  return makeItem({ id: 'bench', type: 'garden-bench', name: 'Garden Bench', category: 'outdoor', width: 1.5, depth: 0.5, height: 0.85, position: { x, z }, rotation });
}

function fence(id: string, x: number, z: number, rotation = 0, width = 2): FurnitureItem {
  return makeItem({ id, type: 'fence', name: 'Fence', category: 'outdoor', width, depth: 0.15, height: 1.2, position: { x, z }, rotation });
}

function house(items: FurnitureItem[], overrides: Partial<RoomLayout> = {}, walls: InteriorWall[] = []): RoomLayout {
  return makeLayout({ width: 8, height: 8, floors: [makeFloor({ items, interiorWalls: walls })], ...overrides });
}

function gardenNav(layout: RoomLayout): NpcNav {
  const building = layout;
  const floor = layout.floors[0]!;
  const nav = buildNpcNav({
    items: floor.items,
    interiorWalls: floor.interiorWalls ?? [],
    keepOut: floorKeepOut(building, 0),
    roomWidth: layout.width,
    roomDepth: layout.height,
    outdoor: gardenNavInput(building, 0),
  });
  if (!nav) throw new Error('no nav');
  return nav;
}

function route(nav: NpcNav, fromX: number, fromZ: number, toX: number, toZ: number): Array<[number, number]> {
  const out = new Float32Array(MAX_PATH_POINTS * 2);
  const count = findNpcPath(nav, fromX, fromZ, cellAt(nav, toX, toZ), out);
  const points: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) points.push([out[i * 2]!, out[i * 2 + 1]!]);
  return points;
}

/**
 * Every waypoint of a route stands on free cells but each doorway's centre,
 * and every leg off a doorway is walked along free cells (the waypoints are
 * float32, so a leg grazing furniture is checked a hair off the line it was
 * pulled along: those are let off).
 */
function legsWalkable(nav: NpcNav, fromX: number, fromZ: number, points: ReadonlyArray<[number, number]>): boolean {
  let [ax, az] = [fromX, fromZ];
  let doors = 0;
  for (const [x, z] of points) {
    if (!isFreeAt(nav, x, z)) {
      // A doorway: between two free waypoints, a step each way.
      doors++;
      if (!isFreeAt(nav, ax, az) || Math.hypot(x - ax, z - az) > 1) return false;
    } else if (isFreeAt(nav, ax, az) && Math.hypot(x - ax, z - az) > 1.5 && !lineIsFree(nav, ax, az, x, z) && !lineIsFree(nav, ax + 0.01, az + 0.01, x, z)) {
      return false;
    }
    [ax, az] = [x, z];
  }
  return doors <= points.length / 2;
}

/** The bench faces +z: its approach point, 0.6 m in front. */
const BACK_DOOR = door('back', 0, 4);
const BENCH = bench(0, 7.5);

describe('the garden nav (#913)', () => {
  it('joins the lot to the house at the back door: one region, a route out through the doorway', () => {
    const nav = gardenNav(house([BACK_DOOR, BENCH]));
    expect(nav.outdoor).not.toBeNull();
    const inside = cellAt(nav, 0, 0);
    const outside = cellAt(nav, 0, 8.4);
    expect(isOutdoorCell(nav, outside)).toBe(true);
    expect(nav.region[inside]).toBe(nav.region[outside]);
    const points = route(nav, 0, 0, 0, 8.4);
    expect(points.length).toBeGreaterThan(1);
    // The route passes the doorway's centre.
    expect(points.some(([x, z]) => Math.abs(x) < 1e-6 && Math.abs(z - 4) < 1e-6)).toBe(true);
    expect(legsWalkable(nav, 0, 0, points)).toBe(true);
    const [lastX, lastZ] = points[points.length - 1]!;
    expect(Math.hypot(lastX - 0, lastZ - 8.4)).toBeLessThan(0.3);
  });

  it('walks round the house from the back door to the front of the lot', () => {
    const nav = gardenNav(house([BACK_DOOR, bench(0, -7, Math.PI)]));
    const points = route(nav, 0, 0, 0, -6);
    expect(points.length).toBeGreaterThan(2);
    expect(legsWalkable(nav, 0, 0, points)).toBe(true);
    // Out of the door, no leg crosses the house.
    const out = points.findIndex(([, z]) => z > 4.1);
    expect(out).toBeGreaterThan(0);
    for (let i = out + 1; i < points.length; i++) {
      const [ax, az] = points[i - 1]!;
      const [bx, bz] = points[i]!;
      for (let t = 0; t <= 1; t += 0.02) expect(nav.outdoor!.indoors(ax + (bx - ax) * t, az + (bz - az) * t)).toBe(false);
    }
  });

  it('stays indoors with no way out, nothing in the garden, or on an upper storey', () => {
    const plain = buildNpcNav({ items: [BENCH], interiorWalls: [], keepOut: [], roomWidth: 8, roomDepth: 8 })!;
    const noDoor = gardenNav(house([BENCH]));
    expect(noDoor.outdoor).toBeNull();
    expect(noDoor.freeCount).toBe(plain.freeCount);
    expect(gardenNavInput(house([BACK_DOOR]), 0)).toBeNull();
    const twoStoreys = makeLayout({ floors: [makeFloor({ items: [BACK_DOOR, BENCH] }), makeFloor({ id: 'up', items: [BACK_DOOR, BENCH] })] });
    expect(gardenNavInput(twoStoreys, 1)).toBeNull();
    expect(gardenNavInput(twoStoreys, 0)).not.toBeNull();
  });

  it('an interior door is no way out', () => {
    const wall: InteriorWall = { id: 'w', x1: -4, z1: 1, x2: 4, z2: 1 };
    expect(gardenNavInput(house([door('inner', 0, 1), BENCH], {}, [wall]), 0)).toBeNull();
  });

  it('a fence across the doorway shuts it; fences round the bench shut it in', () => {
    const shut = gardenNav(house([BACK_DOOR, BENCH, fence('f', 0, 4.35, 0, 1.6)]));
    expect(shut.outdoor).toBeNull();
    const pen = [fence('n', 0, 6.4, 0, 3), fence('s', 0, 8.6, 0, 3), fence('w', -1.5, 7.5, Math.PI / 2, 2.4), fence('e', 1.5, 7.5, Math.PI / 2, 2.4)];
    const nav = gardenNav(house([BACK_DOOR, BENCH, ...pen]));
    expect(nav.region[cellAt(nav, 0, 0)]).not.toBe(nav.region[cellAt(nav, 0, 8.1)]);
    expect(route(nav, 0, 0, 0, 8.1)).toHaveLength(0);
    // Beside the pen, the lawn is still reached.
    expect(route(nav, 0, 0, 3, 7.5).length).toBeGreaterThan(0);
  });

  it('a door more than a step above the lot is no way out; on a gentle slope the walker follows the ground', () => {
    expect(gardenNav(house([BACK_DOOR, BENCH], { terrain: { frontY: 0, backY: 1.5 } })).outdoor).toBeNull();
    const sloped = gardenNav(house([BACK_DOOR, BENCH], { terrain: { frontY: 0, backY: 0.3 } }));
    expect(sloped.outdoor).not.toBeNull();
    // Flat at the garden's height behind the house, nothing indoors.
    expect(npcGroundY(sloped, 0, 8)).toBeCloseTo(0.3, 5);
    expect(npcGroundY(sloped, 0, 0)).toBe(0);
  });

  it('goes out through the porch: in the recess, down the steps, and onto the lot', () => {
    const layout = house([], { entrance: { width: 1.4, depth: 1.2 } });
    const geometry = entranceGeometry(layout.entrance!, { width: 8, depth: 8, floors: layout.floors })!;
    const wall: InteriorWall = { id: ENTRANCE_WALL_ID, x1: geometry.x0, z1: geometry.backZ, x2: geometry.x1, z2: geometry.backZ };
    const items = [door(ENTRANCE_DOOR_ID, 0, geometry.backZ), bench(2.5, -7.5, Math.PI)];
    const nav = gardenNav({ ...layout, floors: [makeFloor({ items, interiorWalls: [wall] })] });
    expect(nav.outdoor).not.toBeNull();
    // The recess is lot, not floor.
    expect(isOutdoorCell(nav, cellAt(nav, 0, -3.6))).toBe(true);
    expect(isFreeAt(nav, 0, -3.6)).toBe(true);
    const points = route(nav, 0, 1, 2.5, -6.8);
    expect(points.length).toBeGreaterThan(1);
    expect(points.some(([x, z]) => Math.abs(x) < 1e-6 && Math.abs(z - geometry.backZ) < 1e-6)).toBe(true);
    expect(legsWalkable(nav, 0, 1, points)).toBe(true);
  });

  it("the L's cut corner is open ground, through a door in the notch", () => {
    const layout = house([door('notch', 2.5, 1), bench(2.5, 3)], { cutout: { corner: 'se', width: 3, depth: 3 } });
    const nav = gardenNav(layout);
    expect(nav.outdoor).not.toBeNull();
    expect(isOutdoorCell(nav, cellAt(nav, 2.5, 2.1))).toBe(true);
    expect(isFreeAt(nav, 2.5, 2.1)).toBe(true);
    const points = route(nav, -2, -2, 2.5, 3.8);
    expect(points.length).toBeGreaterThan(1);
    expect(legsWalkable(nav, -2, -2, points)).toBe(true);
  });

  it('keeps off the houses along a party wall and the pavement on a pavement frontage', () => {
    const nav = gardenNav(house([BACK_DOOR, bench(5.5, 5)], { neighbours: { east: true }, frontage: 'pavement' }));
    expect(nav.outdoor).not.toBeNull();
    // Beside the house to the east is next door's house.
    expect(isFreeAt(nav, 6, 0)).toBe(false);
    // Nothing in front of the front wall on a pavement frontage.
    expect(nav.outdoor!.z0).toBeGreaterThanOrEqual(-4);
  });

  it('a garden surface is somewhere to wander to; plain lawn is only crossed', () => {
    const grounds = [{ id: 'g', kind: 'paving' as const, x: -2, z: 5, w: 4, d: 2 }];
    const nav = gardenNav(house([BACK_DOOR], { grounds }));
    expect(nav.outdoor).not.toBeNull();
    expect(nav.wanderCount).toBeGreaterThan(0);
    for (let i = 0; i < nav.wanderCount; i++) {
      const cell = nav.wander[i]!;
      expect(cellZ(nav, cell)).toBeGreaterThanOrEqual(5);
      expect(cellZ(nav, cell)).toBeLessThanOrEqual(7);
    }
    const random = seeded(3);
    let outside = 0;
    for (let i = 0; i < 400; i++) {
      const cell = pickDestination(nav, cellAt(nav, 0, 0), random);
      if (!isOutdoorCell(nav, cell)) continue;
      outside++;
      expect(cellZ(nav, cell)).toBeGreaterThanOrEqual(5);
    }
    expect(outside).toBeGreaterThan(0);
  });

  it('while the garden is closed, nobody picks a spot out there, and walkers spawn indoors', () => {
    const grounds = [{ id: 'g', kind: 'deck' as const, x: -3, z: 5, w: 6, d: 3 }];
    const nav = gardenNav(house([BACK_DOOR, BENCH], { grounds }));
    nav.outdoorOpen = false;
    const random = seeded(9);
    for (let i = 0; i < 300; i++) {
      expect(isOutdoorCell(nav, pickDestination(nav, cellAt(nav, 0, 0), random))).toBe(false);
      // From the garden too: the way is back in.
      expect(isOutdoorCell(nav, pickDestination(nav, cellAt(nav, 0, 6), random))).toBe(false);
      expect(isOutdoorCell(nav, randomFreeCell(nav, random))).toBe(false);
    }
  });

  it('the garden is open in clear weather by day only: sunrise to the end of the twilight', () => {
    expect(gardenOpen('clear', 12)).toBe(true);
    expect(gardenOpen('rain', 12)).toBe(false);
    expect(gardenOpen('snow', 12)).toBe(false);
    expect(gardenOpen('clear', 23.5)).toBe(false);
    expect(gardenOpen(undefined, Number.NaN)).toBe(true);
    // Dusk: open at 19:00, shut once it is dark, 19:30, long before bedtime.
    expect(gardenOpen('clear', 19)).toBe(true);
    expect(gardenOpen('clear', GARDEN_CLOSES)).toBe(false);
    expect(gardenOpen('clear', 21.5)).toBe(false);
    // Dawn: shut before sunrise, open from it on.
    expect(gardenOpen('clear', 5.5)).toBe(false);
    expect(gardenOpen('clear', GARDEN_OPENS)).toBe(true);
    expect(gardenOpen('clear', 24 + 12)).toBe(true);
  });

  it('the garden bench is somewhere to rest, left out while the garden is closed', () => {
    const items = [BACK_DOOR, BENCH, makeItem({ id: 'sofa', type: 'sofa', width: 2, depth: 0.9, height: 0.8, position: { x: 0, z: -2 } })];
    const nav = gardenNav(house(items));
    const seats = findNpcSeats(items, { isFree: (x, z) => isFreeAt(nav, x, z), blockers: nav.colliders });
    const spots = [...findNeedSpots(items, seats), ...findGardenSpots(items, seats)];
    const benchSpot = spots.find((spot) => spot.itemId === 'bench');
    expect(benchSpot?.need).toBe('energy');
    expect(benchSpot?.seatKey).not.toBeNull();
    expect(isFreeAt(nav, benchSpot!.x, benchSpot!.z)).toBe(true);
    expect(nav.region[cellAt(nav, benchSpot!.x, benchSpot!.z)]).toBe(nav.region[cellAt(nav, 0, 0)]);
    expect(onTheLot(nav, benchSpot!.x, benchSpot!.z)).toBe(true);
    const closed = indoorOnly(nav, new Map(seats.map((seat) => [seat.key, seat])), spots);
    expect(closed.spots.some((spot) => spot.itemId === 'bench')).toBe(false);
    expect(closed.spots.some((spot) => spot.itemId === 'sofa')).toBe(true);
    expect([...closed.seats.values()].some((seat) => seat.itemId === 'bench')).toBe(false);
  });

  it('the signature follows the site, not the items', () => {
    const a = house([BACK_DOOR, BENCH]);
    expect(gardenSignature(a)).toBe(gardenSignature(house([BACK_DOOR])));
    expect(gardenSignature(a)).not.toBe(gardenSignature({ ...a, terrain: { frontY: 0, backY: 0.2 } }));
    expect(gardenSignature(a)).not.toBe(gardenSignature({ ...a, grounds: [{ id: 'g', kind: 'lawn', x: -2, z: 5, w: 2, d: 2 }] }));
  });

  it('a big fenced garden builds and routes quickly', () => {
    const items: FurnitureItem[] = [door('b1', -3, 6), door('b2', 3, 6), bench(0, 10)];
    // A fence round the lot, as "Fence the lot" lays it.
    for (let x = -10; x < 10; x += 2) items.push(fence(`fn${x}`, x + 1, -12), fence(`fs${x}`, x + 1, 12));
    for (let z = -12; z < 12; z += 2) items.push(fence(`fw${z}`, -10, z + 1, Math.PI / 2), fence(`fe${z}`, 10, z + 1, Math.PI / 2));
    for (let i = 0; i < 12; i++) items.push(makeItem({ id: `t${i}`, type: 'tree', category: 'outdoor', width: 1.4, depth: 1.4, height: 3.8, position: { x: -8 + (i % 6) * 3, z: i < 6 ? 8.5 : -9 } }));
    const layout = makeLayout({ width: 16, height: 12, floors: [makeFloor({ items })] });
    const { result: nav, cpuMs } = measureCpu(() => gardenNav(layout));
    expect(nav.outdoor).not.toBeNull();
    expect(cpuMs).toBeLessThan(250);
    const routed = measureCpu(() => {
      let found = 0;
      for (let i = 0; i < 40; i++) if (route(nav, -5 + (i % 10), -4, 0, 9.4).length > 0) found++;
      return found;
    });
    expect(routed.result).toBe(40);
    expect(routed.cpuMs).toBeLessThan(250);
  });
});

describe('the garden nav, review fixes (#913)', () => {
  it('a sliding door is a way out, through its open side', () => {
    const sliding = door('slide', 0, 4, 0, { width: 2, openingStyle: 'sliding' });
    const nav = gardenNav(house([sliding, BENCH]));
    expect(nav.outdoor).not.toBeNull();
    const points = route(nav, 0, 0, 0, 8.4);
    const doorway = points.find(([, z]) => Math.abs(z - 4) < 1e-6);
    // The fixed pane is on local −X: the way through is right of centre.
    expect(doorway![0]).toBeGreaterThan(0.3);
    const mirrored = gardenNav(house([{ ...sliding, mirrored: true }, BENCH]));
    expect(route(mirrored, 0, 0, 0, 8.4).find(([, z]) => Math.abs(z - 4) < 1e-6)![0]).toBeLessThan(-0.3);
  });

  it('no lot is rasterised when no door can be passed', () => {
    const shut = gardenNav(house([BACK_DOOR, BENCH, fence('f', 0, 4.35, 0, 1.6)]));
    expect(shut.outdoor).toBeNull();
    expect(shut.walkable.length).toBe(shut.cols * shut.rows);
  });

  it('walkers are held to the lot as it lies, not a box round the origin', () => {
    const nav = gardenNav(house([BACK_DOOR, bench(0, 7.5)], { frontage: 'pavement' }));
    const lot = nav.outdoor!;
    expect([nav.minX, nav.maxX, nav.minZ, nav.maxZ]).toEqual([lot.x0, lot.x1, lot.z0, lot.z1]);
    expect(nav.minZ).toBeGreaterThanOrEqual(-4);
    expect(nav.maxZ).toBeGreaterThan(8);
    const indoors = buildNpcNav({ items: [], interiorWalls: [], keepOut: [], roomWidth: 8, roomDepth: 8 })!;
    expect([indoors.minX, indoors.maxX]).toEqual([-indoors.halfW, indoors.halfW]);
  });

  it('one step limit for doors and the lot, and the ground eases in at the threshold', () => {
    const step = gardenNavInput(house([BACK_DOOR, BENCH]), 0)!.maxStep;
    expect(gardenNav(house([BACK_DOOR, BENCH], { terrain: { frontY: 0, backY: step - 0.02 } })).outdoor).not.toBeNull();
    expect(gardenNav(house([BACK_DOOR, BENCH], { terrain: { frontY: 0, backY: step + 0.03 } })).outdoor).toBeNull();
    const nav = gardenNav(house([BACK_DOOR, BENCH], { terrain: { frontY: 0, backY: 0.3 } }));
    expect(npcGroundY(nav, 0, 4.001)).toBeLessThan(0.01);
    expect(npcGroundY(nav, 0, 4.25)).toBeCloseTo(0.15, 2);
    expect(npcGroundY(nav, 0, 4.6)).toBeCloseTo(0.3, 5);
  });

  it('knows a walker fenced off outside, or outside with no lot left, is cut off', () => {
    const pen = [fence('n', 0, 6.4, 0, 3), fence('s', 0, 8.6, 0, 3), fence('w', -1.5, 7.5, Math.PI / 2, 2.4), fence('e', 1.5, 7.5, Math.PI / 2, 2.4)];
    const nav = gardenNav(house([BACK_DOOR, BENCH, ...pen]));
    expect(cutOffOutside(nav, 0, 8.1)).toBe(true);
    expect(cutOffOutside(nav, 3, 7.5)).toBe(false);
    expect(cutOffOutside(nav, 0, 0)).toBe(false);
    const noLot = gardenNav(house([BENCH]));
    expect(cutOffOutside(noLot, 0, 8.1)).toBe(true);
    expect(cutOffOutside(noLot, 0, 0)).toBe(false);
    const cell = nearestIndoorCell(nav, 0, 8.1);
    expect(isOutdoorCell(nav, cell)).toBe(false);
    expect(Math.abs(cellZ(nav, cell))).toBeLessThan(4);
  });

  it('the household counts the garden a walker reaches through a door', () => {
    const sofaLess = [BACK_DOOR, BENCH];
    expect(householdLacks(house(sofaLess))[0]!.lacks).not.toContain('energy');
    // No door, or the bench fenced off: nowhere to rest.
    expect(householdLacks(house([BENCH]))[0]!.lacks).toContain('energy');
    const pen = [fence('n', 0, 6.4, 0, 3), fence('s', 0, 8.6, 0, 3), fence('w', -1.5, 7.5, Math.PI / 2, 2.4), fence('e', 1.5, 7.5, Math.PI / 2, 2.4)];
    expect(householdLacks(house([...sofaLess, ...pen]))[0]!.lacks).toContain('energy');
    expect(new Set(reachableGardenSpots(house(sofaLess)).map((spot) => spot.itemId))).toEqual(new Set(['bench']));
  });
});

describe('cell numbering across the two grids (#913)', () => {
  it('cell centres round-trip on both grids', () => {
    const nav = gardenNav(house([BACK_DOOR, BENCH]));
    for (const [x, z] of [
      [0, 0],
      [0, 8.2],
      [-5, 6],
    ] as const) {
      const cell = cellAt(nav, x, z);
      expect(cellAt(nav, cellX(nav, cell), cellZ(nav, cell))).toBe(cell);
    }
  });
});

describe('things to do in the garden (#913)', () => {
  const picnic = makeItem({ id: 'picnic', type: 'picnic-table', name: 'Picnic Table', category: 'outdoor', width: 1.8, depth: 1.4, height: 0.75, position: { x: -3, z: 8 } });
  const bbq = makeItem({ id: 'bbq', type: 'bbq', name: 'BBQ Grill', category: 'outdoor', width: 0.8, depth: 0.6, height: 1.1, position: { x: 3, z: 7 }, rotation: Math.PI });
  const pool = makeItem({ id: 'pool', type: 'pool', name: 'Swimming Pool', category: 'outdoor', width: 4, depth: 2.5, height: 0.1, position: { x: 2, z: -8 } });

  it('a picnic table seats two along each bench, facing the table, come at from outside the bench', () => {
    const seats = findGardenSeats([picnic]);
    expect(seats).toHaveLength(4);
    expect(new Set(seats.map((seat) => seat.key)).size).toBe(4);
    for (const seat of seats) {
      expect(seat.places).toBe(4);
      expect(seat.seatHeight).toBeCloseTo(0.75 * 0.55 + 0.03, 6);
      // On a bench, 0.56 m off the table's long axis.
      expect(Math.abs(seat.z - 8)).toBeCloseTo(0.56, 6);
      // Facing the table: toward its axis.
      expect(Math.cos(seat.rotation) * (8 - seat.z)).toBeGreaterThan(0);
      // Coming in from outside the table's footprint.
      expect(Math.abs(seat.approachZ - 8)).toBeGreaterThan(0.7);
    }
    expect(findGardenSeats([{ ...picnic, rotation: Math.PI / 2 }]).every((seat) => Math.abs(seat.x + 3) > 0.5)).toBe(true);
  });

  it('the barbecue, the pool and the picnic table are fun; spots stand clear and face the thing', () => {
    const items = [BACK_DOOR, picnic, bbq, pool];
    const nav = gardenNav(house(items));
    const seats = [...findNpcSeats(items), ...findGardenSeats(items)];
    const spots = findGardenSpots(items, seats);
    const byItem = (id: string) => spots.filter((spot) => spot.itemId === id);
    expect(byItem('bbq')).toHaveLength(1);
    expect(byItem('pool')).toHaveLength(2);
    expect(byItem('picnic')).toHaveLength(4);
    expect(spots.every((spot) => spot.need === 'fun')).toBe(true);
    const [grill] = byItem('bbq');
    // The barbecue faces −z (rotation π): its front is toward the house.
    expect(grill!.z).toBeLessThan(7);
    expect(Math.cos(grill!.heading) * (7 - grill!.z)).toBeGreaterThan(0);
    for (const spot of [...byItem('bbq'), ...byItem('pool'), ...byItem('picnic')]) {
      expect(isFreeAt(nav, spot.x, spot.z)).toBe(true);
      expect(nav.region[cellAt(nav, spot.x, spot.z)]).toBe(nav.region[cellAt(nav, 0, 0)]);
    }
  });

  it('the household has something to do when the barbecue, the pool or the picnic table is through a door', () => {
    for (const thing of [picnic, bbq, pool]) {
      expect(householdLacks(house([BACK_DOOR, thing]))[0]!.lacks).not.toContain('fun');
      expect(householdLacks(house([thing]))[0]!.lacks).toContain('fun');
    }
  });

  it('none of it while the garden is closed', () => {
    const items = [BACK_DOOR, picnic, bbq];
    const nav = gardenNav(house(items));
    const seats = findGardenSeats(items);
    const spots = findGardenSpots(items, seats);
    const closed = indoorOnly(nav, new Map(seats.map((seat) => [seat.key, seat])), spots);
    expect(closed.spots).toHaveLength(0);
    expect(closed.seats.size).toBe(0);
  });
});
