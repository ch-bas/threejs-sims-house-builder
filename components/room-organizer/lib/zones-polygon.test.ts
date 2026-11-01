import { describe, expect, it } from 'vitest';
import { layoutReducer, type LayoutState } from '../hooks/layout-reducer';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { footprintOutline } from './footprint';
import { layoutToDxf } from './plan-export/dxf';
import { layoutToSvg } from './plan-export/svg';
import { detectRooms, floorRooms, largestBand } from './room-detect';
import { isFloorLayout, parseStoredLayout } from './schema';
import {
  arrangeByZone,
  hasFloorFinish,
  isRoomZone,
  refitZonesToRooms,
  roomAt,
  regionShape,
  roomsToName,
  sameZone,
  zoneArea,
  zoneContains,
  zoneFinishesKey,
  zoneFloorPatches,
  zoneFromRoom,
  zoneLabelSpot,
  zoneRings,
  zoneShapeFits,
  zoneStats,
} from './zones';
import type { FloorLayout, InteriorWall, RoomZone, Vec2 } from './types';

const walls: InteriorWall[] = [
  { id: 'a', x1: 0, z1: -4, x2: 0, z2: 0 },
  { id: 'b', x1: 0, z1: 0, x2: 5, z2: 0 },
];
const building = (floor: Partial<FloorLayout>) => makeLayout({ width: 10, height: 8, floors: [makeFloor({ id: 'g', interiorWalls: walls, ...floor })] });
const rooms = floorRooms(building({}), 0);
const small = rooms.find((room) => room.area === 20)!;
const big = rooms.find((room) => room.area === 60)!;
const lZone: RoomZone = { id: 'z', ...zoneFromRoom(big, 'Living', '#3b82f6') };

function stateOf(floor: Partial<FloorLayout>): LayoutState {
  return { layout: building(floor), activeFloorIndex: 0 };
}

