import { describe, expect, it } from 'vitest';
import { layoutReducer, type LayoutState } from '../hooks/layout-reducer';
import { measureCpu } from './__testfixtures__/cpu-time';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { floorRooms, ringArea } from './room-detect';
import { pasteSpot, planRoomTransfer, roomArrangement, type RoomTransferResult, type RoomTransfer } from './room-transfer';
import { zoneFromRoom } from './zones';
import type { FloorLayout, FurnitureItem, InteriorWall, RoomLayout, RoomZone } from './types';

// A 10 × 8 house: x from -5 to 5, z from -4 to 4.
const W = 10;
const D = 8;

const wall = (id: string, x1: number, z1: number, x2: number, z2: number, extra: Partial<InteriorWall> = {}): InteriorWall => ({ id, x1, z1, x2, z2, ...extra });

/** A 2 × 2 box room in the middle of the floor, from (-1, -1) to (1, 1). */
const BOX: InteriorWall[] = [
  wall('n', -1, -1, 1, -1),
  wall('e', 1, -1, 1, 1),
  wall('s', 1, 1, -1, 1),
  wall('w', -1, 1, -1, -1),
];

/** A corner room in the north-west, 3 × 4, from (-5, -4) to (-2, 0). */
const CORNER: InteriorWall[] = [wall('cx', -2, -4, -2, 0), wall('cz', -5, 0, -2, 0)];

function house(floor: Partial<FloorLayout>, extra: Partial<RoomLayout> = {}): RoomLayout {
  return makeLayout({ width: W, height: D, floors: [makeFloor({ id: 'g', ...floor })], ...extra });
}

/** A polygon zone on the room at the point, as "Name this room" makes it. */
function zoneAt(layout: RoomLayout, x: number, z: number, id: string, name = id): RoomZone {
  const room = floorRooms(layout, 0).find((entry) => entry.anchor && Math.abs(entry.anchor.x - x) < 3 && Math.abs(entry.anchor.z - z) < 3 && ringArea(entry.outline) < W * D - 1);
  if (!room) throw new Error('no room');
  return { id, ...zoneFromRoom(room, name, '#3b82f6') };
}

function plan(layout: RoomLayout, transfer: RoomTransfer): RoomTransferResult {
  const result = planRoomTransfer(layout, 0, transfer);
  if (!result || 'refusal' in result) throw new Error(`refused: ${result ? result.refusal : 'null'}`);
  return result;
}

function refusal(layout: RoomLayout, transfer: RoomTransfer, floorIndex = 0): string {
  const result = planRoomTransfer(layout, floorIndex, transfer);
  if (!result || !('refusal' in result)) throw new Error('not refused');
  return result.refusal;
}

/** Each wall as its two ends, either way round. */
const ends = (walls: readonly InteriorWall[] | undefined): string[] =>
  (walls ?? []).map((entry) => [`${entry.x1},${entry.z1}`, `${entry.x2},${entry.z2}`].sort().join('|')).sort();

