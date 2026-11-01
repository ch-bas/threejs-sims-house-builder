import { describe, expect, it } from 'vitest';
import { layoutReducer, type LayoutState } from '../hooks/layout-reducer';
import { makeFloor, makeLayout } from './__testfixtures__/fixtures';
import { floorRooms, ringArea } from './room-detect';
import { zoneFromRoom } from './zones';
import type { InteriorWall, RoomZone } from './types';

const wallAt = (x: number, depth: number): InteriorWall => ({ id: 'w', x1: x, z1: -depth / 2, x2: x, z2: depth / 2 });

/** A house split by a wall at `x`, with zones on the rooms `named` picks. */
function house(width: number, depth: number, x: number, named: 'left' | 'both'): LayoutState {
  const wall = wallAt(x, depth);
  const plain = makeLayout({ width, height: depth, floors: [makeFloor({ id: 'g', interiorWalls: [wall] })] });
  const rooms = [...floorRooms(plain, 0)].sort((a, b) => a.anchor.x - b.anchor.x);
  const zones: RoomZone[] = rooms
    .slice(0, named === 'left' ? 1 : 2)
    .map((room, index) => ({ id: index === 0 ? 'a' : 'b', ...zoneFromRoom(room, index === 0 ? 'A' : 'B', '#3b82f6'), floorPattern: 'tile' }));
  return { layout: { ...plain, floors: [{ ...plain.floors[0]!, zones }] }, activeFloorIndex: 0 };
}

const moveTo = (state: LayoutState, x: number, depth: number): LayoutState =>
  layoutReducer(state, { type: 'updateInteriorWalls', walls: [wallAt(x, depth)] });
const zoneNamed = (state: LayoutState, id: string): RoomZone => state.layout.floors[0]!.zones!.find((zone) => zone.id === id)!;

describe('a zone and the wall that moved (#719)', () => {
  it('stays on its side when the wall comes in and the neighbour has no zone', () => {
    const zone = zoneNamed(moveTo(house(10, 8, 1, 'left'), -3, 8), 'a');
    expect(zone).toMatchObject({ x: -5, w: 2, d: 8, floorPattern: 'tile' });
    expect(ringArea(zone.outline!)).toBeCloseTo(16);
  });

  it('grows with its room when the wall goes out and the neighbour has no zone', () => {
    const zone = zoneNamed(moveTo(house(10, 8, -3, 'left'), 1, 8), 'a');
    expect(zone).toMatchObject({ x: -5, w: 6, d: 8 });
    expect(ringArea(zone.outline!)).toBeCloseTo(48);
  });

  it('two zones keep their sides, however far the wall goes', () => {
    const next = moveTo(house(6, 6, -2, 'both'), 2, 6);
    expect(zoneNamed(next, 'a')).toMatchObject({ x: -3, w: 5 });
    expect(zoneNamed(next, 'b')).toMatchObject({ x: 2, w: 1 });
  });

  it('a zone the wall swept whole still has a home', () => {
    const state = house(10, 8, 1, 'both');
    const narrow = moveTo(state, 4, 8);
    const next = moveTo(narrow, -2, 8);
    expect(zoneNamed(next, 'b').outline).toBeDefined();
    expect(zoneNamed(next, 'a').outline).toBeDefined();
  });

  it('a resize is no wall move: two zones keep their outlines', () => {
    const across: InteriorWall = { id: 'w', x1: -3, z1: 0, x2: 3, z2: 0 };
    const plain = makeLayout({ width: 6, height: 6, floors: [makeFloor({ id: 'g', interiorWalls: [across] })] });
    const zones = floorRooms(plain, 0).map((room, index): RoomZone => ({ id: `z${index}`, ...zoneFromRoom(room, `Z${index}`, '#3b82f6') }));
    const state = { layout: { ...plain, floors: [{ ...plain.floors[0]!, zones }] }, activeFloorIndex: 0 };
    const next = layoutReducer(state, { type: 'setWidth', width: 8 });
    expect(next.layout.floors[0]!.zones!.map((zone) => zone.outline !== undefined)).toEqual([true, true]);
  });

  it('a lone zone takes no unnamed neighbour when a wall comes down', () => {
    const state = house(10, 8, -3, 'left');
    const next = layoutReducer(state, { type: 'removeInteriorWall', id: 'w' });
    expect(zoneNamed(next, 'a')).toMatchObject({ x: -5, w: 2 });
  });
});
