import { describe, expect, it } from 'vitest';
import { layoutReducer, resizeRefusal, type LayoutState } from '../hooks/layout-reducer';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { ENTRANCE_CLASH_REFUSAL, cutoutRefusal, itemsInCorner, outdoorItemsTakenIn, withCutout } from './cutout';
import { floorKeepOut } from './floor-keep-out';
import { collisionReason, snapToWall } from './geometry';
import { snapOpeningToWall } from './opening-snap';
import { parseStoredLayout } from './schema';
import { ENTRANCE_DOOR_ID, ENTRANCE_WALL_ID, entranceGeometry, entranceProblem } from './street';
import { advanceWalker, boxCollider, buildShellColliders, buildWalkColliders, sightBlocked } from './walk-collision';
import { findSeat } from './walk-interact';
import { buildWalkWorld, walkSurfaceAt, type WalkSurface } from './walk-world';
import type { FootprintCutout, RoomLayout } from './types';

const cutout: FootprintCutout = { corner: 'ne', width: 4, depth: 3 };
const house = (extra: Partial<RoomLayout> = {}): RoomLayout => makeLayout({ width: 10, height: 8, roof: { style: 'flat' }, ...extra });
const state = (layout: RoomLayout): LayoutState => ({ layout, activeFloorIndex: 0 });
const run = (layout: RoomLayout, action: Parameters<typeof layoutReducer>[1]): RoomLayout => layoutReducer(state(layout), action).layout;