describe('picking a room (#925)', () => {
  it('takes the room, its furniture, its partitions and its zone', () => {
    const plain = house({ interiorWalls: BOX });
    const layout = house({
      interiorWalls: BOX,
      items: [makeItem({ id: 'in', position: { x: 0.2, z: 0 }, width: 0.5, depth: 0.5 }), makeItem({ id: 'out', position: { x: 3, z: 3 } })],
      zones: [zoneAt(plain, 0, 0, 'box')],
    });
    const room = roomArrangement(layout, 0, { x: 0, z: 0 });
    if ('refusal' in room) throw new Error(room.refusal);
    expect(room.items.map((item) => item.id)).toEqual(['in']);
    expect(room.walls.map((entry) => entry.id).sort()).toEqual(['e', 'n', 's', 'w']);
    expect(room.zones.map((zone) => zone.id)).toEqual(['box']);
    expect(room.sides).toEqual([]);
  });

  it('has nothing to pick outside a closed room or in a room with a room inside', () => {
    expect(roomArrangement(house({}), 0, { x: 20, z: 0 })).toMatchObject({ refusal: expect.any(String) });
    // The floor around the box holds it as a hole.
    expect(roomArrangement(house({ interiorWalls: BOX }), 0, { x: 4, z: 3 })).toEqual({ refusal: expect.stringContaining('inside it') });
  });

  it('leaves a wall shared with a named room, and copies it as a side', () => {
    const split = [wall('mid', 0, -4, 0, 4, { color: '#ff0000', colorB: '#00ff00' })];
    const plain = house({ interiorWalls: split });
    const layout = house({ interiorWalls: split, zones: [zoneAt(plain, 2.5, 0, 'right')] });
    const room = roomArrangement(layout, 0, { x: -2.5, z: 0 });
    if ('refusal' in room) throw new Error(room.refusal);
    expect(room.walls).toEqual([]);
    // Three outer sides and the partition's face into the room.
    expect(room.sides).toHaveLength(4);
    const copied = room.sides.find((side) => side.x1 === 0 && side.x2 === 0)!;
    // Side a of 'mid' (running south) faces west, into the left room: the copy carries that face.
    expect([copied.color, copied.colorB]).toContain('#ff0000');
    expect([copied.color, copied.colorB]).not.toContain('#00ff00');
  });

  it('takes the partition of an unnamed neighbour along', () => {
    const room = roomArrangement(house({ interiorWalls: [wall('mid', 0, -4, 0, 4)] }), 0, { x: -2.5, z: 0 });
    if ('refusal' in room) throw new Error(room.refusal);
    expect(room.walls.map((entry) => entry.id)).toEqual(['mid']);
  });

  it('takes the doors in its partitions and leaves the windows in the outer walls', () => {
    const layout = house({
      interiorWalls: CORNER,
      items: [
        makeItem({ id: 'door', type: 'door', name: 'Door', position: { x: -2, z: -2 }, width: 0.9, depth: 0.1, rotation: Math.PI / 2 }),
        makeItem({ id: 'window', type: 'window', name: 'Window', position: { x: -3.5, z: -4 }, width: 1, depth: 0.1 }),
      ],
    });
    const room = roomArrangement(layout, 0, { x: -3.5, z: -2 });
    if ('refusal' in room) throw new Error(room.refusal);
    expect(room.items.map((item) => item.id)).toEqual(['door']);
  });

  it('refuses a room holding stairs', () => {
    const layout = house({ interiorWalls: BOX, items: [makeItem({ id: 'st', type: 'stairs', name: 'Stairs', position: { x: 0, z: 0 }, width: 0.9, depth: 1.5 })] });
    expect(roomArrangement(layout, 0, { x: 0.5, z: 0.5 })).toEqual({ refusal: expect.stringContaining('Stairs') });
  });
});

