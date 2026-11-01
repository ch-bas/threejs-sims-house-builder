import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { draggedZoneRect } from '../canvas-2d/plan-edit';
import { layoutReducer, type LayoutState } from '../hooks/layout-reducer';
import { buildRoom } from '../three/room-builder';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { fitFloorsToCutout, zonesInCorner } from './cutout';
import { floorKeepOut } from './floor-keep-out';
import { buildingArea, footprintOutline, isInsideBuilding } from './footprint';
import { floorRooms, ringArea } from './room-detect';
import { planRoomStamp, snapStampCentre, stampPlacement, type RoomStampSpec, type StampContext } from './room-stamp';
import { parseStoredLayout } from './schema';
import { dragWalls, footprintEdges, planWallMove } from './wall-edit';
import { reachInLot, snapWallEndpoint, wallEndAtLength } from './wall-snap';
import {
  clampZoneRect,
  refitZonesToRooms,
  roomsToName,
  zoneFloorPatches,
  zoneFromCorners,
  zoneFromRoom,
  zoneShapeFits,
} from './zones';
import type { FloorLayout, FootprintCutout, InteriorWall, RoomLayout, RoomZone, Vec2 } from './types';

// A 10 x 8 house with its north-east corner cut: the notch is x 1..5, z -4..-1.
const cutout: FootprintCutout = { corner: 'ne', width: 4, depth: 3 };
const notch = { x0: 1, x1: 5, z0: -4, z1: -1 };
const size = { width: 10, height: 8 };
const lHouse = (floor: Partial<FloorLayout> = {}): RoomLayout =>
  makeLayout({ ...size, cutout, roof: { style: 'flat', color: '#555555' }, floors: [makeFloor({ id: 'g', ...floor })] });
const stateOf = (layout: RoomLayout): LayoutState => ({ layout, activeFloorIndex: 0 });
const snap = (point: Vec2, extra: Partial<Parameters<typeof snapWallEndpoint>[0]> = {}) =>
  snapWallEndpoint({ point, existingWalls: [], roomWidth: 10, roomDepth: 8, cutout, ...extra });
const onBuilding = (point: Vec2): boolean => isInsideBuilding({ ...size, cutout }, point.x, point.z);

// A partition across the south wing: the room above it is an L of its own.
const across: InteriorWall = { id: 'p', x1: -5, z1: 2, x2: 5, z2: 2 };