describe('cutting a corner (#727)', () => {
  it('moves an indoor item out of the corner, on every storey', () => {
    const layout = house({
      floors: [
        makeFloor({ items: [makeItem({ id: 'sofa', width: 2, depth: 1, position: { x: 2, z: -3 } })] }),
        makeFloor({ id: 'up', items: [makeItem({ id: 'bed', width: 2, depth: 2, position: { x: 3, z: -1.5 } })] }),
      ],
    });
    expect(itemsInCorner(layout, cutout).map((item) => item.id)).toEqual(['sofa', 'bed']);
    const next = withCutout(layout, cutout);
    expect(next.floors[0]!.items[0]!.position).toEqual({ x: 0, z: -3 });
    expect(next.floors[1]!.items[0]!.position).toEqual({ x: 3, z: 0 });
    for (const [index, floor] of next.floors.entries()) {
      expect(collisionReason(floor.items[0]!, floor.items, 10, 8, { keepOut: floorKeepOut(next, index) })).toBeNull();
    }
  });

  it('leaves outdoor items standing: the corner is open ground now', () => {
    const tree = makeItem({ id: 'tree', type: 'tree', category: 'outdoor', width: 1, depth: 1, position: { x: 3, z: -3 } });
    const next = withCutout(house({ floors: [makeFloor({ items: [tree] })] }), cutout);
    const floor = next.floors[0]!;
    expect(floor.items[0]).toBe(tree);
    expect(collisionReason(tree, floor.items, 10, 8, { keepOut: floorKeepOut(next, 0) })).toBeNull();
  });

  it('lets an outdoor item stand astride the old outline, not astride the new walls', () => {
    const layout = house({ cutout });
    const keepOut = floorKeepOut(layout, 0);
    const tree = (x: number, z: number) => makeItem({ id: 't', type: 'tree', category: 'outdoor', width: 1, depth: 1, position: { x, z } });
    expect(collisionReason(tree(3, -4), [], 10, 8, { keepOut })).toBeNull();
    expect(collisionReason(tree(5, -2.5), [], 10, 8, { keepOut })).toBeNull();
    expect(collisionReason(tree(3, -1), [], 10, 8, { keepOut })).toEqual({ kind: 'building' });
  });

  it('refuses an indoor item in the corner, as out of bounds', () => {
    const layout = house({ cutout });
    const sofa = makeItem({ id: 's', width: 1, depth: 1, position: { x: 3, z: -3 } });
    expect(collisionReason(sofa, [], 10, 8, { keepOut: floorKeepOut(layout, 0) })).toEqual({ kind: 'bounds' });
  });

  it('resettles openings on the walls left, and leaves others alone', () => {
    const gone = makeItem({ id: 'gone', type: 'door', width: 1, height: 2, position: { x: 3, z: -4 }, rotation: 0 });
    const kept = makeItem({ id: 'kept', type: 'door', width: 1, height: 2, position: { x: -3, z: 4 }, rotation: Math.PI });
    const next = withCutout(house({ floors: [makeFloor({ items: [gone, kept] })] }), cutout);
    expect(next.floors[0]!.items[0]!.position).toEqual({ x: 1, z: -3.5 });
    expect(itemsInCorner(house({ floors: [makeFloor({ items: [gone, kept] })] }), cutout).map((item) => item.id)).toEqual(['gone']);
    expect(next.floors[0]!.items[1]).toBe(kept);
  });

  it('clips partitions at the corner, on every storey, and trims or drops zones', () => {
    const zone = (id: string, x: number, z: number, w: number, d: number) => ({ id, name: id, color: '#000', x, z, w, d });
    const layout = house({
      floors: [
        makeFloor({
          interiorWalls: [
            { id: 'across', x1: -2, z1: -2, x2: 4, z2: -2 },
            { id: 'inside', x1: 2, z1: -3.5, x2: 4, z2: -3.5 },
            { id: 'clear', x1: -4, z1: 2, x2: 4, z2: 2 },
          ],
          zones: [zone('half', -2, -4, 6, 4), zone('gone', 2, -4, 2, 2), zone('clear', -4, 1, 2, 2)],
        }),
        makeFloor({ id: 'up', interiorWalls: [{ id: 'up', x1: 2, z1: -2, x2: 4, z2: -2 }] }),
      ],
    });
    const [ground, upper] = withCutout(layout, cutout).floors;
    expect(ground!.interiorWalls!.map((wall) => wall.id)).toEqual(['across', 'clear']);
    expect(ground!.interiorWalls![0]).toMatchObject({ x1: -2, x2: 1 });
    expect(upper).not.toHaveProperty('interiorWalls');
    expect(ground!.zones!.map((entry) => entry.id)).toEqual(['half', 'clear']);
    expect(ground!.zones![0]).toMatchObject({ x: -2, w: 3, d: 4 });
    expect(ground!.zones![1]).toBe(layout.floors[0]!.zones![2]);
  });

  it('is refused, same state, under a pitched roof', () => {
    for (const style of ['gable', 'hipped'] as const) {
      const layout = house({ roof: { style } });
      expect(cutoutRefusal(layout, cutout)).toContain('flat roof');
      const current = state(layout);
      expect(layoutReducer(current, { type: 'setCutout', cutout })).toBe(current);
    }
  });

  it('refuses a pitched roof on an L, same state', () => {
    const current = state(house({ cutout }));
    expect(layoutReducer(current, { type: 'setRoofStyle', style: 'gable' })).toBe(current);
    expect(layoutReducer(current, { type: 'setRoofStyle', style: 'hipped' })).toBe(current);
    expect(layoutReducer(current, { type: 'setRoofStyle', style: 'none' }).layout.roof?.style).toBe('none');
  });

  it('refuses a cut that leaves no wing, or moves a locked item', () => {
    expect(cutoutRefusal(house(), { corner: 'ne', width: 9, depth: 3 })).toContain('2 m');
    const locked = house({ floors: [makeFloor({ items: [makeItem({ id: 'a', name: 'Piano', locked: true, position: { x: 3, z: -3 } })] })] });
    expect(cutoutRefusal(locked, cutout)).toContain('Piano');
    expect(withCutout(locked, cutout)).toBe(locked);
  });

  it('refuses a clash with the recessed entrance, both ways', () => {
    const entrance = { width: 2, depth: 1.2, offset: 3 };
    const withPorch = run(house(), { type: 'setEntrance', entrance });
    expect(cutoutRefusal(withPorch, cutout)).toContain('recessed entrance');
    // A porch clear of the corner is fine.
    const clear = run(house(), { type: 'setEntrance', entrance: { ...entrance, offset: -3 } });
    expect(cutoutRefusal(clear, cutout)).toBeNull();
    // Asking for a porch into an L builds none, and says why.
    const context = { width: 10, depth: 8, floors: [{}], cutout };
    expect(entranceGeometry(entrance, context)).toBeNull();
    expect(entranceProblem(entrance, context)).toBe('cutout-clash');
    const onL = run(house({ cutout }), { type: 'setEntrance', entrance });
    expect(onL.floors[0]!.interiorWalls ?? []).toHaveLength(0);
  });

  it('is one undo step: no change is the same state, and filling it back keeps the moved items', () => {
    const current = state(house({ cutout }));
    expect(layoutReducer(current, { type: 'setCutout', cutout: { ...cutout } })).toBe(current);
    const plain = state(house());
    expect(layoutReducer(plain, { type: 'setCutout', cutout: null })).toBe(plain);
    expect(run(house({ cutout }), { type: 'setCutout', cutout: null })).not.toHaveProperty('cutout');
  });

  it('keeps the cut on its corner as the house resizes, and refuses a house too small for it', () => {
    const door = makeItem({ id: 'd', type: 'door', width: 1, height: 2, position: { x: 3, z: -1 }, rotation: 0 });
    const layout = house({ cutout, floors: [makeFloor({ items: [door] })] });
    const wider = run(layout, { type: 'setWidth', width: 12 });
    expect(wider.floors[0]!.items[0]!.position).toMatchObject({ z: -1 });
    const deeper = run(layout, { type: 'setHeight', height: 10 });
    // The notch's x wall moved north with the corner, and the door with it.
    expect(deeper.floors[0]!.items[0]!.position).toMatchObject({ x: 3, z: -2 });
    const small = state(layout);
    expect(layoutReducer(small, { type: 'setWidth', width: 5 })).toBe(small);
  });

  it('clips a new partition at the corner, and trims a new zone', () => {
    const layout = house({ cutout });
    const next = run(layout, { type: 'addInteriorWall', wall: { id: 'w', x1: 0, z1: -2, x2: 4, z2: -2 } });
    expect(next.floors[0]!.interiorWalls![0]).toMatchObject({ x1: 0, x2: 1 });
    const zoned = run(layout, { type: 'addZone', zone: { id: 'z', name: 'Z', color: '#000', x: -2, z: -4, w: 6, d: 2 } });
    expect(zoned.floors[0]!.zones![0]).toMatchObject({ x: -2, w: 3 });
  });
});