describe('moving a room (#925)', () => {
  it('moves its walls, furniture and zone together', () => {
    const plain = house({ interiorWalls: BOX });
    const layout = house({
      interiorWalls: BOX,
      items: [makeItem({ id: 'in', position: { x: 0.2, z: 0 }, width: 0.5, depth: 0.5 })],
      zones: [zoneAt(plain, 0, 0, 'box')],
    });
    const result = plan(layout, { kind: 'move', at: { x: 0, z: 0 }, dx: 2, dz: -1 });
    expect(ends(result.floor.interiorWalls)).toEqual(ends(BOX.map((entry) => ({ ...entry, x1: entry.x1 + 2, x2: entry.x2 + 2, z1: entry.z1 - 1, z2: entry.z2 - 1 }))));
    // Moved walls keep their ids.
    expect(result.floor.interiorWalls!.map((entry) => entry.id).sort()).toEqual(['e', 'n', 's', 'w']);
    expect(result.floor.items[0]!.position).toEqual({ x: 2.2, z: -1 });
    expect(result.floor.zones![0]).toMatchObject({ id: 'box', x: 1, z: -2, w: 2, d: 2 });
    expect(result.at).toEqual({ x: 2, z: -1 });
  });

  it('builds the side the outer wall gave it, and drops the side that lands on the outer wall', () => {
    const result = plan(house({ interiorWalls: CORNER }), { kind: 'move', at: { x: -3.5, z: -2 }, dx: 1, dz: 0 });
    expect(ends(result.floor.interiorWalls)).toEqual(ends([wall('', -1, -4, -1, 0), wall('', -4, 0, -1, 0), wall('', -4, -4, -4, 0)]));
    const rooms = floorRooms({ ...house({}), floors: [result.floor] }, 0);
    expect(rooms.some((room) => Math.abs(ringArea(room.outline) - 12) < 1e-6)).toBe(true);
  });

  it('refuses to run into a named neighbour, off the house or into the cut corner', () => {
    const split = [wall('mid', 0, -4, 0, 4)];
    const plain = house({ interiorWalls: split });
    const named = house({ interiorWalls: split, zones: [zoneAt(plain, 2.5, 0, 'right'), zoneAt(plain, -2.5, 0, 'left')] });
    expect(refusal(named, { kind: 'move', at: { x: -2.5, z: 0 }, dx: 1, dz: 0 })).toMatch(/wall would run through|land on/);
    expect(refusal(house({ interiorWalls: BOX }), { kind: 'move', at: { x: 0, z: 0 }, dx: 5, dz: 0 })).toMatch(/fit inside/);
    const lShaped = house({ interiorWalls: BOX }, { cutout: { corner: 'ne', width: 3, depth: 3 } });
    expect(refusal(lShaped, { kind: 'move', at: { x: 0, z: 0 }, dx: 3, dz: -2 })).toMatch(/fit inside/);
  });

  it('refuses a new overlap, and a locked item', () => {
    const items = [makeItem({ id: 'in', position: { x: 0, z: 0 }, width: 0.5, depth: 0.5 }), makeItem({ id: 'sofa', name: 'Sofa', position: { x: 3, z: 0 }, width: 1, depth: 1 })];
    expect(refusal(house({ interiorWalls: BOX, items }), { kind: 'move', at: { x: 0, z: 0 }, dx: 3, dz: 0 })).toMatch(/overlap/);
    const locked = [makeItem({ id: 'in', name: 'Bed', position: { x: 0, z: 0 }, width: 0.5, depth: 0.5, locked: true })];
    expect(refusal(house({ interiorWalls: BOX, items: locked }), { kind: 'move', at: { x: 0, z: 0 }, dx: 2, dz: 0 })).toMatch(/Bed is locked/);
  });

  it('moves a door with its wall, and refuses when its wall would go from under it', () => {
    const door = makeItem({ id: 'door', type: 'door', name: 'Door', position: { x: 0, z: 1 }, width: 0.9, depth: 0.12 });
    const moved = plan(house({ interiorWalls: BOX, items: [door] }), { kind: 'move', at: { x: 0, z: 0 }, dx: 1, dz: 0 });
    expect(moved.floor.items[0]).toMatchObject({ position: { x: 1, z: 1 }, rotation: 0 });
    // On the L the box's south side lands half on the cut's wall, which takes it: the door would end up outside.
    const lShaped = house({ interiorWalls: BOX, items: [door] }, { cutout: { corner: 'se', width: 3, depth: 3 } });
    expect(refusal(lShaped, { kind: 'move', at: { x: 0, z: 0 }, dx: 2, dz: 0 })).toMatch(/Door would leave its wall/);
  });

  it('a zero move changes nothing', () => {
    expect(planRoomTransfer(house({ interiorWalls: BOX }), 0, { kind: 'move', at: { x: 0, z: 0 }, dx: 0, dz: 0 })).toBeNull();
  });
});

describe('mirroring a room (#925)', () => {
  it('flips its furniture in place: positions, headings and hand', () => {
    const layout = house({
      interiorWalls: CORNER,
      items: [makeItem({ id: 'bed', position: { x: -4, z: -3 }, rotation: Math.PI / 2, width: 0.5, depth: 0.5 })],
    });
    const result = plan(layout, { kind: 'mirror', at: { x: -3.5, z: -2 }, axis: 'x' });
    // The room spans x -5..-2: its centre is -3.5.
    expect(result.floor.items[0]).toMatchObject({ position: { x: -3, z: -3 }, mirrored: true });
    expect(result.floor.items[0]!.rotation).toBeCloseTo((3 * Math.PI) / 2);
    const back = plan({ ...layout, floors: [result.floor] }, { kind: 'mirror', at: { x: -3.5, z: -2 }, axis: 'x' });
    expect(back.floor.items[0]!.mirrored).toBeUndefined();
    expect(back.floor.items[0]!.position).toEqual({ x: -4, z: -3 });
  });

  it('keeps each painted face looking into the room it did', () => {
    const box = BOX.map((entry) => (entry.id === 'e' ? { ...entry, color: '#111111', colorB: '#222222' } : entry));
    const result = plan(house({ interiorWalls: box }), { kind: 'mirror', at: { x: 0, z: 0 }, axis: 'x' });
    const moved = result.floor.interiorWalls!.find((entry) => entry.id === 'e')!;
    // Now the west wall, still running north to south seen from inside.
    expect(moved).toMatchObject({ x1: -1, z1: 1, x2: -1, z2: -1, color: '#111111', colorB: '#222222' });
  });
});