describe('drawing a wall on an L (#727)', () => {
  it('keeps every end out of the corner', () => {
    expect(onBuilding(snap({ x: 3, z: -2 }).point)).toBe(true);
    expect(onBuilding(snap({ x: 3, z: -2 }, { free: true }).point)).toBe(true);
    expect(snap({ x: 1.2, z: -3 }, { free: true }).point).toEqual({ x: 1, z: -3 });
    expect(snap({ x: 3, z: -1.2 }, { free: true }).point).toEqual({ x: 3, z: -1 });
  });

  it('snaps to the inner corner and the two notch walls', () => {
    expect(snap({ x: 1.2, z: -0.9 })).toEqual({ point: { x: 1, z: -1 }, kind: 'vertex' });
    expect(snap({ x: 0.8, z: -2.5 })).toEqual({ point: { x: 1, z: -2.5 }, kind: 'on-wall' });
    expect(snap({ x: 3, z: -0.8 })).toEqual({ point: { x: 3, z: -1 }, kind: 'on-wall' });
    // The ends the cut gave the old north and east walls.
    expect(snap({ x: 1.1, z: -3.9 }).point).toEqual({ x: 1, z: -4 });
    expect(snap({ x: 4.9, z: -1.1 }).point).toEqual({ x: 5, z: -1 });
  });

  it('no longer offers the corner that was cut, nor the shell inside it', () => {
    expect(snap({ x: 4.9, z: -3.9 }).point).not.toEqual({ x: 5, z: -4 });
    expect(onBuilding(snap({ x: 4.9, z: -3.9 }).point)).toBe(true);
    expect(snap({ x: 3, z: -3.9 }).kind).not.toBe('on-wall');
  });

  it('a chained wall stops at a notch wall', () => {
    const { point } = snap({ x: 3, z: -3 }, { fromPoint: { x: 3, z: 3 } });
    expect(point).toEqual({ x: 3, z: -1 });
    const sideways = snap({ x: 4, z: -2 }, { fromPoint: { x: -3, z: -2 } });
    expect(sideways.point).toEqual({ x: 1, z: -2 });
  });

  it('measures the reach to a notch wall, and past the notch when the ray misses it', () => {
    expect(reachInLot({ x: 3, z: 3 }, 0, -1, 5, 4, notch)).toBe(4);
    expect(reachInLot({ x: -3, z: 3 }, 0, -1, 5, 4, notch)).toBe(7);
    // Running along a notch wall isn't entering it.
    expect(reachInLot({ x: 1, z: 3 }, 0, -1, 5, 4, notch)).toBe(7);
    expect(reachInLot({ x: 3, z: -1 }, 0, -1, 5, 4, notch)).toBe(0);
  });

  it('a typed length that would cross or enter the corner is refused', () => {
    expect(wallEndAtLength({ x: 3, z: 3 }, { x: 0, z: -1 }, 4, 10, 8, cutout)).toEqual({ x: 3, z: -1 });
    expect(wallEndAtLength({ x: 3, z: 3 }, { x: 0, z: -1 }, 4.5, 10, 8, cutout)).toBeNull();
    // Both ends on the house, the corner between them.
    expect(wallEndAtLength({ x: 0, z: -3 }, { x: 4, z: 3 }, 5, 10, 8, cutout)).toBeNull();
  });

  it('changes nothing on a rectangle', () => {
    const rect = { point: { x: 3.13, z: -3.87 }, existingWalls: [], roomWidth: 10, roomDepth: 8 };
    expect(snapWallEndpoint({ ...rect, cutout: undefined })).toEqual(snapWallEndpoint(rect));
    expect(snapWallEndpoint(rect).point).toEqual({ x: 3.1, z: -4 });
  });
});