describe('what a cut may not do (review)', () => {
  const lockedSofa = () => makeItem({ id: 's', name: 'Sofa', locked: true, width: 2, depth: 1, position: { x: 4, z: 0 } });

  it('refuses a resize that would move a locked item (M1)', () => {
    // Narrowing by 4 m brings the ne corner's cut over the sofa at x = 2..; depth keeps it clear otherwise.
    const sofa = makeItem({ id: 's', name: 'Sofa', locked: true, width: 2, depth: 1, position: { x: 2, z: -1.5 } });
    const current = state(house({ cutout, floors: [makeFloor({ items: [sofa] })] }));
    expect(layoutReducer(current, { type: 'setHeight', height: 10 }).layout.height).toBe(10);
    const shrunk = state(house({ width: 12, cutout, floors: [makeFloor({ items: [{ ...sofa, position: { x: 1.2, z: -2.5 } }] })] }));
    expect(layoutReducer(shrunk, { type: 'setWidth', width: 9 })).toBe(shrunk);
    expect(resizeRefusal(shrunk.layout, 9, 8)).toContain('Sofa');
  });

  it('refuses a cut that moves a locked item it only overhangs (M1)', () => {
    const door = makeItem({ id: 'd', name: 'Door', type: 'door', locked: true, width: 2, height: 2, position: { x: 0.5, z: -4 }, rotation: 0 });
    const layout = house({ floors: [makeFloor({ items: [door] })] });
    expect(cutoutRefusal(layout, cutout)).toContain('Door');
    expect(withCutout(layout, cutout)).toBe(layout);
  });

  it('refuses filling or shrinking a cut when a locked window would jump (M1)', () => {
    const window = makeItem({ id: 'w', name: 'Window', type: 'window', locked: true, width: 1, height: 1, position: { x: 3, z: -1 }, rotation: 0 });
    const layout = house({ cutout, floors: [makeFloor({ items: [window] })] });
    expect(cutoutRefusal(layout, null)).toContain('Window');
    expect(withCutout(layout, null)).toBe(layout);
    expect(cutoutRefusal(layout, { ...cutout, depth: 2 })).toContain('Window');
  });

  it('leaves a locked item alone when nothing reaches it (M1)', () => {
    const layout = house({ floors: [makeFloor({ items: [lockedSofa(), makeItem({ id: 'o', locked: true, width: 1, depth: 1, position: { x: -4, z: 3 } })] })] });
    const clear = { corner: 'nw', width: 2, depth: 2 } as const;
    expect(cutoutRefusal(layout, clear)).toBeNull();
  });

  it('refuses a resize that would run the cut into a built porch, for the cut path\'s reason (M3)', () => {
    const entrance = { width: 2, depth: 1.2, offset: 0 };
    const start = run(house({ width: 14, cutout: { corner: 'ne', width: 5, depth: 3 } }), { type: 'setEntrance', entrance });
    expect(start.floors[0]!.interiorWalls).toHaveLength(1);
    const current = state(start);
    expect(layoutReducer(current, { type: 'setWidth', width: 10 })).toBe(current);
    expect(resizeRefusal(start, 10, 8)).toBe(ENTRANCE_CLASH_REFUSAL);
  });

  it('moves items to clear spots, never through a wall or onto each other (M4)', () => {
    const bed = makeItem({ id: 'bed', width: 2, depth: 2, position: { x: 2, z: -3 } });
    const sofa = makeItem({ id: 'sofa', width: 2, depth: 2, position: { x: 2.5, z: -2.5 } });
    const next = withCutout(house({ floors: [makeFloor({ items: [bed, sofa] })] }), cutout);
    const { items } = next.floors[0]!;
    for (const item of items) expect(collisionReason(item, items, 10, 8, { keepOut: floorKeepOut(next, 0) })).toBeNull();
  });

  it('refuses a cut that leaves an item nowhere, naming it (M4)', () => {
    const bed = makeItem({ id: 'bed', name: 'Bed', width: 3, depth: 3, position: { x: 2, z: -2 } });
    const layout = makeLayout({ width: 8, height: 8, roof: { style: 'flat' }, floors: [makeFloor({ items: [bed] })] });
    const big = { corner: 'ne', width: 6, depth: 6 } as const;
    expect(cutoutRefusal(layout, big)).toContain('Bed');
    expect(withCutout(layout, big)).toBe(layout);
  });

  it('refuses a cut through the stairs, and a resize that brings it there (M5)', () => {
    const stairs = makeItem({ id: 'st', name: 'Stairs', type: 'stairs', width: 1, depth: 3, position: { x: 3, z: -3 } });
    const layout = house({ floors: [makeFloor({ items: [stairs] }), makeFloor({ id: 'up' })] });
    expect(cutoutRefusal(layout, cutout)).toContain('Stairs');
    expect(withCutout(layout, cutout)).toBe(layout);
  });

  it('counts outdoor items a filled corner takes indoors (L8)', () => {
    const tree = makeItem({ id: 't', category: 'outdoor', type: 'tree', width: 1, depth: 1, position: { x: 3, z: -1.7 } });
    const layout = house({ cutout, floors: [makeFloor({ items: [tree] })] });
    expect(outdoorItemsTakenIn(layout, null)).toEqual([tree]);
    expect(outdoorItemsTakenIn(layout, { ...cutout, depth: 2 })).toEqual([tree]);
    expect(outdoorItemsTakenIn(layout, cutout)).toEqual([]);
  });

  it('drops a partition lying along a notch wall, keeps one meeting it (L10)', () => {
    const layout = house({
      floors: [
        makeFloor({
          interiorWalls: [
            { id: 'along', x1: 2, z1: -1, x2: 5, z2: -1 },
            { id: 'long', x1: -3, z1: -1.05, x2: 5, z2: -1.05 },
            { id: 'meets', x1: 3, z1: -1, x2: 3, z2: 2 },
          ],
        }),
      ],
    });
    const walls = withCutout(layout, cutout).floors[0]!.interiorWalls!;
    expect(walls.map((wall) => wall.id)).toEqual(['long', 'meets']);
    expect(walls[0]).toMatchObject({ x1: -3, x2: 1 });
    expect(walls[1]).toMatchObject({ z1: -1, z2: 2 });
  });

  it('ignores a bad corner in the reducer (L12)', () => {
    const current = state(house());
    expect(layoutReducer(current, { type: 'setCutout', cutout: { corner: 'up', width: 3, depth: 3 } as never })).toBe(current);
  });

  it('fits a loaded file that has things in the corner', () => {
    const parsed = parseStoredLayout(
      house({
        cutout,
        floors: [
          makeFloor({
            items: [makeItem({ id: 's', width: 1, depth: 1, position: { x: 3, z: -3 } })],
            interiorWalls: [{ id: 'w', x1: 2, z1: -3, x2: 4, z2: -3 }],
            zones: [{ id: 'z', name: 'Z', color: '#000', x: 2, z: -4, w: 2, d: 2 }],
          }),
        ],
      })
    );
    const floor = parsed!.floors[0]!;
    expect(collisionReason(floor.items[0]!, floor.items, 10, 8, { keepOut: floorKeepOut(parsed!, 0) })).toBeNull();
    expect(floor).not.toHaveProperty('interiorWalls');
    expect(floor).not.toHaveProperty('zones');
  });
});