describe('polygon zones (#719)', () => {
  it('a zone from a room keeps its polygon and takes its rectangle from it', () => {
    expect(lZone).toMatchObject({ x: -5, z: -4, w: 10, d: 8 });
    expect(lZone.outline).toHaveLength(6);
    expect(isRoomZone(lZone)).toBe(true);
  });

  it('validates outline and holes, and needs no migration without them', () => {
    expect(isRoomZone({ ...lZone, outline: [{ x: 0, z: 0 }, { x: 1, z: 0 }] })).toBe(false);
    expect(isRoomZone({ ...lZone, outline: [{ x: 0, z: 0 }, { x: Number.NaN, z: 0 }, { x: 1, z: 1 }] })).toBe(false);
    expect(isRoomZone({ ...lZone, holes: 'none' })).toBe(false);
    expect(isRoomZone({ id: 'z', name: 'N', color: '#000', x: 0, z: 0, w: 1, d: 1, holes: [] })).toBe(false);
    expect(isRoomZone({ id: 'z', name: 'N', color: '#000', x: 0, z: 0, w: 1, d: 1 })).toBe(true);
  });

  it('survives a stored round trip, and a bad polygon does not load', () => {
    const layout = building({ zones: [lZone] });
    const parsed = parseStoredLayout(JSON.parse(JSON.stringify(layout)));
    expect(parsed?.floors[0]?.zones?.[0]?.outline).toEqual(lZone.outline);
    expect(isFloorLayout({ ...makeFloor(), zones: [{ ...lZone, outline: 'x' }] })).toBe(false);
  });

  it('zoneStats measures the polygon, not its rectangle', () => {
    expect(zoneStats(lZone, [], null).area).toBeCloseTo(60);
  });

  it('counts only the items inside the polygon, edges included', () => {
    const items = [
      makeItem({ id: 'in', position: { x: -3, z: 0 }, price: 10 }),
      makeItem({ id: 'notch', position: { x: 3, z: -2 }, price: 100 }),
      makeItem({ id: 'edge', position: { x: 0, z: -2 }, price: 1000 }),
    ];
    expect(zoneStats(lZone, items, null)).toMatchObject({ itemCount: 2, cost: 1010 });
  });

  it('leaves a hole out of the floor and out of the zone', () => {
    const box: InteriorWall[] = [
      { id: 'n', x1: -1, z1: -1, x2: 1, z2: -1 },
      { id: 'e', x1: 1, z1: -1, x2: 1, z2: 1 },
      { id: 's', x1: 1, z1: 1, x2: -1, z2: 1 },
      { id: 'w', x1: -1, z1: 1, x2: -1, z2: -1 },
    ];
    const outer = floorRooms(building({ interiorWalls: box }), 0).find((room) => room.area === 76)!;
    const zone = zoneFromRoom(outer, 'Hall', '#000');
    expect(zoneArea(zone, null)).toBeCloseTo(76);
    expect(zoneContains(zone, 0, 0)).toBe(false);
    expect(zoneContains(zone, 3, 3)).toBe(true);
    expect(zoneRings(zone)).toHaveLength(2);
  });

  it('takes the porch off a polygon zone drawn before the porch was', () => {
    const recess = { x0: -2, x1: 2, frontZ: -4, backZ: -3 };
    // The porch runs under the wall at x = 0: half of it is the L's.
    expect(zoneArea(lZone, recess)).toBeCloseTo(60 - 2);
  });

  it('labels an L in its largest clear stretch, never in the notch', () => {
    const spot = zoneLabelSpot(lZone);
    expect(spot).toEqual({ x: -5, z: 0, w: 10, d: 4 });
    expect(largestBand(zoneRings(lZone))).not.toBeNull();
    const rect = { x: 1, z: 2, w: 3, d: 4 };
    expect(zoneLabelSpot(rect)).toBe(rect);
  });

  it('roomsToName offers rooms with no zone, and nothing on an open-plan storey', () => {
    expect(roomsToName(building({}), 0)).toHaveLength(2);
    expect(roomsToName(building({ zones: [lZone] }), 0)).toEqual([small]);
    expect(roomsToName(building({ interiorWalls: [] }), 0)).toEqual([]);
    expect(roomAt(rooms, 3, -2)).toBe(small);
    expect(roomAt(rooms, 30, 0)).toBeNull();
  });

  it('arranges an L room’s items inside the L', () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      makeItem({ id: `i${index}`, width: 1, depth: 1, position: { x: -3 + index * 0.1, z: 1 } })
    );
    const arranged = arrangeByZone(items, 10, 8, 'shelf', { zones: [lZone], context: { interiorWalls: walls } });
    for (const item of arranged) {
      expect(zoneContains(lZone, item.position!.x, item.position!.z)).toBe(true);
    }
  });

  it('sameZone sees a changed polygon', () => {
    const moved = { ...lZone, outline: lZone.outline!.map((point) => ({ ...point, x: point.x + 0.1 })) };
    expect(sameZone(lZone, moved)).toBe(false);
    expect(sameZone(lZone, { ...lZone, outline: lZone.outline!.map((point) => ({ ...point })) })).toBe(true);
  });
});

describe('polygon zones in the exports (#719)', () => {
  const layout = building({ zones: [lZone] });

  it('the SVG traces the polygon, with even-odd holes, and labels the clear stretch', () => {
    const svg = layoutToSvg(layout, layout.floors[0]!);
    expect(svg).toMatch(/<g class="zone"><path d="M [^"]+ Z" fill-rule="evenodd"/);
    expect(svg).toContain('60.0 m²');
  });

  it('the DXF closes one outline with every corner, and writes the area', () => {
    const dxf = layoutToDxf(layout, layout.floors[0]!);
    const body = dxf.split('LWPOLYLINE').filter((part) => /\n8\nZONES\b/.test(part.slice(0, 200).replace(/\r/g, '')));
    expect(body).toHaveLength(1);
    expect(body[0]!.replace(/\r/g, '')).toMatch(/\n90\n\s*6\n/);
    expect(dxf).toContain('60.0 m');
  });
});