describe('moving a wall next to the notch (#727)', () => {
  const context = { roomWidth: 10, roomDepth: 8, cutout };
  const moveContext = { ...context, porch: null };
  const floor = (walls: InteriorWall[]): FloorLayout => makeFloor({ id: 'g', interiorWalls: walls });

  it('the outline gives the shell its edges, the notch walls included', () => {
    const edges = footprintEdges(10, 8, cutout);
    expect(edges.map((edge) => edge.id)).toEqual(['north', 'east', 'south', 'west', 'notch-x', 'notch-z']);
    expect(edges.find((edge) => edge.id === 'north')).toMatchObject({ x1: -5, x2: 1 });
    expect(edges.find((edge) => edge.id === 'notch-z')).toMatchObject({ side: 'east', x1: 1, x2: 1 });
    expect(footprintEdges(10, 8).map((edge) => edge.id)).toEqual(['north', 'east', 'south', 'west']);
  });

  it('a slide stops a grid step short of a notch wall it would land on', () => {
    const wall: InteriorWall = { id: 'w', x1: 0, z1: -4, x2: 0, z2: -1 };
    const walls = [wall];
    const next = dragWalls({ wallId: 'w', grip: 'body', at: { x: 0, z: -2 }, walls }, { x: 1, z: -2 }, context);
    expect(next?.[0]?.x1).toBeCloseTo(0.9);
    expect(next?.[0]?.x2).toBeCloseTo(0.9);
  });

  it('a wall hosted on the notch wall slides along it and holds past its end', () => {
    const wall: InteriorWall = { id: 'w', x1: 1, z1: -2, x2: -5, z2: -2 };
    const walls = [wall];
    const down = dragWalls({ wallId: 'w', grip: 'body', at: { x: -2, z: -2 }, walls }, { x: -2, z: -3 }, context);
    expect(down?.[0]).toMatchObject({ x1: 1, z1: -3, z2: -3 });
    expect(dragWalls({ wallId: 'w', grip: 'body', at: { x: -2, z: -2 }, walls }, { x: -2, z: 0 }, context)).toBeNull();
  });

  it('a free end stops at the notch', () => {
    const wall: InteriorWall = { id: 'w', x1: 2, z1: 1, x2: 4, z2: 1 };
    const walls = [wall];
    const next = dragWalls({ wallId: 'w', grip: 'body', at: { x: 3, z: 1 }, walls }, { x: 3, z: -3 }, context);
    expect(next?.[0]).toMatchObject({ z1: -1, z2: -1 });
  });

  it('dragging an end into the corner leaves it on a notch wall', () => {
    const wall: InteriorWall = { id: 'w', x1: 3, z1: 3, x2: 3, z2: 1 };
    const walls = [wall];
    const next = dragWalls({ wallId: 'w', grip: 'end', at: { x: 3, z: 1 }, walls }, { x: 3, z: -3 }, context);
    expect(next?.[0]).toMatchObject({ x2: 3, z2: -1 });
  });

  it('refuses a wall that would run through the corner or along a notch wall', () => {
    const wall: InteriorWall = { id: 'w', x1: 0, z1: 0, x2: 3, z2: 0 };
    const patch = (x1: number, z1: number, x2: number, z2: number) => [{ id: 'w', x1, z1, x2, z2 }];
    expect(planWallMove(floor([wall]), patch(0, -2, 3, -2), moveContext)).toEqual({ refusal: "A wall can't run through the corner: it's outside the house." });
    expect(planWallMove(floor([wall]), patch(2, -1, 4, -1), moveContext)).toHaveProperty('refusal');
    expect(planWallMove(floor([wall]), patch(0, 1, 3, 1), moveContext)).not.toHaveProperty('refusal');
  });

  it('the reducer holds to the same rule, and a colour survives a move', () => {
    const state = stateOf(lHouse({ interiorWalls: [{ id: 'w', x1: 0, z1: 0, x2: 3, z2: 0, color: '#111111', colorB: '#222222' }] }));
    expect(layoutReducer(state, { type: 'updateInteriorWalls', walls: [{ id: 'w', x1: 0, z1: -2, x2: 3, z2: -2 }] })).toBe(state);
    const moved = layoutReducer(state, { type: 'updateInteriorWalls', walls: [{ id: 'w', x1: 0, z1: 1, x2: 3, z2: 1 }] });
    expect(moved.layout.floors[0]!.interiorWalls![0]).toEqual({ id: 'w', x1: 0, z1: 1, x2: 3, z2: 1, color: '#111111', colorB: '#222222' });
  });

  it('a door on a moved wall settles on it, not through the notch', () => {
    const wall: InteriorWall = { id: 'w', x1: -2, z1: 0, x2: 3, z2: 0 };
    const door = makeItem({ id: 'd', type: 'door', position: { x: 2, z: 0 }, rotation: 0 });
    const plan = planWallMove(makeFloor({ id: 'g', interiorWalls: [wall], items: [door] }), [{ id: 'w', x1: -2, z1: 0.5, x2: 3, z2: 0.5 }], moveContext);
    expect(plan).toMatchObject({ items: [{ position: { x: 2, z: 0.5 } }] });
  });

  it('a door on a notch wall stays there when a wall beside it moves', () => {
    const wall: InteriorWall = { id: 'w', x1: -2, z1: 0, x2: 0, z2: 0 };
    const door = makeItem({ id: 'd', type: 'door', position: { x: 3, z: -1 }, rotation: 0 });
    const plan = planWallMove(makeFloor({ id: 'g', interiorWalls: [wall], items: [door] }), [{ id: 'w', x1: -2, z1: 0.5, x2: 0, z2: 0.5 }], moveContext);
    expect(plan).toMatchObject({ items: [{ position: { x: 3, z: -1 } }] });
  });

  it('a picture nearer the notch wall than the partition hangs on the house, not the partition', () => {
    const wall: InteriorWall = { id: 'w', x1: 0.2, z1: -4, x2: 0.2, z2: -1 };
    const picture = makeItem({ id: 'pic', type: 'wall-art', name: 'Art', width: 0.5, depth: 0.05, position: { x: 0.92, z: -2 }, rotation: 0 });
    const plan = planWallMove(makeFloor({ id: 'g', interiorWalls: [wall], items: [picture] }), [{ id: 'w', x1: 0, z1: -4, x2: 0, z2: -1 }], moveContext);
    expect(plan).toMatchObject({ items: [{ position: { x: 0.92, z: -2 } }] });
  });
});