describe('the rest of the editor on an L (review)', () => {
  it('snaps furniture to the notch walls, and not to the walls the cut took', () => {
    const sofa = makeItem({ width: 2, depth: 1, rotation: 0 });
    // South of the notch's x wall: flush with it from inside.
    expect(snapToWall({ position: { x: 3, z: -0.4 }, item: sofa, roomWidth: 10, roomDepth: 8, cutout }).z).toBe(-0.5);
    const tree = { width: 1, depth: 1, rotation: 0, category: 'outdoor' } as const;
    // In the corner, against the wall from outside; the old east wall isn't there to snap to.
    expect(snapToWall({ position: { x: 1.6, z: -3 }, item: tree, roomWidth: 10, roomDepth: 8, cutout }).x).toBe(1.5);
    expect(snapToWall({ position: { x: 5.4, z: -3 }, item: tree, roomWidth: 10, roomDepth: 8, cutout }).x).toBe(5.4);
    expect(snapToWall({ position: { x: 5.4, z: 2 }, item: tree, roomWidth: 10, roomDepth: 8, cutout }).x).toBe(5.5);
  });

  it('lets an NPC door on a notch wall stay the shell\'s, not a nearby partition\'s', () => {
    const door = makeItem({ id: 'd', type: 'door', width: 1, height: 2, position: { x: 3, z: -1 }, rotation: 0 });
    const walls = [{ id: 'i', x1: 2, z1: -0.75, x2: 4, z2: -0.75 }];
    const near = (options: { cutout?: FootprintCutout }) =>
      buildWalkColliders([door], walls, { roomWidth: 10, roomDepth: 8, ...options }).length;
    // Unbroken partition: the door is on the closer notch wall.
    expect(near({ cutout })).toBe(1);
    expect(floorKeepOut(house({ cutout }), 0)[0]?.cutout).toEqual(cutout);
  });

  it('walks into an outdoor bench in the corner, and past the street (M2)', () => {
    const bench = boxCollider(3, -3, 1, 1, 0, true);
    const world = buildWalkWorld({ width: 10, depth: 8, cutout: { corner: 'ne', width: 4, depth: 4 }, floors: [makeFloor()] });
    const walker = { x: 1.6 + 0.8, z: -3, y: 0, kind: 'ground' as const, floorIndex: 0 };
    for (let i = 0; i < 20; i++) advanceWalker(world, [bench], walker, 0.05, 0, 0.3);
    expect(walker.x).toBeLessThan(2.3);
  });

  it('counts a seat in the corner as outdoors (M2)', () => {
    const footprint = { width: 10, depth: 8, cutout };
    const bench = makeItem({ id: 'b', type: 'garden-bench', category: 'outdoor', width: 1, depth: 1, position: { x: 3, z: -3 } });
    expect(findSeat([bench], 3, -2, 0, -1, { footprint, colliders: [], outside: true })?.id).toBe('b');
    expect(findSeat([bench], 0, -2, 1, 0, { footprint, colliders: [] })).toBeNull();
  });
});