describe('zone floor finishes (#720)', () => {
  const rect: RoomZone = { id: 'r', name: 'Kitchen', color: '#000', x: -5, z: -4, w: 4, d: 4 };

  it('only a zone with a finish gets a patch, and the storey stands in for what it does not set', () => {
    const floor = makeFloor({ floorColor: '#aaaaaa', floorPattern: 'wood', zones: [rect, { ...rect, id: 't', floorPattern: 'tile' }, { ...rect, id: 'c', floorColor: '#112233' }] });
    expect(zoneFloorPatches(floor, []).map(({ id, pattern, color }) => [id, pattern, color])).toEqual([
      ['t', 'tile', '#aaaaaa'],
      ['c', 'wood', '#112233'],
    ]);
    expect(zoneFloorPatches(makeFloor(), [])).toEqual([]);
  });

  it('follows a polygon, holes included', () => {
    const floor = makeFloor({ zones: [{ ...lZone, floorPattern: 'tile' }] });
    const [patch] = zoneFloorPatches(floor, []);
    expect(patch!.regions).toHaveLength(1);
    expect(patch!.regions[0]!.outline).toHaveLength(6);
    expect(patch!.regions[0]!.area).toBeCloseTo(60);
  });

  it('leaves out the porch and a stairwell a rectangle zone was drawn over', () => {
    const floor = makeFloor({ zones: [{ ...rect, floorColor: '#112233' }] });
    const [patch] = zoneFloorPatches(floor, [
      { x0: -4, x1: -2, z0: -4, z1: -3 },
      { x0: -4, x1: -3, z0: -2, z1: -1, hole: true },
    ]);
    expect(patch!.regions[0]!.area).toBeCloseTo(16 - 2 - 1);
    expect(patch!.regions[0]!.holes).toHaveLength(1);
  });

  it('a patch wholly in a keep-out has no regions', () => {
    const floor = makeFloor({ zones: [{ ...rect, floorColor: '#112233' }] });
    expect(zoneFloorPatches(floor, [{ x0: -6, x1: 0, z0: -5, z1: 1 }])[0]!.regions).toEqual([]);
  });

  it('an empty floor colour means none: no patch, and the schema drops it', () => {
    const blank = { ...rect, floorColor: '' };
    expect(zoneFloorPatches(makeFloor({ zones: [blank] }), [])).toEqual([]);
    expect(hasFloorFinish(blank)).toBe(false);
    const tiled = { ...blank, floorPattern: 'tile' as const };
    expect(zoneFloorPatches(makeFloor({ floorColor: '#aaaaaa', zones: [tiled] }), [])[0]!.color).toBe('#aaaaaa');
    const parsed = parseStoredLayout(JSON.parse(JSON.stringify(building({ zones: [blank] }))));
    expect(parsed?.floors[0]?.zones?.[0]).not.toHaveProperty('floorColor');
  });

  it('only overlapping patches stack, so fifteen rooms side by side all lie flat', () => {
    const rooms = Array.from({ length: 15 }, (_, index) => ({ ...rect, id: `r${index}`, x: -5 + index * 0.5, w: 0.5, floorColor: '#112233' }));
    expect(zoneFloorPatches(makeFloor({ zones: rooms }), []).map((patch) => patch.layer)).toEqual(rooms.map(() => 0));
    const over = { ...rect, id: 'o', x: -4, w: 2, floorColor: '#445566' };
    const stack = zoneFloorPatches(makeFloor({ zones: [{ ...rect, floorColor: '#112233' }, over, { ...over, id: 'p' }] }), []);
    expect(stack.map((patch) => patch.layer)).toEqual([0, 1, 2]);
  });

  it('a finished room’s name gets a halo in the SVG, and a plain one stays as it was', () => {
    const finished = building({ zones: [{ ...rect, floorColor: '#112233' }] });
    expect(layoutToSvg(finished, finished.floors[0]!)).toContain('paint-order="stroke"');
    const plain = building({ zones: [rect] });
    expect(layoutToSvg(plain, plain.floors[0]!)).not.toContain('paint-order');
  });

  it('the plan and SVG cut a finish around a stairwell, as 3D does', () => {
    const stairs = makeItem({ id: 's', type: 'stairs', width: 1, depth: 3, height: 3, position: { x: -3, z: -2 } });
    const upper = makeFloor({ id: 'u', zones: [{ ...rect, floorColor: '#112233' }] });
    const layout = makeLayout({ width: 10, height: 8, floors: [makeFloor({ id: 'g', items: [stairs] }), upper] });
    const svg = layoutToSvg(layout, upper);
    const path = /class="zone-floor" d="([^"]+)"/.exec(svg)![1]!;
    expect(path.match(/M /g)!.length + path.match(/L /g)!.length).toBeGreaterThan(4);
  });

  it('the finish key ignores names and zones without a finish', () => {
    const plain = { zones: [rect] };
    expect(zoneFinishesKey(plain)).toEqual([]);
    const finished = { ...rect, floorColor: '#112233' };
    expect(JSON.stringify(zoneFinishesKey({ zones: [finished] }))).toBe(JSON.stringify(zoneFinishesKey({ zones: [{ ...finished, name: 'Other', color: '#fff' }] })));
    expect(JSON.stringify(zoneFinishesKey({ zones: [finished] }))).not.toBe(JSON.stringify(zoneFinishesKey({ zones: [{ ...finished, x: 0 }] })));
  });

  it('the reducer sets and clears a finish, and a repeat is a no-op', () => {
    const state = stateOf({ zones: [rect] });
    const tiled = layoutReducer(state, { type: 'updateZone', id: 'r', patch: { floorPattern: 'tile', floorColor: '#112233' } });
    expect(tiled.layout.floors[0]!.zones![0]).toMatchObject({ floorPattern: 'tile', floorColor: '#112233' });
    expect(layoutReducer(tiled, { type: 'updateZone', id: 'r', patch: { floorPattern: 'tile' } })).toBe(tiled);
    const cleared = layoutReducer(tiled, { type: 'updateZone', id: 'r', patch: { floorPattern: null, floorColor: null } });
    expect(cleared.layout.floors[0]!.zones![0]).toEqual(rect);
  });

  it('a polygon zone takes a finish too, and keeps it when the walls move', () => {
    const state = stateOf({ zones: [lZone] });
    const tiled = layoutReducer(state, { type: 'updateZone', id: 'z', patch: { floorPattern: 'tile' } });
    const moved = layoutReducer(tiled, { type: 'addInteriorWall', wall: { id: 'c', x1: -2, z1: -4, x2: -2, z2: 4 } });
    expect(moved.layout.floors[0]!.zones![0]).toMatchObject({ floorPattern: 'tile', name: 'Living' });
    expect(zoneArea(moved.layout.floors[0]!.zones![0]!, null)).toBeCloseTo(36);
  });

  it('the schema keeps a finish and refuses a bad one', () => {
    const zone = { ...rect, floorPattern: 'tile', floorColor: '#112233' };
    const layout = building({ zones: [zone as RoomZone] });
    expect(parseStoredLayout(JSON.parse(JSON.stringify(layout)))?.floors[0]?.zones?.[0]).toMatchObject({ floorPattern: 'tile', floorColor: '#112233' });
    expect(isFloorLayout({ ...makeFloor(), zones: [{ ...zone, floorPattern: 'lava' }] })).toBe(false);
    expect(isFloorLayout({ ...makeFloor(), zones: [{ ...zone, floorColor: 3 }] })).toBe(false);
  });

  it('the SVG paints the floor colour under the grid', () => {
    const layout = building({ zones: [{ ...rect, floorColor: '#112233' }] });
    const svg = layoutToSvg(layout, layout.floors[0]!);
    expect(svg).toContain('class="zone-floor"');
    expect(svg.indexOf('class="zone-floor"')).toBeLessThan(svg.indexOf('class="grid"'));
    expect(layoutToSvg(building({ zones: [rect] }), building({ zones: [rect] }).floors[0]!)).not.toContain('zone-floor');
  });
});