describe('review fixes (#925)', () => {
  const painting = (id: string, x: number, z: number, rotation: number): FurnitureItem =>
    makeItem({ id, type: 'painting', name: 'Painting', category: 'decor', width: 0.8, depth: 0.05, height: 0.6, position: { x, z }, rotation });

  it('refuses a mirror that would turn a partition door into an outside door', () => {
    const door = makeItem({ id: 'door', type: 'door', name: 'Door', position: { x: -2, z: -2 }, width: 0.9, depth: 0.12, rotation: Math.PI / 2 });
    expect(refusal(house({ interiorWalls: CORNER, items: [door] }), { kind: 'mirror', at: { x: -3.5, z: -2 }, axis: 'x' })).toMatch(/Door would end up in an outer wall/);
  });

  it("leaves a named neighbour's door in the wall that stays", () => {
    const walls = [wall('mid', 0, -4, 0, 4), wall('cz', -5, 0, 0, 0)];
    const door = makeItem({ id: 'door', type: 'door', name: 'Door', position: { x: 0, z: -2 }, width: 0.9, depth: 0.12, rotation: Math.PI / 2 });
    const plain = house({ interiorWalls: walls });
    const layout = house({ interiorWalls: walls, items: [door], zones: [zoneAt(plain, 2.5, 0, 'east')] });
    const room = roomArrangement(layout, 0, { x: -2.5, z: -2 });
    if ('refusal' in room) throw new Error(room.refusal);
    expect(room.items).toEqual([]);
    const moved = plan(layout, { kind: 'move', at: { x: -2.5, z: -2 }, dx: 0, dz: 1 });
    expect(moved.floor.items[0]!.position).toEqual({ x: 0, z: -2 });
  });

  it('a wall a mirror puts back where it stood keeps its id and paint', () => {
    const walls = CORNER.map((entry) => (entry.id === 'cx' ? { ...entry, color: '#111111', colorB: '#222222', pattern: 'brick' as const } : entry));
    const result = plan(house({ interiorWalls: walls }), { kind: 'mirror', at: { x: -3.5, z: -2 }, axis: 'x' });
    const cx = result.floor.interiorWalls!.find((entry) => entry.id === 'cx');
    expect(cx).toEqual(walls.find((entry) => entry.id === 'cx'));
    expect(result.floor.interiorWalls).toHaveLength(2);
  });

  it('re-hangs mirrored decor on the face it lands by: flush on the outer wall', () => {
    // On the partition's west face, looking west into the room.
    const art = painting('art', -2 - 0.08 - 0.025, -2, (3 * Math.PI) / 2);
    const result = plan(house({ interiorWalls: CORNER, items: [art] }), { kind: 'mirror', at: { x: -3.5, z: -2 }, axis: 'x' });
    expect(result.floor.items[0]!.position!.x).toBeCloseTo(-5 + 0.025, 6);
    expect(result.floor.items[0]!.position!.z).toBe(-2);
  });

  it('carries what hangs on the far face of a wall that moves', () => {
    const art = painting('art', -2 + 0.08 + 0.025, -2, Math.PI / 2);
    const result = plan(house({ interiorWalls: CORNER, items: [art] }), { kind: 'move', at: { x: -3.5, z: -2 }, dx: 1, dz: 0 });
    expect(result.floor.items[0]!.position!.x).toBeCloseTo(-0.895, 6);
  });

  it('a room may not land on a rectangle zone either', () => {
    const rect: RoomZone = { id: 'r', name: 'Nook', color: '#3b82f6', x: 2, z: -1, w: 1, d: 1 };
    expect(refusal(house({ interiorWalls: BOX, zones: [rect] }), { kind: 'move', at: { x: 0, z: 0 }, dx: 2, dz: 0 })).toMatch(/land on Nook/);
  });
});