describe('opening snap on an L (#727)', () => {
  const snap = (x: number, z: number) => snapOpeningToWall({ position: { x, z }, itemWidth: 1, roomWidth: 10, roomDepth: 8, cutout });

  it('lands on the two new walls, faced into the house', () => {
    expect(snap(3, -1.2)).toMatchObject({ position: { x: 3, z: -1 }, rotation: 0 });
    expect(snap(1.2, -3)).toMatchObject({ position: { x: 1, z: -3 }, rotation: -Math.PI / 2 });
  });

  it('never lands on a wall the cut took away', () => {
    expect(snap(3, -3.9).position.z).not.toBe(-4);
    expect(snap(4.9, -3).position.x).not.toBe(5);
    expect(snap(0.9, -4).position).toEqual({ x: 0.5, z: -4 });
  });
});

describe('walking an L (#727)', () => {
  const building = (extra = {}) => ({
    width: 10,
    depth: 8,
    cutout,
    floors: [makeFloor({ items: [makeItem({ id: 'd', type: 'door', width: 1, height: 2, position: { x: 3, z: -1 } })] }), makeFloor({ id: 'up' })],
    ...extra,
  });
  const surface: WalkSurface = { y: 0, kind: 'ground', floorIndex: -1 };

  it('is ground in the corner and floor beside it', () => {
    const world = buildWalkWorld(building());
    expect(walkSurfaceAt(world, 3, -3, 0, 'ground', surface)).toBe(true);
    expect(surface.kind).toBe('ground');
    expect(walkSurfaceAt(world, 0, 0, 0, 'floor', surface)).toBe(true);
    expect(surface.kind).toBe('floor');
  });

  it('walls the new sides, with the door open, on every storey', () => {
    const ground = buildShellColliders(building(), 0);
    expect(sightBlocked(ground, 1.5, -3, 0.5, -3)).toBe(true); // through the notch's z wall
    expect(sightBlocked(ground, 4, -1.5, 4, -0.5)).toBe(true); // through its x wall
    expect(sightBlocked(ground, 3, -1.5, 3, -0.5)).toBe(false); // through the door
    expect(sightBlocked(ground, 3, -4.5, 3, -3.5)).toBe(false); // no north wall across the corner
    const upper = buildShellColliders(building(), 1);
    expect(sightBlocked(upper, 3, -1.5, 3, -0.5)).toBe(true);
  });
});

