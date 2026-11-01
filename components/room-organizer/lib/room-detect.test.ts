import { describe, expect, it } from 'vitest';
import { footprintOutline } from './footprint';
import { detectRooms, floorRooms, hasTooManyWalls, MAX_ROOM_WALLS, ringArea } from './room-detect';
import type { KeepOutRect } from './geometry';
import type { FloorLayout, InteriorWall, Vec2 } from './types';

/** A 10 × 8 m house: x from -5 to 5, z from -4 to 4. */
const house = footprintOutline({ width: 10, height: 8 });

let nextWall = 0;
function wall(x1: number, z1: number, x2: number, z2: number): InteriorWall {
  nextWall += 1;
  return { id: `w${nextWall}`, x1, z1, x2, z2 };
}

function box(x0: number, z0: number, x1: number, z1: number): InteriorWall[] {
  return [wall(x0, z0, x1, z0), wall(x1, z0, x1, z1), wall(x1, z1, x0, z1), wall(x0, z1, x0, z0)];
}

function areas(walls: readonly InteriorWall[], outline: readonly Vec2[] = house, keepOut: readonly KeepOutRect[] = []): number[] {
  return detectRooms(walls, outline, keepOut)
    .map((room) => Number(room.area.toFixed(3)))
    .sort((a, b) => a - b);
}

describe('detectRooms (#719)', () => {
  it('sees an empty storey as one room, the size of the footprint', () => {
    const rooms = detectRooms([], house, []);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.area).toBeCloseTo(80);
    expect(rooms[0]!.outline).toHaveLength(4);
  });

  it('splits the footprint along a wall that crosses it', () => {
    expect(areas([wall(0, -4, 0, 4)])).toEqual([40, 40]);
  });

  it('splits segments at T-junctions: a wall ending on the middle of another', () => {
    expect(areas([wall(0, -4, 0, 4), wall(0, 0, 5, 0)])).toEqual([20, 20, 40]);
  });

  it('splits at a crossing, with neither wall ending there', () => {
    expect(areas([wall(-5, 0, 5, 0), wall(0, -4, 0, 4)])).toEqual([20, 20, 20, 20]);
  });

  it('ignores a dangling wall: it closes nothing', () => {
    expect(areas([wall(0, -4, 0, 1)])).toEqual([80]);
    expect(areas([wall(1, 1, 3, 1)])).toEqual([80]);
  });

  it('a room with one wall left open is not a room', () => {
    const threeSides = [wall(-3, -2, -1, -2), wall(-1, -2, -1, 1), wall(-1, 1, -3, 1)];
    expect(areas(threeSides)).toEqual([80]);
    expect(areas([...threeSides, wall(-3, 1, -3, -2)])).toEqual([6, 74]);
  });

  it('closes a gap a wall thickness hides, but not a doorway-sized one', () => {
    expect(areas([wall(0, -3.97, 0, 3.97)])).toEqual([40, 40]);
    expect(areas([wall(0, -3.5, 0, 4)])).toEqual([80]);
  });

  it('gives a nested room a hole in the room around it', () => {
    const rooms = detectRooms(box(-1, -1, 1, 1), house, []);
    expect(rooms.map((room) => room.area).sort((a, b) => a - b)).toEqual([4, 76]);
    const outer = rooms.find((room) => room.area === 76)!;
    expect(outer.holes).toHaveLength(1);
    expect(ringArea(outer.holes![0]!)).toBeCloseTo(4);
    expect(rooms.find((room) => room.area === 4)!.holes).toBeUndefined();
  });

  it('still sees the nesting when a stub ties the inner box to the outer wall', () => {
    expect(areas([...box(-1, -1, 1, 1), wall(1, 0, 5, 0)])).toEqual([4, 76]);
  });

  it('makes an L-shaped room from two walls', () => {
    const rooms = detectRooms([wall(0, -4, 0, 0), wall(0, 0, 5, 0)], house, []);
    expect(rooms.map((room) => room.area).sort((a, b) => a - b)).toEqual([20, 60]);
    expect(rooms.find((room) => room.area === 60)!.outline).toHaveLength(6);
  });

  it('handles a diagonal wall', () => {
    expect(areas([wall(-5, 4, 5, -4)])).toEqual([40, 40]);
  });

  it('takes a keep-out shape off the room it bites into', () => {
    const porch: KeepOutRect = { x0: -1, x1: 1, z0: -4, z1: -3 };
    const rooms = detectRooms([], house, [porch]);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.area).toBeCloseTo(78);
    expect(rooms[0]!.outline).toHaveLength(8);
  });

  it('is not thrown by the porch wall running along the keep-out edge', () => {
    expect(areas([wall(-1, -3, 1, -3)], house, [{ x0: -1, x1: 1, z0: -4, z1: -3 }])).toEqual([78]);
  });

  it('holes a room around a keep-out in its middle, rotated or not', () => {
    const well: KeepOutRect = { x0: 0, x1: 2, z0: 0, z1: 1, hole: true };
    expect(areas([], house, [well])).toEqual([78]);
    const turned = detectRooms([], house, [{ ...well, rotation: Math.PI / 2 }]);
    expect(turned[0]!.area).toBeCloseTo(78);
    expect(turned[0]!.holes).toHaveLength(1);
    expect(turned[0]!.holes![0]!.some((p) => Math.abs(p.x - 1.5) < 1e-6)).toBe(true);
  });

  it('an L of two touching keep-out rects leaves one hole and no sliver', () => {
    const legs: KeepOutRect[] = [
      { x0: 0, x1: 2, z0: 0, z1: 1, hole: true },
      { x0: 1, x1: 2, z0: 1, z1: 2, hole: true },
    ];
    expect(areas([], house, legs)).toEqual([77]);
  });

  it('ignores the part of a keep-out outside the house', () => {
    expect(areas([], house, [{ x0: -1, x1: 1, z0: -6, z1: -3 }])).toEqual([78]);
  });

  it('walks any simple rectilinear outline, not just a rectangle', () => {
    const notched: Vec2[] = [
      { x: -5, z: -4 },
      { x: 1, z: -4 },
      { x: 1, z: 0 },
      { x: 5, z: 0 },
      { x: 5, z: 4 },
      { x: -5, z: 4 },
    ];
    expect(areas([], notched)).toEqual([64]);
    expect(areas([wall(-2, -4, -2, 4)], notched)).toEqual([24, 40]);
    expect(areas([wall(-2, 0, 1, 0)], notched)).toEqual([64]);
    // The same outline, wound the other way round.
    expect(areas([wall(-2, -4, -2, 4)], [...notched].reverse())).toEqual([24, 40]);
  });

  it('drops a sliver between two walls side by side', () => {
    expect(areas([wall(0, -4, 0, 4), wall(0.1, -4, 0.1, 4)])).toEqual([39.2, 40]);
  });

  it('does not depend on the order or direction of the walls', () => {
    const a = [wall(0, -4, 0, 4), wall(0, 0, 5, 0)];
    const b = [wall(5, 0, 0, 0), wall(0, 4, 0, -4)];
    expect(detectRooms(a, house, []).map((room) => room.area)).toEqual(detectRooms(b, house, []).map((room) => room.area));
  });

  it('puts the anchor inside its room, outside any hole', () => {
    const outer = detectRooms(box(-1, -1, 1, 1), house, []).find((room) => room.area === 76)!;
    expect(Math.abs(outer.anchor.x) > 1 || Math.abs(outer.anchor.z) > 1).toBe(true);
  });
});