describe('copying a room (#925)', () => {
  it('copies walls, furniture and zone under fresh ids, unlocked', () => {
    const plain = house({ interiorWalls: BOX });
    const layout = house({
      interiorWalls: BOX,
      items: [makeItem({ id: 'in', position: { x: 0, z: 0 }, width: 0.5, depth: 0.5, locked: true })],
      zones: [zoneAt(plain, 0, 0, 'box', 'Bath')],
    });
    const result = plan(layout, { kind: 'copy', at: { x: 0, z: 0 }, dx: 3, dz: 0, idTag: 't' });
    expect(result.floor.interiorWalls).toHaveLength(8);
    expect(result.floor.items).toHaveLength(2);
    const copy = result.floor.items[1]!;
    expect(copy.id).not.toBe('in');
    expect(copy.locked).toBeUndefined();
    expect(copy.position).toEqual({ x: 3, z: 0 });
    expect(result.floor.zones).toHaveLength(2);
    expect(result.floor.zones![1]).toMatchObject({ name: 'Bath', x: 2, w: 2 });
    expect(result.zoneIds).toEqual([result.floor.zones![1]!.id]);
  });

  it('never lands on the room it copies', () => {
    expect(refusal(house({ interiorWalls: BOX }), { kind: 'copy', at: { x: 0, z: 0 }, dx: 1, dz: 0, idTag: 't' })).toBeTruthy();
  });

  it('pastes on another storey where it was, when that is free', () => {
    const plain = house({ interiorWalls: BOX, items: [makeItem({ id: 'in', position: { x: 0, z: 0 }, width: 0.5, depth: 0.5 })] });
    const layout: RoomLayout = { ...plain, floors: [plain.floors[0]!, makeFloor({ id: 'up', name: 'First' })] };
    const room = roomArrangement(layout, 0, { x: 0, z: 0 });
    if ('refusal' in room) throw new Error(room.refusal);
    expect(pasteSpot(layout, 1, room, 't')).toEqual({ dx: 0, dz: 0 });
    // On its own storey the same spot is taken: it goes beside.
    expect(pasteSpot(layout, 0, room, 't')).toEqual({ dx: 2, dz: 0 });
  });
});

describe('the transferRoom action (#925)', () => {
  const state = (layout: RoomLayout): LayoutState => ({ layout, activeFloorIndex: 0 });

  it('is one dispatch; a refusal keeps the state object', () => {
    const before = state(house({ interiorWalls: BOX }));
    expect(layoutReducer(before, { type: 'transferRoom', transfer: { kind: 'move', at: { x: 0, z: 0 }, dx: 9, dz: 0 } })).toBe(before);
    const after = layoutReducer(before, { type: 'transferRoom', transfer: { kind: 'move', at: { x: 0, z: 0 }, dx: 1, dz: 0 } });
    expect(after).not.toBe(before);
    expect(ends(after.layout.floors[0]!.interiorWalls)).toContain('2,-1|2,1');
  });

  it('the moved room is detected where it went, and its zone with it', () => {
    const plain = house({ interiorWalls: CORNER });
    const before = state(house({ interiorWalls: CORNER, zones: [zoneAt(plain, -3.5, -2, 'study')] }));
    const after = layoutReducer(before, { type: 'transferRoom', transfer: { kind: 'move', at: { x: -3.5, z: -2 }, dx: 1, dz: 0 } });
    const zone = after.layout.floors[0]!.zones![0]!;
    expect(zone).toMatchObject({ id: 'study', x: -4, w: 3 });
    expect(ringArea(zone.outline!)).toBeCloseTo(12);
  });
});

describe('speed (#925)', () => {
  it('plans a move on a busy storey quickly', () => {
    const walls: InteriorWall[] = [...BOX];
    // A row of rooms along the south wall.
    for (let x = -4; x <= 4; x += 1) walls.push(wall(`r${x}`, x, 2, x, 4));
    walls.push(wall('row', -5, 2, 5, 2));
    const items: FurnitureItem[] = [];
    for (let i = 0; i < 200; i++) items.push(makeItem({ id: `i${i}`, position: { x: -4.6 + (i % 20) * 0.45, z: -3.6 + Math.floor(i / 20) * 0.15 }, width: 0.1, depth: 0.1 }));
    const layout = house({ interiorWalls: walls, items });
    const { result, cpuMs } = measureCpu(() => planRoomTransfer(layout, 0, { kind: 'move', at: { x: 0, z: 0 }, dx: 1, dz: 0 }));
    expect(result).not.toBeNull();
    expect(cpuMs).toBeLessThan(500);
  });
});