describe('the entrance and the cut', () => {
  const porch = { width: 2, depth: 1, offset: 3 };
  const parts = (layout: RoomLayout) => ({
    wall: layout.floors[0]!.interiorWalls?.some((wall) => wall.id === ENTRANCE_WALL_ID) ?? false,
    door: layout.floors[0]!.items.some((item) => item.id === ENTRANCE_DOOR_ID),
  });

  it('filling the corner builds the porch the cut was stopping', () => {
    const onL = run(house({ cutout }), { type: 'setEntrance', entrance: porch });
    expect(parts(onL)).toEqual({ wall: false, door: false });
    const filled = run(onL, { type: 'setCutout', cutout: null });
    expect(parts(filled)).toEqual({ wall: true, door: true });
  });

  it('moving the cut away builds it too', () => {
    const onL = run(house({ cutout }), { type: 'setEntrance', entrance: porch });
    expect(parts(run(onL, { type: 'setCutout', cutout: { ...cutout, corner: 'se' } }))).toEqual({ wall: true, door: true });
  });

  it('a cut elsewhere leaves one wall and one door', () => {
    const built = run(house(), { type: 'setEntrance', entrance: { ...porch, offset: -2 } });
    const cut = run(built, { type: 'setCutout', cutout });
    expect(cut.floors[0]!.interiorWalls!.filter((wall) => wall.id === ENTRANCE_WALL_ID)).toHaveLength(1);
    expect(parts(cut)).toEqual({ wall: true, door: true });
  });
});