describe('the room stamp at the notch (#727)', () => {
  const context: StampContext = { existingWalls: [], roomWidth: 10, roomDepth: 8, porch: null, cutout };
  const spec: RoomStampSpec = { shape: 'rectangle', width: 3, depth: 2 };

  it('steps out of the corner the shorter way', () => {
    expect(snapStampCentre({ x: 1.2, z: -2 }, 3, 2, context)).toEqual({ x: -0.5, z: -2 });
    expect(snapStampCentre({ x: 3, z: -1.5 }, 3, 2, context)).toEqual({ x: 3, z: 0 });
  });

  it('catches its edges on the notch walls', () => {
    const centre = snapStampCentre({ x: -0.3, z: 1 }, 3, 2, context);
    expect(centre.x).toBe(-0.5);
    expect(snapStampCentre({ x: 3, z: 0.2 }, 3, 2, context).z).toBe(0);
  });

  it('adds no wall along a notch wall the room stands on', () => {
    const placement = { centerX: 3, centerZ: 0, width: 4, depth: 2 };
    const plan = planRoomStamp(spec, placement, context, 'r');
    expect(plan.refusal).toBeNull();
    expect(plan.walls.some((wall) => wall.z1 === -1 && wall.z2 === -1)).toBe(false);
    expect(plan.walls.some((wall) => wall.x1 === 5 && wall.x2 === 5)).toBe(false);
    expect(plan.walls.length).toBe(2);
  });

  it('a hidden side leaves its notch wall to be built', () => {
    const placement = { centerX: 3, centerZ: 0, width: 4, depth: 2 };
    const plan = planRoomStamp(spec, placement, { ...context, hiddenWalls: ['north'] }, 'r');
    expect(plan.walls.some((wall) => wall.z1 === -1 && wall.z2 === -1)).toBe(true);
  });

  it('refuses a room dragged across the corner', () => {
    const placement = stampPlacement(spec, { x: -2, z: -3 }, { x: 4, z: 1 }, context);
    const plan = planRoomStamp(spec, placement, context, 'r');
    expect(plan.refusal).toBe("A room can't cross the corner: it's outside the house.");
  });

  it('a drag from a notch wall keeps its corner on the wall', () => {
    const placement = stampPlacement(spec, { x: 2, z: -0.9 }, { x: 4, z: 1 }, context);
    expect(placement).toMatchObject({ centerX: 3, centerZ: 0, width: 2, depth: 2 });
  });
});