describe('zoneShapeFits and the schema repair (#719)', () => {
  const footprint = footprintOutline({ width: 10, height: 8 });
  const square = (x: number, z: number, side: number) => [{ x, z }, { x: x + side, z }, { x: x + side, z: z + side }, { x, z: z + side }];
  const zoneOf = (outline: Vec2[], rest: Partial<RoomZone> = {}): RoomZone => ({ id: 'q', name: 'Q', color: '#000', ...regionShape({ outline }), ...rest });
  const parsedZone = (zone: RoomZone) => parseStoredLayout(JSON.parse(JSON.stringify(building({ zones: [zone] }))))?.floors[0]?.zones?.[0];

  it('accepts a room as detected, and any rectangle zone', () => {
    expect(zoneShapeFits(lZone, footprint)).toBe(true);
    expect(zoneShapeFits({ x: 50, z: 50, w: 1, d: 1 }, footprint)).toBe(true);
  });

  it.each<[string, RoomZone]>([
    ['outside the footprint', zoneOf(square(4, 0, 3))],
    ['crossing itself', zoneOf([{ x: 0, z: 0 }, { x: 2, z: 2 }, { x: 2, z: 0 }, { x: 0, z: 2 }])],
    ['with no area', zoneOf([{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 2 }])],
    ['with a rectangle that is not its bounds', { ...zoneOf(square(0, 0, 2)), w: 3 }],
    ['with a hole outside it', zoneOf(square(0, 0, 2), { holes: [square(3, 0, 1)] })],
    ['over the points cap', zoneOf(square(-4, -3, 5), { holes: Array.from({ length: 64 }, (_, i) => square(-3.9 + (i % 8) * 0.5, -2.9 + Math.floor(i / 8) * 0.5, 0.1)) })],
  ])('a polygon %s is refused, and a file holding one still opens as a rectangle', (_name, zone) => {
    expect(zoneShapeFits(zone, footprint)).toBe(false);
    const parsed = parsedZone(zone);
    expect(parsed).toBeDefined();
    expect(parsed!.outline).toBeUndefined();
    expect(parsed!.holes).toBeUndefined();
    expect(parsed).toMatchObject({ name: 'Q', w: zone.w });
  });

  it('rebuilds ring points from the known keys, and leaves a clean file as it is', () => {
    const dirty = { ...lZone, outline: lZone.outline!.map((point) => ({ ...point, bloat: 1 })) };
    expect(Object.keys(parsedZone(dirty)!.outline![0]!)).toEqual(['x', 'z']);
    const layout = building({ zones: [lZone] });
    expect(parseStoredLayout(layout)).toBe(layout);
  });

  it('the reducer refuses a polygon zone that would not survive a reload', () => {
    const state = stateOf({});
    expect(layoutReducer(state, { type: 'addZone', zone: zoneOf(square(4, 0, 3)) })).toBe(state);
  });
});