describe('floorRooms (#719)', () => {
  const floor = (patch: Partial<FloorLayout>): FloorLayout => ({ id: 'f', name: 'F', items: [], floorColor: '#ccc', ...patch });

  it('reads the storey’s walls', () => {
    const rooms = floorRooms({ width: 10, height: 8, floors: [floor({ interiorWalls: [wall(0, -4, 0, 4)] })] }, 0);
    expect(rooms.map((room) => room.area)).toEqual([40, 40]);
  });

  it('is empty for a storey that does not exist', () => {
    expect(floorRooms({ width: 10, height: 8, floors: [floor({})] }, 3)).toEqual([]);
  });
});

describe('a floor past the wall cap', () => {
  const crossing = (count: number): InteriorWall[] =>
    Array.from({ length: count }, (_, i) => {
      const at = -19 + (i / count) * 38;
      return i % 2 ? { id: `v${i}`, x1: at, z1: -20, x2: at, z2: 20 } : { id: `h${i}`, x1: -20, z1: at, x2: 20, z2: at };
    });
  const building = (walls: InteriorWall[]) => ({ width: 40, height: 40, floors: [{ id: 'g', name: 'G', floorColor: '#ccc', items: [], interiorWalls: walls }] });

  it('finds the rooms at the cap, in good time', () => {
    const started = performance.now();
    expect(floorRooms(building(crossing(MAX_ROOM_WALLS)), 0).length).toBeGreaterThan(1000);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('returns at once past it, and says so', () => {
    const walls = crossing(998);
    const started = performance.now();
    expect(floorRooms(building(walls), 0)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(50);
    expect(hasTooManyWalls({ interiorWalls: walls })).toBe(true);
    expect(hasTooManyWalls({ interiorWalls: crossing(MAX_ROOM_WALLS) })).toBe(false);
  });
});