describe('a save loads as it was stored', () => {
  const door = (id: string, x: number, z: number) => makeItem({ id, type: 'door', name: id, width: 0.9, depth: 0.12, position: { x, z }, rotation: 0 });
  const load = (layout: RoomLayout) => parseStoredLayout(JSON.parse(JSON.stringify(layout)))!;

  it('leaves a door that is on no wall where it stands', () => {
    const orphan = door('orphan', -2, 1.3);
    expect(load(house({ cutout, floors: [makeFloor({ items: [orphan] })] })).floors[0]!.items[0]!.position).toEqual({ x: -2, z: 1.3 });
  });

  it('still settles one in the corner', () => {
    const [inside] = load(house({ cutout, floors: [makeFloor({ items: [door('in', 3, -2)] })] })).floors[0]!.items;
    expect(inside!.position).not.toEqual({ x: 3, z: -2 });
  });
});

describe('a cut that stacks two doors', () => {
  const door = (id: string, x: number) => makeItem({ id, type: 'door', name: id, width: 0.9, depth: 0.12, height: 2, position: { x, z: 0 }, rotation: 0 });
  const walled = house({ floors: [makeFloor({ interiorWalls: [{ id: 'a', x1: -5, z1: 0, x2: 5, z2: 0 }], items: [door('Left door', 0), door('Near door', 0.9), door('Far door', 1.8)] })] });
  const deep: FootprintCutout = { corner: 'ne', width: 4, depth: 5 };

  it('is refused, naming both', () => {
    expect(cutoutRefusal(walled, deep)).toMatch(/The (Near|Far) door would land on the (Near|Far|Left) door/);
    expect(withCutout(walled, deep)).toBe(walled);
  });

  it('a lone door that moves is no clash', () => {
    const lone = house({ floors: [makeFloor({ interiorWalls: [{ id: 'a', x1: -5, z1: 0, x2: 5, z2: 0 }], items: [door('Door', 1.8)] })] });
    expect(cutoutRefusal(lone, deep)).toBeNull();
  });
});

describe('a crafted file with everything in the corner', () => {
  const pile = (count: number) =>
    makeLayout({
      width: 100,
      height: 100,
      roof: { style: 'flat' },
      cutout: { corner: 'ne', width: 12, depth: 12 },
      floors: [makeFloor({ items: Array.from({ length: count }, (_, i) => makeItem({ id: `c${i}`, width: 0.5, depth: 0.5, height: 0.8, position: { x: 45, z: -45 } })) })],
    });

  it('parses in time, and what the search reached is out of the corner', () => {
    const raw = JSON.parse(JSON.stringify(pile(2000)));
    const started = performance.now();
    const loaded = parseStoredLayout(raw)!;
    expect(performance.now() - started).toBeLessThan(3000);
    const moved = loaded.floors[0]!.items.filter((item) => item.position!.x !== 45 || item.position!.z !== -45);
    expect(moved.length).toBeGreaterThan(1900);
  });

  it('a pile a fit can place goes down without overlaps', () => {
    const items = parseStoredLayout(JSON.parse(JSON.stringify(pile(60))))!.floors[0]!.items;
    const spots = new Set(items.map((item) => `${item.position!.x}:${item.position!.z}`));
    expect(spots.size).toBe(60);
  });
});