describe('a re-fit never makes what the schema repairs (#719)', () => {
  /** A hall with `count` closed cupboards in it: the hall has that many holes, four points each. */
  const cupboards = (count: number): InteriorWall[] =>
    Array.from({ length: count }, (_, index) => {
      const x = -4.8 + (index % 11) * 0.8;
      const z = -3.8 + Math.floor(index / 11) * 0.8;
      const c = `c${index}`;
      return [
        { id: `${c}n`, x1: x, z1: z, x2: x + 0.5, z2: z },
        { id: `${c}e`, x1: x + 0.5, z1: z, x2: x + 0.5, z2: z + 0.5 },
        { id: `${c}s`, x1: x + 0.5, z1: z + 0.5, x2: x, z2: z + 0.5 },
        { id: `${c}w`, x1: x, z1: z + 0.5, x2: x, z2: z },
      ];
    }).flat();

  it('a room past the caps is no home: the zone keeps its shape and the house reloads with it', () => {
    const plain = stateOf({ interiorWalls: [] });
    const hall: RoomZone = { id: 'h', ...zoneFromRoom(floorRooms(plain.layout, 0)[0]!, 'Hall', '#000') };
    const state = stateOf({ interiorWalls: [], zones: [hall] });
    const next = layoutReducer(state, { type: 'addInteriorWalls', walls: cupboards(65) });
    const zone = next.layout.floors[0]!.zones![0]!;
    expect(zone.outline).toEqual(hall.outline);
    expect(zone.holes).toBeUndefined();
    const parsed = parseStoredLayout(JSON.parse(JSON.stringify(next.layout)));
    expect(parsed).not.toBeNull();
    expect(parsed!.floors[0]!.zones![0]!.outline).toEqual(hall.outline);
  });

  it('does not offer to name such a room', () => {
    const rooms = roomsToName(building({ interiorWalls: cupboards(65) }), 0);
    expect(rooms.every((room) => (room.holes?.length ?? 0) === 0)).toBe(true);
  });
});