describe('rooms and zones on an L (#727)', () => {
  it('finds the L as the storey outline, with no sliver along the notch', () => {
    const rooms = floorRooms(lHouse({ interiorWalls: [across] }), 0);
    expect(rooms.map((room) => room.area).sort((a, b) => a - b)).toEqual([20, buildingArea({ ...size, cutout }) - 20]);
    expect(rooms.find((room) => room.area === 48)?.outline).toHaveLength(6);
  });

  it('offers a room of the L, and the reducer takes it whole', () => {
    const layout = lHouse({ interiorWalls: [across] });
    const room = roomsToName(layout, 0).find((entry) => entry.area === 48)!;
    expect(room).toBeDefined();
    const next = layoutReducer(stateOf(layout), { type: 'addZone', zone: { id: 'z', ...zoneFromRoom(room, 'Hall', '#3b82f6') } });
    expect(next.layout.floors[0]!.zones?.[0]?.outline).toEqual(room.outline);
  });

  it('refuses a polygon that stands in the corner', () => {
    const layout = lHouse();
    const state = stateOf(layout);
    const zone: RoomZone = { id: 'z', name: 'Z', color: '#000000', x: 0, z: -3, w: 3, d: 3, outline: [{ x: 0, z: -3 }, { x: 3, z: -3 }, { x: 3, z: 0 }, { x: 0, z: 0 }] };
    expect(layoutReducer(state, { type: 'addZone', zone })).toBe(state);
  });

  it('a polygon whose corners are all on the house but whose side crosses the notch does not fit', () => {
    const footprint = footprintOutline({ ...size, cutout });
    const triangle: Vec2[] = [{ x: 0, z: -3 }, { x: 4, z: 0 }, { x: 0, z: 0 }];
    expect(zoneShapeFits({ x: 0, z: -3, w: 4, d: 3, outline: triangle }, footprint)).toBe(false);
    const inside: Vec2[] = [{ x: 0, z: -3 }, { x: 1, z: -1 }, { x: 4, z: 0 }, { x: 0, z: 0 }];
    expect(zoneShapeFits({ x: 0, z: -3, w: 4, d: 3, outline: inside }, footprint)).toBe(true);
  });

  it('a polygon zone in an L survives a reload as the same shape, with its detected room', () => {
    const layout = lHouse({ interiorWalls: [across] });
    const room = floorRooms(layout, 0).find((entry) => entry.area === 48)!;
    const zone: RoomZone = { id: 'z', ...zoneFromRoom(room, 'Hall', '#3b82f6'), floorColor: '#aa0000' };
    const saved = { ...layout, floors: [{ ...layout.floors[0]!, zones: [zone] }] };
    const loaded = parseStoredLayout(JSON.parse(JSON.stringify(saved)));
    expect(loaded?.cutout).toEqual(cutout);
    expect(loaded?.floors[0]?.interiorWalls).toEqual([across]);
    expect(loaded?.floors[0]?.zones).toEqual([zone]);
    expect(roomsToName(loaded!, 0).map((entry) => entry.area)).toEqual([20]);
  });

  it('a zone from a bad file comes back in the house, and garbage in `cutout` costs only the cut', () => {
    const zone: RoomZone = { id: 'z', name: 'Z', color: '#000000', x: 0, z: -3, w: 3, d: 4, outline: [{ x: 0, z: -3 }, { x: 3, z: -3 }, { x: 3, z: 1 }, { x: 0, z: 1 }] };
    const loaded = parseStoredLayout(JSON.parse(JSON.stringify(lHouse({ zones: [zone] }))));
    const [fitted] = loaded!.floors[0]!.zones!;
    expect(fitted!.outline).toBeUndefined();
    expect(fitted).toMatchObject({ x: 0, z: -1, w: 3, d: 2 });
    const garbage = parseStoredLayout(JSON.parse(JSON.stringify({ ...lHouse({ zones: [zone] }), cutout: { corner: 'up', width: 'x' } })));
    expect(garbage?.cutout).toBeUndefined();
    expect(garbage?.floors[0]?.zones?.[0]?.outline).toHaveLength(4);
  });

  it('fits a polygon zone a loaded file left across the corner, by clipping it to the floor', () => {
    const layout = lHouse({ interiorWalls: [across] });
    const outline = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 2 }, { x: -5, z: 2 }];
    const zone: RoomZone = { id: 'z', name: 'Z', color: '#000000', x: -5, z: -4, w: 10, d: 6, outline };
    const fitted = fitFloorsToCutout({ ...layout, floors: [{ ...layout.floors[0]!, zones: [zone] }] });
    const after = fitted.floors[0]!.zones![0]!;
    expect(after.outline).toHaveLength(6);
    expect(ringArea(after.outline!)).toBeCloseTo(48);
    expect(zoneShapeFits(after, footprintOutline({ ...size, cutout }))).toBe(true);
  });

  it('a cut through a polygon zone clips it, and one Undo brings the shape back', () => {
    const plain = makeLayout({ ...size, roof: { style: 'flat', color: '#555555' }, floors: [makeFloor({ id: 'g', interiorWalls: [across] })] });
    const room = floorRooms(plain, 0).find((entry) => entry.area === 60)!;
    const zone: RoomZone = { id: 'z', ...zoneFromRoom(room, 'Hall', '#3b82f6') };
    const before = stateOf({ ...plain, floors: [{ ...plain.floors[0]!, zones: [zone] }] });
    const cut = layoutReducer(before, { type: 'setCutout', cutout });
    const after = cut.layout.floors[0]!.zones![0]!;
    expect(after).toMatchObject({ id: 'z', name: 'Hall', x: -5, z: -4, w: 10, d: 6 });
    expect(after.outline).toHaveLength(6);
    expect(ringArea(after.outline!)).toBeCloseTo(48);
    expect(zoneShapeFits(after, footprintOutline(cut.layout))).toBe(true);
    // Reload holds it; Undo is the old layout through applyLayout.
    expect(parseStoredLayout(JSON.parse(JSON.stringify(cut.layout)))?.floors[0]?.zones).toEqual([after]);
    const undone = layoutReducer(cut, { type: 'applyLayout', layout: before.layout });
    expect(undone.layout.floors[0]!.zones).toEqual([zone]);
  });

  it('a polygon zone wholly in the corner goes, and a rectangle beside it stays', () => {
    const plain = makeLayout({
      ...size,
      roof: { style: 'flat', color: '#555555' },
      floors: [makeFloor({ id: 'g', interiorWalls: [{ id: 'a', x1: 1, z1: -4, x2: 1, z2: -1 }, { id: 'b', x1: 1, z1: -1, x2: 5, z2: -1 }] })],
    });
    const corner = floorRooms(plain, 0).find((entry) => entry.area === 12)!;
    const zone: RoomZone = { id: 'z', ...zoneFromRoom(corner, 'Study', '#3b82f6') };
    const rect: RoomZone = { id: 'r', name: 'R', color: '#000000', x: -4, z: 0, w: 2, d: 2 };
    const state = stateOf({ ...plain, floors: [{ ...plain.floors[0]!, zones: [zone, rect] }] });
    const cut = layoutReducer(state, { type: 'setCutout', cutout });
    expect(cut.layout.floors[0]!.zones).toEqual([rect]);
  });

  it('a cut that goes changes the polygon back with its room', () => {
    const layout = lHouse({ interiorWalls: [across] });
    const room = floorRooms(layout, 0).find((entry) => entry.area === 48)!;
    const state = stateOf({ ...layout, floors: [{ ...layout.floors[0]!, zones: [{ id: 'z', ...zoneFromRoom(room, 'Hall', '#3b82f6') }] }] });
    const filled = layoutReducer(state, { type: 'setCutout', cutout: null });
    expect(ringArea(filled.layout.floors[0]!.zones![0]!.outline!)).toBeCloseTo(60);
  });

  it('a resize keeps a polygon on the new L', () => {
    const layout = lHouse({ interiorWalls: [across] });
    const room = floorRooms(layout, 0).find((entry) => entry.area === 48)!;
    const state = stateOf({ ...layout, floors: [{ ...layout.floors[0]!, zones: [{ id: 'z', ...zoneFromRoom(room, 'Hall', '#3b82f6') }] }] });
    const next = layoutReducer(state, { type: 'setWidth', width: 12 });
    const footprint = footprintOutline(next.layout);
    for (const zone of next.layout.floors[0]!.zones ?? []) expect(zoneShapeFits(zone, footprint)).toBe(true);
  });

  it('a room left with no home falls back into the L, not onto the notch', () => {
    const outline = [{ x: 0, z: -3 }, { x: 3, z: -3 }, { x: 3, z: 1 }, { x: 0, z: 1 }];
    const zone: RoomZone = { id: 'z', name: 'Z', color: '#000000', x: 0, z: -3, w: 3, d: 4, outline };
    const [fitted] = refitZonesToRooms([zone], [], footprintOutline({ ...size, cutout }), 10, 8, cutout);
    expect(fitted).toMatchObject({ x: 0, z: -1, w: 3, d: 2 });
    expect(fitted!.outline).toBeUndefined();
  });

  it('a finish on a zone keeps out of the notch', () => {
    const layout = lHouse();
    const zone: RoomZone = { id: 'z', name: 'Z', color: '#000000', x: -5, z: -4, w: 10, d: 8, floorColor: '#aa0000', outline: footprintOutline({ width: 10, height: 8 }) };
    const [patch] = zoneFloorPatches({ ...layout.floors[0]!, zones: [zone] }, floorKeepOut(layout, 0));
    expect(patch!.regions).toHaveLength(1);
    expect(patch!.regions[0]!.area).toBeCloseTo(48 + 20);
  });

  it('a zone floor on an L runs the room-wide tile grid, as the slab does', () => {
    const layout = lHouse({ interiorWalls: [across] });
    const room = floorRooms(layout, 0).find((entry) => entry.area === 48)!;
    const zone: RoomZone = { id: 'z', ...zoneFromRoom(room, 'Hall', '#3b82f6'), floorColor: '#aa0000' };
    const scene = new THREE.Scene();
    buildRoom(THREE, {
      scene,
      width: 10,
      depth: 8,
      cutout,
      floorColor: '#cccccc',
      floorPlanImage: null,
      floorPlanOpacity: 1,
      floorPlanFitMode: 'stretch',
      floorPlan3DEffect: false,
      zonePatches: zoneFloorPatches({ ...layout.floors[0]!, zones: [zone] }, floorKeepOut(layout, 0)),
    });
    const mesh = scene.getObjectByName('Floor z') as THREE.Mesh;
    const position = mesh.geometry.getAttribute('position');
    const uv = mesh.geometry.getAttribute('uv');
    for (let i = 0; i < position.count; i++) {
      expect(uv.getX(i)).toBeCloseTo(position.getX(i) / 10 + 0.5);
      expect(uv.getY(i)).toBeCloseTo(position.getY(i) / 8 + 0.5);
    }
  });
});