describe('re-fit matching (#719)', () => {
  const strip = (id: string, x0: number, z0: number, x1: number, z1: number): RoomZone => ({
    id,
    name: id,
    color: '#000',
    x: x0,
    z: z0,
    w: x1 - x0,
    d: z1 - z0,
    outline: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }],
  });
  const house = (width: number, height: number, floor: Partial<FloorLayout>): LayoutState => ({
    layout: makeLayout({ width, height, floors: [makeFloor({ id: 'g', ...floor })] }),
    activeFloorIndex: 0,
  });

  it('a wall that stops reaching the shell floods no zone: both keep their rooms', () => {
    const north = strip('N', -3, -3, 3, 0);
    const south = strip('S', -3, 0, 3, 3);
    const state = house(6, 6, { interiorWalls: [{ id: 'w', x1: -3, z1: 0, x2: 3, z2: 0 }], zones: [north, south] });
    const next = layoutReducer(state, { type: 'setWidth', width: 8 });
    const [a, b] = next.layout.floors[0]!.zones!;
    expect(a!.outline).toEqual(north.outline);
    expect(b!.outline).toEqual(south.outline);
  });

  it('a moved wall takes the zones with it, each on its own side', () => {
    const left = strip('A', -3, -3, -2, 3);
    const right = strip('B', -2, -3, 3, 3);
    const rooms = detectRooms([{ id: 'w', x1: 2, z1: -3, x2: 2, z2: 3 }], footprintOutline({ width: 6, height: 6 }), []);
    const [a, b] = refitZonesToRooms([left, right], rooms, footprintOutline({ width: 6, height: 6 }), 6, 6);
    expect(zoneArea(a!, null)).toBeCloseTo(30);
    expect(zoneContains(a!, 0, 0)).toBe(true);
    expect(zoneArea(b!, null)).toBeCloseTo(6);
    expect(zoneContains(b!, 2.5, 0)).toBe(true);
  });

  it('a lone zone does not take the unnamed room its wall opened into', () => {
    const small: RoomZone = { id: 'y', ...zoneFromRoom(rooms.find((room) => room.area === 20)!, 'Study', '#000') };
    const merged = floorRooms(building({ interiorWalls: [] }), 0);
    expect(refitZonesToRooms([small], merged, footprintOutline({ width: 10, height: 8 }), 10, 8)[0]).toBe(small);
  });
});

describe('refitZonesToRooms (#719)', () => {
  const fit = (zones: RoomZone[], next: ReturnType<typeof floorRooms>) => refitZonesToRooms(zones, next, footprintOutline({ width: 10, height: 8 }), 10, 8);

  it('returns the same list when every zone still matches its room', () => {
    const zones = [lZone];
    expect(fit(zones, rooms)).toBe(zones);
  });

  it('keeps name and colour on the larger piece of a split room', () => {
    const split = floorRooms(building({ interiorWalls: [...walls, { id: 'c', x1: -2, z1: -4, x2: -2, z2: 4 }] }), 0);
    const [zone] = fit([lZone], split);
    expect(zone).toMatchObject({ name: 'Living', color: '#3b82f6' });
    expect(zoneArea(zone!, null)).toBeCloseTo(36);
  });

  it('two zones on a merged room: the larger follows, the other keeps its shape', () => {
    const merged = floorRooms(building({ interiorWalls: [] }), 0);
    const other: RoomZone = { id: 'y', ...zoneFromRoom(small, 'Study', '#000000') };
    const [a, b] = fit([lZone, other], merged);
    expect(zoneArea(a!, null)).toBeCloseTo(80);
    expect(b).toBe(other);
  });

  it('a zone off the footprint with no room falls back to its clamped rectangle', () => {
    const away: RoomZone = {
      id: 'y',
      name: 'Out',
      color: '#000',
      x: 3,
      z: 0,
      w: 4,
      d: 2,
      outline: [{ x: 3, z: 0 }, { x: 7, z: 0 }, { x: 7, z: 2 }, { x: 3, z: 2 }],
    };
    const [zone] = fit([away], []);
    expect(zone).toEqual({ id: 'y', name: 'Out', color: '#000', x: 3, z: 0, w: 2, d: 2 });
  });

  it('leaves rectangle zones alone', () => {
    const rect: RoomZone = { id: 'r', name: 'Drawn', color: '#000', x: 0, z: 0, w: 1, d: 1 };
    const zones = [rect];
    expect(fit(zones, rooms)).toBe(zones);
  });
});

describe('zones in the reducer (#719)', () => {
  it('adds a polygon zone whole, and refuses a broken one', () => {
    const state = stateOf({});
    const next = layoutReducer(state, { type: 'addZone', zone: lZone });
    expect(next.layout.floors[0]!.zones?.[0]?.outline).toEqual(lZone.outline);
    const broken = { ...lZone, outline: [{ x: 0, z: 0 }] };
    expect(layoutReducer(state, { type: 'addZone', zone: broken })).toBe(state);
  });

  it('a polygon zone can be renamed and recoloured, but a patch cannot reshape it', () => {
    const state = stateOf({ zones: [lZone] });
    const renamed = layoutReducer(state, { type: 'updateZone', id: 'z', patch: { name: 'Lounge' } });
    expect(renamed.layout.floors[0]!.zones?.[0]).toMatchObject({ name: 'Lounge', outline: lZone.outline });
    expect(layoutReducer(state, { type: 'updateZone', id: 'z', patch: { x: 2, w: 1 } })).toBe(state);
  });

  it('a wall edit re-fits the zone in the same step, and a no-op stays a no-op', () => {
    const state = stateOf({ zones: [lZone] });
    const next = layoutReducer(state, { type: 'addInteriorWall', wall: { id: 'c', x1: -2, z1: -4, x2: -2, z2: 4 } });
    expect(zoneArea(next.layout.floors[0]!.zones![0]!, null)).toBeCloseTo(36);
    expect(layoutReducer(state, { type: 'removeInteriorWall', id: 'nope' })).toBe(state);
  });

  it('an item edit does not touch the zones', () => {
    const state = stateOf({ zones: [lZone], items: [makeItem({ id: 'i', position: { x: -3, z: 2 } })] });
    const next = layoutReducer(state, { type: 'removeItem', id: 'i' });
    expect(next.layout.floors[0]!.zones).toBe(state.layout.floors[0]!.zones);
  });

  it('a footprint change follows the rooms: walls that stop reaching the shell open the room', () => {
    const state = stateOf({ zones: [lZone] });
    const next = layoutReducer(state, { type: 'setWidth', width: 12 });
    expect(zoneArea(next.layout.floors[0]!.zones![0]!, null)).toBeCloseTo(96);
  });

  it('loads and undo restore verbatim', () => {
    const state = stateOf({ zones: [lZone] });
    const moved = { ...state.layout, floors: [{ ...state.layout.floors[0]!, interiorWalls: [] }] };
    const next = layoutReducer(state, { type: 'applyLayout', layout: moved });
    expect(next.layout.floors[0]!.zones?.[0]).toBe(lZone);
  });

  it('leaves a house without polygon zones alone', () => {
    const rect: RoomZone = { id: 'r', name: 'Drawn', color: '#000', x: 0, z: 0, w: 1, d: 1 };
    const state = stateOf({ zones: [rect] });
    const next = layoutReducer(state, { type: 'addInteriorWall', wall: { id: 'c', x1: -2, z1: -4, x2: -2, z2: 4 } });
    expect(next.layout.floors[0]!.zones).toBe(state.layout.floors[0]!.zones);
  });
});