describe('rectangle zones on an L (#727)', () => {
  it('a corner near a notch wall lands on it, and a re-fit changes nothing', () => {
    const off: FootprintCutout = { corner: 'ne', width: 3.75, depth: 3 }; // notch from x 1.25
    const rect = zoneFromCorners({ x: -2, z: -3 }, { x: 1.27, z: 0 }, 10, 8, off);
    expect(rect).toMatchObject({ x: -2, z: -3 });
    expect(rect!.x + rect!.w).toBe(1.25);
    expect(clampZoneRect(rect!, 10, 8, off)).toEqual(rect);
  });

  it('drawn across the corner, keeps its larger part; drawn inside it, nothing', () => {
    expect(zoneFromCorners({ x: -2, z: -3 }, { x: 3, z: 3 }, 10, 8, cutout)).toEqual({ x: -2, z: -1, w: 5, d: 4 });
    expect(zoneFromCorners({ x: 2, z: -3 }, { x: 4, z: -2 }, 10, 8, cutout)).toBeNull();
    expect(zoneFromCorners({ x: 2, z: -3 }, { x: 4, z: -2 }, 10, 8)).not.toBeNull();
  });

  it('a move stops at the notch and keeps its size', () => {
    const origin = { x: -2, z: -3, w: 2, d: 2 };
    const moved = draggedZoneRect(origin, 'move', 2.5, 0, 10, 8, null, cutout);
    expect(moved).toEqual({ x: -1, z: -3, w: 2, d: 2 });
  });

  it('a resize stops at the notch wall, the other sides staying', () => {
    const origin = { x: -2, z: -3, w: 2, d: 2 };
    expect(draggedZoneRect(origin, 'e', 3, 0, 10, 8, null, cutout)).toEqual({ x: -2, z: -3, w: 3, d: 2 });
    const south = { x: 2, z: 1, w: 2, d: 2 };
    expect(draggedZoneRect(south, 'n', 0, -4, 10, 8, null, cutout)).toEqual({ x: 2, z: -1, w: 2, d: 4 });
  });

  it('the reducer stores what the gesture showed', () => {
    const state = stateOf(lHouse());
    const rect = zoneFromCorners({ x: -2, z: -3 }, { x: 3, z: 3 }, 10, 8, cutout)!;
    const added = layoutReducer(state, { type: 'addZone', zone: { id: 'z', name: 'Z', color: '#000000', x: -2, z: -3, w: 5, d: 6 } });
    expect(added.layout.floors[0]!.zones![0]).toMatchObject(rect);
    const refused = layoutReducer(state, { type: 'addZone', zone: { id: 'y', name: 'Y', color: '#000000', x: 2, z: -3, w: 2, d: 1 } });
    expect(refused).toBe(state);
  });
});

describe('resizing an L with polygon zones (#727)', () => {
  it('a smaller house keeps each room a polygon', () => {
    const layout = lHouse({ interiorWalls: [across] });
    const room = floorRooms(layout, 0).find((entry) => entry.area === 48)!;
    const state = stateOf({ ...layout, floors: [{ ...layout.floors[0]!, zones: [{ id: 'z', ...zoneFromRoom(room, 'Hall', '#3b82f6') }] }] });
    const next = layoutReducer(state, { type: 'setWidth', width: 8 });
    const zone = next.layout.floors[0]!.zones![0]!;
    expect(zone.outline).toHaveLength(6);
    expect(zoneShapeFits(zone, footprintOutline(next.layout))).toBe(true);
    expect(ringArea(zone.outline!)).toBeCloseTo(8 * 6 - 12);
  });

  it('a polygon with no room left falls back to its rectangle, inside the L', () => {
    const outline = [{ x: 3, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 2 }, { x: 3, z: 2 }];
    const state = stateOf(lHouse({ zones: [{ id: 'z', name: 'Z', color: '#000000', x: 3, z: 0, w: 2, d: 2, outline }] }));
    const next = layoutReducer(state, { type: 'setWidth', width: 8 });
    const zone = next.layout.floors[0]!.zones?.[0];
    if (zone) expect(zoneShapeFits(zone, footprintOutline(next.layout))).toBe(true);
    if (zone) expect(zone.x + zone.w).toBeLessThanOrEqual(4);
  });
});

describe('a zone beside a notch line on load (#727)', () => {
  const off: FootprintCutout = { corner: 'ne', width: 3.75, depth: 3 }; // notch from x 1.25
  const stored = (zone: RoomZone) => parseStoredLayout(JSON.parse(JSON.stringify(makeLayout({ ...size, cutout: off, roof: { style: 'flat', color: '#555555' }, floors: [makeFloor({ id: 'g', zones: [zone] })] }))))!;

  it('a rectangle clear of the notch comes back as stored, whatever its edges', () => {
    for (const w of [3.2, 3.22, 2.9]) {
      const zone: RoomZone = { id: 'z', name: 'Z', color: '#000000', x: -2, z: -3, w, d: 2 };
      expect(stored(zone).floors[0]!.zones).toEqual([zone]);
    }
  });

  it('an edge exactly 5 cm from the line stays on the grid through an edit', () => {
    expect(clampZoneRect({ x: -2, z: -3, w: 3.2, d: 2 }, 10, 8, off)).toEqual({ x: -2, z: -3, w: 3.2, d: 2 });
  });
});

describe('the notice for a cut (#727)', () => {
  it('counts the zones wholly in the corner, on every storey, and only those', () => {
    const inCorner: RoomZone = { id: 'gone', name: 'Gone', color: '#000000', x: 2, z: -3, w: 2, d: 1 };
    const across: RoomZone = { id: 'kept', name: 'Kept', color: '#000000', x: 0, z: -3, w: 3, d: 4 };
    const layout = makeLayout({ ...size, floors: [makeFloor({ id: 'g', zones: [inCorner, across] }), makeFloor({ id: 'u', zones: [inCorner] })] });
    expect(zonesInCorner(layout, cutout).map((zone) => zone.id)).toEqual(['gone', 'gone']);
  });
});
