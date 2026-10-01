import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { MAX_FLOORS, MAX_ITEM_DIMENSION, MAX_ROOM_DIMENSION, ROOM_TEMPLATES } from './constants';
import {
  MAX_COLOR_LENGTH,
  MAX_COORDINATE,
  MAX_ICON_LENGTH,
  MAX_ID_LENGTH,
  MAX_INTERIOR_WALLS_PER_FLOOR,
  MAX_ITEMS_PER_FLOOR,
  MAX_LAYOUT_JSON_BYTES,
  MAX_NAME_LENGTH,
  isFloorLayout,
  isFurnitureItem,
  isRoomLayout,
  parseStoredLayout,
} from './schema';
import { ENTRANCE_DOOR_ID, ENTRANCE_WALL_ID } from './street';
import { MAX_STORAGE_ENTRY_CHARS } from './version-history';
import { MAX_ZONES } from './zones';
import type { FurnitureItem, RoomLayout } from './types';

describe('isFurnitureItem', () => {
  it('accepts a well-formed item', () => {
    expect(isFurnitureItem(makeItem())).toBe(true);
  });

  it.each([
    ['uncapped width', makeItem({ width: 1e12 })],
    ['uncapped height', makeItem({ height: MAX_ITEM_DIMENSION + 1 })],
    ['negative signalRange', makeItem({ signalRange: -3 })],
    ['negative visionRange', makeItem({ visionRange: -1 })],
    ['visionFov over a full circle', makeItem({ visionFov: 720 })],
    ['unknown sofaShape', makeItem({ sofaShape: 'Z-shape' as never })],
    ['non-string cctvModelId', makeItem({ cctvModelId: 42 as never })],
    ['non-boolean hasVisionCone', makeItem({ hasVisionCone: 'yes' as never })],
  ])('rejects %s (#121)', (_label, value) => {
    expect(isFurnitureItem(value)).toBe(false);
  });

  it('accepts valid enum/range fields (#121)', () => {
    expect(
      isFurnitureItem(
        makeItem({ sofaShape: 'L-shape', visionFov: 90, visionRange: 5, signalRange: 8, hasVisionCone: true, cctvModelId: 'some-model' })
      )
    ).toBe(true);
  });

  it('accepts a string groupId and rejects anything else (#154)', () => {
    expect(isFurnitureItem(makeItem({ groupId: 'group-abc' }))).toBe(true);
    expect(isFurnitureItem(makeItem({ groupId: 7 as never }))).toBe(false);
    expect(isFurnitureItem(makeItem({ groupId: '' }))).toBe(false);
    expect(isFurnitureItem(makeItem({ groupId: null as never }))).toBe(false);
  });

  it('accepts an item without optional fields', () => {
    const minimal = {
      id: 'a',
      type: 'chair',
      name: 'Chair',
      width: 1,
      depth: 1,
      height: 1,
      color: '#fff',
      icon: 'x',
    };
    expect(isFurnitureItem(minimal)).toBe(true);
  });

  it.each([
    ['non-object', null],
    ['missing id', { ...makeItem(), id: 5 }],
    ['zero width', { ...makeItem(), width: 0 }],
    ['negative depth', { ...makeItem(), depth: -1 }],
    ['non-finite height', { ...makeItem(), height: Number.POSITIVE_INFINITY }],
    ['non-string color', { ...makeItem(), color: 123 }],
    ['malformed position', { ...makeItem(), position: { x: 1 } }],
    ['non-finite rotation', { ...makeItem(), rotation: Number.NaN }],
    ['non-boolean locked', { ...makeItem(), locked: 'no' }],
    ['non-boolean mirrored', { ...makeItem(), mirrored: 1 }],
    ['non-boolean isWiFiAccessPoint', { ...makeItem(), isWiFiAccessPoint: 'yes' }],
  ])('rejects %s', (_label, value) => {
    expect(isFurnitureItem(value)).toBe(false);
  });
});

describe('isFloorLayout', () => {
  it('accepts a valid floor', () => {
    expect(isFloorLayout(makeFloor({ items: [makeItem()] }))).toBe(true);
  });

  it('rejects a floor whose items are malformed', () => {
    expect(isFloorLayout(makeFloor({ items: [{ id: 'bad' } as never] }))).toBe(false);
  });

  it('rejects a floor with a non-string wall color', () => {
    expect(isFloorLayout({ ...makeFloor(), wallColors: { north: 5 } })).toBe(false);
  });

  it('rejects a floor whose interior wall has a non-finite coordinate', () => {
    const floor = { ...makeFloor(), interiorWalls: [{ id: 'w', x1: 0, z1: 0, x2: Number.NaN, z2: 1 }] };
    expect(isFloorLayout(floor)).toBe(false);
  });

  it('accepts an in-range storey height and rejects a corrupt one (#202)', () => {
    expect(isFloorLayout({ ...makeFloor(), height: 2.5 })).toBe(true);
    expect(isFloorLayout({ ...makeFloor(), height: 1.1 })).toBe(true);
    for (const height of [0, -3, 0.5, 40, Number.NaN, '3']) {
      expect(isFloorLayout({ ...makeFloor(), height })).toBe(false);
    }
  });

  it('accepts room zones and rejects a NaN corner, a non-positive size or a nameless one (#155)', () => {
    const zone = { id: 'z1', name: 'Bedroom', color: '#3b82f6', x: -2, z: -1, w: 3, d: 2 };
    expect(isFloorLayout({ ...makeFloor(), zones: [] })).toBe(true);
    expect(isFloorLayout({ ...makeFloor(), zones: [zone] })).toBe(true);
    expect(isFloorLayout({ ...makeFloor(), zones: [{ ...zone, x: Number.NaN }] })).toBe(false);
    expect(isFloorLayout({ ...makeFloor(), zones: [{ ...zone, w: 0 }] })).toBe(false);
    expect(isFloorLayout({ ...makeFloor(), zones: [{ ...zone, d: -1 }] })).toBe(false);
    expect(isFloorLayout({ ...makeFloor(), zones: [{ ...zone, name: undefined }] })).toBe(false);
    expect(isFloorLayout({ ...makeFloor(), zones: zone })).toBe(false);
  });
});

describe('isRoomLayout', () => {
  it('accepts winder stairs and rejects unknown shapes or lead-ins (#205)', () => {
    const stairs = makeItem({ type: 'stairs', stairsShape: 'winder', stairsLeadIn: 2 });
    expect(isFurnitureItem(stairs)).toBe(true);
    expect(isFurnitureItem({ ...stairs, stairsShape: 'spiral' })).toBe(false);
    expect(isFurnitureItem({ ...stairs, stairsLeadIn: 1.5 })).toBe(false);
    expect(isFurnitureItem({ ...stairs, stairsLeadIn: 40 })).toBe(false);
  });

  it('accepts an entrance, frontage and window sills, and rejects corrupt ones (#204)', () => {
    const window = makeItem({ type: 'window', sillHeight: 0.4 });
    expect(isRoomLayout(makeLayout({ entrance: { width: 1.4, depth: 1.2 }, frontage: 'pavement' }))).toBe(true);
    expect(isFurnitureItem(window)).toBe(true);
    expect(isFurnitureItem({ ...window, sillHeight: -1 })).toBe(false);
    expect(isRoomLayout({ ...makeLayout(), entrance: { width: 1.4 } })).toBe(false);
    expect(isRoomLayout({ ...makeLayout(), frontage: 'lawn' })).toBe(false);
  });

  it('accepts roof dormers and rejects corrupt ones (#203)', () => {
    const dormer = { id: 'd', side: 'south', width: 2, window: true };
    expect(isRoomLayout(makeLayout({ roof: { style: 'gable', dormers: [dormer] as never } }))).toBe(true);
    for (const dormers of ['x', [{ ...dormer, width: -1 }], Array.from({ length: 7 }, () => dormer)]) {
      expect(isRoomLayout({ ...makeLayout(), roof: { style: 'gable', dormers } })).toBe(false);
    }
  });

  it('accepts a sloped site with neighbours, and rejects corrupt ones (#202)', () => {
    expect(isRoomLayout(makeLayout({ terrain: { frontY: 2.5, backY: 0 }, neighbours: { east: true } }))).toBe(true);
    expect(isRoomLayout(makeLayout({ neighbours: { west: false } }))).toBe(true);
    for (const terrain of [{ frontY: 2.5 }, { frontY: 99, backY: 0 }, { frontY: Number.NaN, backY: 0 }, 'hill']) {
      expect(isRoomLayout({ ...makeLayout(), terrain })).toBe(false);
    }
    for (const neighbours of [{ north: true }, { east: 'yes' }, ['east']]) {
      expect(isRoomLayout({ ...makeLayout(), neighbours })).toBe(false);
    }
  });

  it('accepts the street rows and their seed, and rejects a bad seed or flag (#310)', () => {
    expect(isRoomLayout(makeLayout({ neighbours: { west: true, street: true, across: true, seed: 7 } }))).toBe(true);
    expect(isRoomLayout(makeLayout({ neighbours: { seed: 0 } }))).toBe(true);
    for (const neighbours of [{ seed: 1.5 }, { seed: -1 }, { seed: '7' }, { seed: 2 ** 31 }, { street: 'yes' }, { shuffle: true }]) {
      expect(isRoomLayout({ ...makeLayout(), neighbours })).toBe(false);
    }
  });

  it('accepts the current multi-floor shape', () => {
    expect(isRoomLayout(makeLayout())).toBe(true);
  });

  it.each([
    ['zero width', makeLayout({ width: 0 })],
    ['negative height', makeLayout({ height: -4 })],
    ['over-max dimension', makeLayout({ width: MAX_ROOM_DIMENSION + 1 })],
    ['empty floors', makeLayout({ floors: [] })],
    ['too many floors', makeLayout({ floors: Array.from({ length: MAX_FLOORS + 1 }, (_, i) => makeFloor({ id: `f${i}` })) })],
    ['non-string layout id', makeLayout({ id: 7 as never })],
    ['floorPlanOpacity above 1', makeLayout({ floorPlanOpacity: 1.5 })],
    ['negative floorPlanOpacity', makeLayout({ floorPlanOpacity: -0.2 })],
  ])('rejects %s', (_label, value) => {
    expect(isRoomLayout(value)).toBe(false);
  });

  it('rejects an interior wall with a non-string color (#121)', () => {
    const floor = { ...makeFloor(), interiorWalls: [{ id: 'w', x1: 0, z1: 0, x2: 1, z2: 1, color: 5 }] };
    expect(isFloorLayout(floor)).toBe(false);
  });

  it('rejects a bad roof style', () => {
    expect(isRoomLayout({ ...makeLayout(), roof: { style: 'dome' } })).toBe(false);
  });

  it('rejects a bad floorPlanFitMode', () => {
    expect(isRoomLayout({ ...makeLayout(), floorPlanFitMode: 'squish' })).toBe(false);
  });

  it('accepts a data:image floorPlanImage', () => {
    const layout = makeLayout({ floorPlanImage: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(isRoomLayout(layout)).toBe(true);
  });

  it('rejects a non-data-URL floorPlanImage (would trigger an outbound fetch)', () => {
    const layout = makeLayout({ floorPlanImage: 'http://attacker.example/beacon.png' });
    expect(isRoomLayout(layout)).toBe(false);
  });

  it('accepts exactly MAX_ROOM_DIMENSION and exactly MAX_FLOORS', () => {
    const layout = makeLayout({
      width: MAX_ROOM_DIMENSION,
      floors: Array.from({ length: MAX_FLOORS }, (_, i) => makeFloor({ id: `f${i}` })),
    });
    expect(isRoomLayout(layout)).toBe(true);
  });
});

describe('parseStoredLayout', () => {
  it('accepts and returns the current multi-floor shape as-is', () => {
    const layout = makeLayout();
    expect(parseStoredLayout(layout)).toBe(layout);
  });

  it('accepts saves carrying the retired stairsDirection and strips it (#410)', () => {
    const stairs = { ...makeItem({ id: 'st', type: 'stairs' }), stairsDirection: 'north' };
    const sofa = makeItem({ id: 'sofa' });
    const untouchedFloor = makeFloor({ id: 'upper', items: [makeItem({ id: 'bed' })] });
    const layout = makeLayout({
      floors: [makeFloor({ items: [stairs as FurnitureItem, sofa] }), untouchedFloor],
    });
    const parsed = parseStoredLayout(JSON.parse(JSON.stringify(layout)));
    expect(parsed).not.toBeNull();
    const [ground, upper] = parsed?.floors ?? [];
    expect(ground?.items.map((i) => i.id)).toEqual(['st', 'sofa']);
    expect(ground?.items.some((i) => 'stairsDirection' in i)).toBe(false);
    expect(upper?.items).toHaveLength(1);
    // Any legacy value is tolerated; nothing reads it.
    const odd = makeLayout({
      floors: [makeFloor({ items: [{ ...stairs, stairsDirection: 'up' } as FurnitureItem] })],
    });
    expect(parseStoredLayout(odd)?.floors[0]?.items[0]).not.toHaveProperty('stairsDirection');
  });

  it('strips stairsDirection from a legacy single-floor save too (#410)', () => {
    const legacy = {
      name: 'Old',
      width: 6,
      height: 7,
      floorColor: '#fff',
      items: [{ ...makeItem({ id: 'st', type: 'stairs' }), stairsDirection: 'east' }],
    };
    const parsed = parseStoredLayout(legacy);
    expect(parsed?.floors[0]?.items[0]?.id).toBe('st');
    expect(parsed?.floors[0]?.items[0]).not.toHaveProperty('stairsDirection');
  });

  it('migrates a legacy single-floor layout into the multi-floor shape', () => {
    const legacy = {
      name: 'Legacy Home',
      width: 6,
      height: 7,
      items: [makeItem({ id: 'sofa' })],
      floorColor: '#deadbe',
      floorPattern: 'wood',
      wallPattern: 'brick',
      wallColors: { north: '#111' },
      floorPlanOpacity: 0.4,
    };
    const parsed = parseStoredLayout(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed!.floors).toHaveLength(1);
    const ground = parsed!.floors[0]!;
    expect(ground).toMatchObject({
      id: 'ground',
      name: 'Ground Floor',
      floorColor: '#deadbe',
      floorPattern: 'wood',
      wallPattern: 'brick',
      wallColors: { north: '#111' },
    });
    expect(ground.items.map((i) => i.id)).toEqual(['sofa']);
    expect(parsed!.floorPlanOpacity).toBe(0.4);
    // Legacy has no floors key.
    expect('floors' in legacy).toBe(false);
  });

  it('migrates a legacy layout but drops an unsafe (non-data-URL) floorPlanImage', () => {
    const legacy = {
      name: 'Legacy Home',
      width: 6,
      height: 7,
      items: [makeItem({ id: 'sofa' })],
      floorColor: '#deadbe',
      floorPlanImage: 'http://attacker.example/beacon.png',
    };
    const parsed = parseStoredLayout(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed!.floorPlanImage).toBeUndefined();
    expect(parsed!.floors[0]!.items.map((i) => i.id)).toEqual(['sofa']);
  });

  it('migrates a legacy layout and keeps a safe data:image floorPlanImage', () => {
    const legacy = {
      name: 'Legacy Home',
      width: 6,
      height: 7,
      items: [],
      floorColor: '#deadbe',
      floorPlanImage: 'data:image/jpeg;base64,/9j/4AAQ',
    };
    const parsed = parseStoredLayout(legacy);
    expect(parsed!.floorPlanImage).toBe('data:image/jpeg;base64,/9j/4AAQ');
  });

  it('does not treat an object that already has floors as legacy', () => {
    // A malformed multi-floor object (bad floor) should be rejected, not migrated.
    const almost = { ...makeLayout(), floors: [{ id: 'x' }] };
    expect(parseStoredLayout(almost)).toBeNull();
  });

  it.each([
    ['null', null],
    ['a string', 'not a layout'],
    ['non-positive dims', makeLayout({ width: 0 })],
    ['bad roof style', { ...makeLayout(), roof: { style: 'dome' } }],
    ['over MAX_FLOORS', makeLayout({ floors: Array.from({ length: MAX_FLOORS + 1 }, (_, i) => makeFloor({ id: `f${i}` })) })],
    ['non-boolean flag on item', makeLayout({ floors: [makeFloor({ items: [{ ...makeItem(), locked: 'no' } as never] })] })],
    ['malformed position on item', makeLayout({ floors: [makeFloor({ items: [{ ...makeItem(), position: { x: 1 } } as never] })] })],
  ])('rejects %s (returns null)', (_label, value) => {
    expect(parseStoredLayout(value)).toBeNull();
  });
});

describe('schema hardening (#208)', () => {
  const legacyBase = {
    name: 'Legacy',
    width: 8,
    height: 8,
    items: [makeItem()],
    floorColor: '#c9a57d',
  };

  /** The regression that matters: whatever migration emits must load again. */
  const reloads = (layout: unknown) =>
    parseStoredLayout(JSON.parse(JSON.stringify(layout))) !== null;

  it.each([
    ['unknown floorPattern', makeFloor({ floorPattern: 'marble' as never })],
    ['unknown wallPattern', makeFloor({ wallPattern: 'stucco' as never })],
  ])('isFloorLayout rejects an %s', (_label, floor) => {
    expect(isFloorLayout(floor)).toBe(false);
  });

  it('isFloorLayout accepts catalogued patterns', () => {
    expect(isFloorLayout(makeFloor({ floorPattern: 'wood', wallPattern: 'brick' }))).toBe(true);
  });

  it('legacy migration clamps an out-of-range floorPlanOpacity', () => {
    const parsed = parseStoredLayout({ ...legacyBase, floorPlanOpacity: 5 });
    expect(parsed?.floorPlanOpacity).toBe(1);
    expect(reloads(parsed)).toBe(true);
  });

  it('legacy migration drops a non-finite opacity and an unknown fit mode', () => {
    const parsed = parseStoredLayout({
      ...legacyBase,
      floorPlanOpacity: Number.NaN,
      floorPlanFitMode: 'zoom',
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.floorPlanOpacity).toBeUndefined();
    expect(parsed?.floorPlanFitMode).toBeUndefined();
    expect(reloads(parsed)).toBe(true);
  });

  it('legacy migration keeps valid floor-plan fields and patterns', () => {
    const parsed = parseStoredLayout({
      ...legacyBase,
      floorPlanOpacity: 0.4,
      floorPlanFitMode: 'cover',
      floorPattern: 'tile',
      wallPattern: 'brick',
    });
    expect(parsed?.floorPlanOpacity).toBe(0.4);
    expect(parsed?.floorPlanFitMode).toBe('cover');
    expect(parsed?.floors[0]?.floorPattern).toBe('tile');
    expect(parsed?.floors[0]?.wallPattern).toBe('brick');
  });

  it('legacy migration drops unknown patterns so the migrated save reloads', () => {
    const parsed = parseStoredLayout({
      ...legacyBase,
      floorPattern: 'marble',
      wallPattern: 'stucco',
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.floors[0]?.floorPattern).toBeUndefined();
    expect(parsed?.floors[0]?.wallPattern).toBeUndefined();
    expect(reloads(parsed)).toBe(true);
  });
});

describe('schema caps (#332)', () => {
  const withItem = (item: Record<string, unknown>) => makeLayout({ floors: [makeFloor({ items: [item as never] })] });

  const only = (layout: RoomLayout | null) => layout!.floors[0]!;

  it('keeps strings at their caps and truncates them past', () => {
    const atCap = makeItem({
      id: 'i'.repeat(MAX_ID_LENGTH),
      name: 'n'.repeat(MAX_NAME_LENGTH),
      color: 'c'.repeat(MAX_COLOR_LENGTH),
      icon: '🪑'.repeat(MAX_ICON_LENGTH / 2),
      groupId: 'g'.repeat(MAX_ID_LENGTH),
    });
    const clean = withItem({ ...atCap });
    expect(parseStoredLayout(clean)).toBe(clean);
    for (const [field, max] of [
      ['id', MAX_ID_LENGTH],
      ['type', MAX_ID_LENGTH],
      ['name', MAX_NAME_LENGTH],
      ['color', MAX_COLOR_LENGTH],
      ['icon', MAX_ICON_LENGTH],
      ['cctvModelId', MAX_ID_LENGTH],
      ['groupId', MAX_ID_LENGTH],
    ] as const) {
      const item = only(parseStoredLayout(withItem({ ...atCap, [field]: 'x'.repeat(max + 1) }))).items[0]!;
      expect(item[field], field).toBe('x'.repeat(max));
    }
    expect(parseStoredLayout(makeLayout({ name: 'h'.repeat(MAX_NAME_LENGTH + 1) }))!.name).toBe('h'.repeat(MAX_NAME_LENGTH));
    const floor = only(
      parseStoredLayout(
        makeLayout({
          floors: [
            makeFloor({
              id: 'i'.repeat(MAX_ID_LENGTH + 1),
              name: 'f'.repeat(MAX_NAME_LENGTH + 1),
              floorColor: '#'.repeat(MAX_COLOR_LENGTH + 1),
              wallColors: { north: '#'.repeat(MAX_COLOR_LENGTH + 1) },
              interiorWalls: [{ id: 'w'.repeat(MAX_ID_LENGTH + 1), x1: 0, z1: 0, x2: 1, z2: 0, color: '#'.repeat(MAX_COLOR_LENGTH + 1) }],
              zones: [{ id: 'z', name: 'k'.repeat(MAX_NAME_LENGTH + 1), color: '#abcdef', x: 0, z: 0, w: 2, d: 2 }],
            }),
          ],
        })
      )
    );
    expect(floor.id).toHaveLength(MAX_ID_LENGTH);
    expect(floor.name).toHaveLength(MAX_NAME_LENGTH);
    expect(floor.floorColor).toHaveLength(MAX_COLOR_LENGTH);
    expect(floor.wallColors!.north).toHaveLength(MAX_COLOR_LENGTH);
    expect(floor.interiorWalls![0]!.id).toHaveLength(MAX_ID_LENGTH);
    expect(floor.interiorWalls![0]!.color).toHaveLength(MAX_COLOR_LENGTH);
    expect(floor.zones![0]!.name).toHaveLength(MAX_NAME_LENGTH);
    const roof = parseStoredLayout({ ...makeLayout(), roof: { style: 'flat', color: '#'.repeat(MAX_COLOR_LENGTH + 1) } })!.roof;
    expect(roof!.color).toHaveLength(MAX_COLOR_LENGTH);
  });

  it('never cuts a surrogate pair in half', () => {
    const icon = only(parseStoredLayout(withItem({ ...makeItem(), icon: `a${'🪑'.repeat(MAX_ICON_LENGTH)}` }))).items[0]!.icon;
    expect(icon).toBe(`a${'🪑'.repeat(MAX_ICON_LENGTH / 2 - 1)}`);
  });

  it('truncates the 30 M-character name of the share-link probe', () => {
    expect(parseStoredLayout(makeLayout({ name: ' '.repeat(30_000) }))!.name).toHaveLength(MAX_NAME_LENGTH);
    expect(only(parseStoredLayout(withItem({ ...makeItem(), name: 'A'.repeat(1_000_000) }))).items[0]!.name).toHaveLength(
      MAX_NAME_LENGTH
    );
  });

  it('keeps ids unique after truncation', () => {
    const long = 'i'.repeat(MAX_ID_LENGTH);
    const items = only(
      parseStoredLayout(
        makeLayout({ floors: [makeFloor({ items: [makeItem({ id: `${long}a` }), makeItem({ id: `${long}b` })] })] })
      )
    ).items;
    expect(items.map((item) => item.id)).toEqual([long, `${'i'.repeat(MAX_ID_LENGTH - 2)}-2`]);
  });

  it('slices items and interior walls past the per-floor caps, keeping one slot for the porch', () => {
    const items = (count: number) =>
      Array.from({ length: count }, (_, i) => makeItem({ id: `i${i}`, position: { x: 0, z: 0 } }));
    const walls = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `w${i}`, x1: 0, z1: 0, x2: 1, z2: i / 10 }));
    // What the reducer can produce — one slot short of the cap — is untouched.
    const full = makeLayout({ floors: [makeFloor({ items: items(MAX_ITEMS_PER_FLOOR - 1) })] });
    expect(parseStoredLayout(full)).toBe(full);
    expect(only(parseStoredLayout(makeLayout({ floors: [makeFloor({ items: items(MAX_ITEMS_PER_FLOOR + 1) })] }))).items).toHaveLength(
      MAX_ITEMS_PER_FLOOR - 1
    );
    const wallFloor = only(
      parseStoredLayout(makeLayout({ floors: [makeFloor({ interiorWalls: walls(MAX_INTERIOR_WALLS_PER_FLOOR + 1) })] }))
    );
    expect(wallFloor.interiorWalls).toHaveLength(MAX_INTERIOR_WALLS_PER_FLOOR - 1);
    // Legacy saves get the same cap.
    const legacy = parseStoredLayout({ name: 'Old', width: 6, height: 7, floorColor: '#fff', items: items(MAX_ITEMS_PER_FLOOR + 1) });
    expect(only(legacy).items).toHaveLength(MAX_ITEMS_PER_FLOOR - 1);
  });

  it('never cuts the porch door or back wall from a full floor', () => {
    const items = Array.from({ length: MAX_ITEMS_PER_FLOOR }, (_, i) => makeItem({ id: `i${i}`, position: { x: 0, z: 0 } }));
    const door = makeItem({ id: ENTRANCE_DOOR_ID, type: 'door', position: { x: 0, z: -4 } });
    const walls = Array.from({ length: MAX_INTERIOR_WALLS_PER_FLOOR }, (_, i) => ({ id: `w${i}`, x1: 0, z1: 0, x2: 1, z2: i / 10 }));
    const back = { id: ENTRANCE_WALL_ID, x1: -0.7, z1: -2.8, x2: 0.7, z2: -2.8 };
    const floor = only(
      parseStoredLayout(makeLayout({ floors: [makeFloor({ items: [...items, door], interiorWalls: [...walls, back] })] }))
    );
    expect(floor.items).toHaveLength(MAX_ITEMS_PER_FLOOR);
    expect(floor.items.some((item) => item.id === ENTRANCE_DOOR_ID)).toBe(true);
    expect(floor.interiorWalls).toHaveLength(MAX_INTERIOR_WALLS_PER_FLOOR);
    expect(floor.interiorWalls!.some((wall) => wall.id === ENTRANCE_WALL_ID)).toBe(true);
    // And the repaired floor is stable.
    const again = parseStoredLayout(JSON.parse(JSON.stringify(makeLayout({ floors: [floor] }))));
    expect(only(again).items).toHaveLength(MAX_ITEMS_PER_FLOOR);
  });

  it('slices zones past MAX_ZONES instead of refusing the floor, and de-duplicates dormer ids', () => {
    const zones = Array.from({ length: MAX_ZONES + 3 }, (_, i) => ({ id: `z${i}`, name: 'Z', color: '#123456', x: 0, z: 0, w: 1, d: 1 }));
    const parsed = parseStoredLayout(makeLayout({ floors: [makeFloor({ zones })] }));
    expect(only(parsed).zones).toHaveLength(MAX_ZONES);
    const dormer = { id: 'd', side: 'south' as const, width: 1.6 };
    const roofed = parseStoredLayout(makeLayout({ roof: { style: 'gable', color: '#555555', dormers: [dormer, dormer] } }));
    const ids = roofed!.roof!.dormers!.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('opens a v1.14.0 save with an item at 250 m, a wall to 5 km and a 300-character name', () => {
    const saved = {
      name: 'H'.repeat(300),
      width: 100,
      height: 100,
      floors: [
        {
          id: 'ground',
          name: 'Ground Floor',
          floorColor: '#c9a57d',
          items: [
            { ...makeItem({ id: 'tree-1', category: 'outdoor', position: { x: 250, z: -250 } }) },
            { ...makeItem({ id: 'far', position: { x: 5000, z: -1e300 } }) },
          ],
          interiorWalls: [{ id: 'w', x1: 0, z1: 0, x2: 5000, z2: 0 }],
        },
      ],
    };
    const parsed = parseStoredLayout(JSON.parse(JSON.stringify(saved)));
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('H'.repeat(MAX_NAME_LENGTH));
    const floor = only(parsed);
    expect(floor.items[0]!.position).toEqual({ x: 250, z: -250 });
    expect(floor.items[1]!.position).toEqual({ x: MAX_COORDINATE, z: -MAX_COORDINATE });
    expect(floor.interiorWalls![0]!.x2).toBe(MAX_COORDINATE);
    // Repaired once, it stays put.
    expect(parseStoredLayout(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('a house at every cap still fits in browser storage', () => {
    const floors = Array.from({ length: MAX_FLOORS }, (_, f) =>
      makeFloor({
        id: `floor-${f}`,
        items: Array.from({ length: MAX_ITEMS_PER_FLOOR }, (_, i) =>
          makeItem({ id: `sofa-1790000000000-${f}-${i}`, type: 'sofa', name: 'Sofa', price: 650, category: 'seating', position: { x: i / 100, z: -i / 100 }, rotation: 1.5707963267948966 })
        ),
      })
    );
    const json = JSON.stringify(makeLayout({ floors }));
    expect(json.length).toBeLessThan(MAX_STORAGE_ENTRY_CHARS);
    expect(JSON.stringify(makeLayout({ floors }), null, 2).length).toBeLessThan(MAX_LAYOUT_JSON_BYTES);
  });
});

describe('persisted-field whitelist and bounds (#350)', () => {
  it('drops unknown keys at every level, including an own __proto__', () => {
    const json = JSON.stringify({
      ...makeLayout({
        floors: [
          {
            ...makeFloor({
              items: [{ ...makeItem({ id: 'a' }), extra: 1, position: { x: 1, z: 2, y: 9 } } as never],
              interiorWalls: [{ id: 'w', x1: 0, z1: 0, x2: 1, z2: 0, thickness: 3 } as never],
              zones: [{ id: 'z', name: 'Kitchen', color: '#abcdef', x: 0, z: 0, w: 2, d: 2, area: 4 } as never],
            }),
            note: 'x',
          } as never,
        ],
        roof: { style: 'gable', dormers: [{ id: 'd', side: 'south', width: 2, openings: [{ kind: 'casement', from: 0.1, to: 0.9, x: 1 }], tint: 1 }], pitch: 30 } as never,
        terrain: { frontY: 0, backY: -1, slope: 3 } as never,
        entrance: { width: 1.4, depth: 1.2, glow: true } as never,
      }),
      bloat: 'xxxxxxxxxx',
    }).replace('"bloat"', '"__proto__":{"polluted":true},"bloat"');
    const parsed = parseStoredLayout(JSON.parse(json));
    expect(parsed).not.toBeNull();
    const layout = parsed as unknown as Record<string, unknown>;
    expect('bloat' in layout).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(layout, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const floor = parsed!.floors[0]!;
    expect(floor).not.toHaveProperty('note');
    expect(floor.items[0]).not.toHaveProperty('extra');
    expect(floor.items[0]!.position).toEqual({ x: 1, z: 2 });
    expect(floor.interiorWalls![0]).not.toHaveProperty('thickness');
    expect(floor.zones![0]).not.toHaveProperty('area');
    expect(parsed!.roof).not.toHaveProperty('pitch');
    expect(parsed!.roof!.dormers![0]).not.toHaveProperty('tint');
    expect(parsed!.roof!.dormers![0]!.openings![0]).toEqual({ kind: 'casement', from: 0.1, to: 0.9 });
    expect(parsed!.terrain).toEqual({ frontY: 0, backY: -1 });
    expect(parsed!.entrance).toEqual({ width: 1.4, depth: 1.2 });
  });

  it('repairs the issue probe: position 1e300 and a negative price', () => {
    const item = (overrides: Record<string, unknown>) => makeLayout({ floors: [makeFloor({ items: [{ ...makeItem(), ...overrides } as never] })] });
    const first = (layout: RoomLayout | null) => layout!.floors[0]!.items[0]!;
    expect(first(parseStoredLayout(item({ position: { x: 1e300, z: 0 } }))).position).toEqual({ x: MAX_COORDINATE, z: 0 });
    expect(first(parseStoredLayout(item({ position: { x: 0, z: -(MAX_COORDINATE + 1) } }))).position).toEqual({
      x: 0,
      z: -MAX_COORDINATE,
    });
    const atCap = item({ position: { x: MAX_COORDINATE, z: -MAX_COORDINATE } });
    expect(parseStoredLayout(atCap)).toBe(atCap);
    expect(first(parseStoredLayout(item({ price: -5 }))).price).toBe(0);
    // A wall clamped to nothing (both ends past the same corner) is dropped.
    const walls = [
      { id: 'w', x1: 0, z1: 0, x2: MAX_COORDINATE + 1, z2: 0 },
      { id: 'gone', x1: 2e3, z1: 2e3, x2: 3e3, z2: 3e3 },
    ];
    const parsed = parseStoredLayout(makeLayout({ floors: [makeFloor({ interiorWalls: walls })] }));
    expect(parsed!.floors[0]!.interiorWalls).toEqual([{ id: 'w', x1: 0, z1: 0, x2: MAX_COORDINATE, z2: 0 }]);
  });

  it('keeps only real, distinct hidden walls and wall-colour keys', () => {
    const parsed = parseStoredLayout(
      makeLayout({
        floors: [
          makeFloor({
            hiddenWalls: ['up', 'north', 'south', 'north'] as never,
            wallColors: { north: '#111111', roof: '#222222' } as never,
          }),
        ],
      })
    );
    expect(parsed!.floors[0]!.hiddenWalls).toEqual(['north', 'south']);
    expect(parsed!.floors[0]!.wallColors).toEqual({ north: '#111111' });
    expect(parseStoredLayout(makeLayout({ floors: [makeFloor({ hiddenWalls: [7] as never })] }))).toBeNull();
  });

  it('drops zero-length interior walls', () => {
    const walls = [
      { id: 'dot', x1: 1, z1: 1, x2: 1, z2: 1 },
      { id: 'real', x1: 0, z1: 0, x2: 2, z2: 0 },
    ];
    const parsed = parseStoredLayout(makeLayout({ floors: [makeFloor({ interiorWalls: walls })] }));
    expect(parsed!.floors[0]!.interiorWalls!.map((wall) => wall.id)).toEqual(['real']);
  });

  it('keeps every field a fully-populated item can carry', () => {
    const item: Required<FurnitureItem> = {
      id: 'cam',
      type: 'security-camera',
      name: 'Camera',
      width: 0.2,
      depth: 0.2,
      height: 0.2,
      color: '#ffffff',
      icon: '📷',
      price: 120,
      category: 'security',
      position: { x: 1, z: 1 },
      rotation: 0.5,
      isWiFiAccessPoint: false,
      isCCTV: true,
      signalRange: 8,
      hasVisionCone: true,
      visionRange: 6,
      visionFov: 90,
      cctvModelId: 'model-a',
      wallRotation: 0,
      cameraBracket: true,
      sofaShape: 'standard',
      locked: true,
      mirrored: true,
      stairsShape: 'winder',
      stairsLeadIn: 1,
      sillHeight: 0.9,
      groupId: 'group-1',
    };
    const layout = makeLayout({ floors: [makeFloor({ items: [item] })] });
    expect(parseStoredLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  });

  it('returns a clean input as the same object', () => {
    const layout = makeLayout({
      floors: [
        makeFloor({
          items: [makeItem({ id: 'a' }), makeItem({ id: 'b' })],
          hiddenWalls: ['north'],
          wallColors: { east: '#123456' },
          interiorWalls: [{ id: 'w', x1: 0, z1: 0, x2: 1, z2: 0 }],
        }),
      ],
      roof: { style: 'gable', dormers: [{ id: 'd', side: 'south', width: 2 }] },
      terrain: { frontY: 0, backY: -0.5 },
      entrance: { width: 1.4, depth: 1.2 },
    });
    expect(parseStoredLayout(layout)).toBe(layout);
  });
});

describe('duplicate ids (#338)', () => {
  it('suffixes a repeated item id on a floor', () => {
    const layout = makeLayout({
      floors: [makeFloor({ items: [makeItem({ id: 'a', color: '#111111' }), makeItem({ id: 'a', color: '#222222' }), makeItem({ id: 'a-2' })] })],
    });
    const items = parseStoredLayout(layout)!.floors[0]!.items;
    expect(items.map((item) => item.id)).toEqual(['a', 'a-3', 'a-2']);
    expect(items[1]!.color).toBe('#222222');
  });

  it('suffixes repeated floor, wall and zone ids', () => {
    const zone = { id: 'z', name: 'Room', color: '#abcdef', x: 0, z: 0, w: 2, d: 2 };
    const wall = { id: 'w', x1: 0, z1: 0, x2: 1, z2: 0 };
    const layout = makeLayout({
      floors: [
        makeFloor({ id: 'x', interiorWalls: [wall, { ...wall, x2: 2 }], zones: [zone, zone] }),
        makeFloor({ id: 'x', name: 'First Floor' }),
      ],
    });
    const parsed = parseStoredLayout(layout)!;
    expect(parsed.floors.map((floor) => floor.id)).toEqual(['x', 'x-2']);
    expect(parsed.floors[0]!.interiorWalls!.map((w) => w.id)).toEqual(['w', 'w-2']);
    expect(parsed.floors[0]!.zones!.map((z) => z.id)).toEqual(['z', 'z-2']);
  });

  it('keeps only the first porch door and porch back wall in the building', () => {
    const door = makeItem({ id: ENTRANCE_DOOR_ID, type: 'door' });
    const porchWall = { id: ENTRANCE_WALL_ID, x1: 0, z1: 0, x2: 1, z2: 0 };
    const layout = makeLayout({
      entrance: { width: 1.4, depth: 1.2 },
      floors: [
        makeFloor({ id: 'g', items: [door, makeItem({ id: 'sofa' }), door], interiorWalls: [porchWall, porchWall] }),
        makeFloor({ id: 'u', items: [door], interiorWalls: [porchWall] }),
      ],
    });
    const parsed = parseStoredLayout(layout)!;
    expect(parsed.floors[0]!.items.map((item) => item.id)).toEqual([ENTRANCE_DOOR_ID, 'sofa']);
    expect(parsed.floors[0]!.interiorWalls!.map((w) => w.id)).toEqual([ENTRANCE_WALL_ID]);
    expect(parsed.floors[1]!.items).toEqual([]);
    expect(parsed.floors[1]!.interiorWalls).toEqual([]);
  });

  it('a suffixed id at the length cap stays loadable', () => {
    const id = 'i'.repeat(MAX_ID_LENGTH);
    const parsed = parseStoredLayout(makeLayout({ floors: [makeFloor({ items: [makeItem({ id }), makeItem({ id })] })] }))!;
    const ids = parsed.floors[0]!.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((each) => each.length <= MAX_ID_LENGTH)).toBe(true);
    expect(parseStoredLayout(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('leaves ids repeated across floors alone', () => {
    const layout = makeLayout({
      floors: [makeFloor({ id: 'g', items: [makeItem({ id: 'a' })] }), makeFloor({ id: 'u', items: [makeItem({ id: 'a' })] })],
    });
    expect(parseStoredLayout(layout)).toBe(layout);
  });
});

describe('round trips', () => {
  it.each(Object.entries(ROOM_TEMPLATES))('the %s template survives save and load unchanged', (_key, template) => {
    const stored: unknown = JSON.parse(JSON.stringify(template));
    expect(parseStoredLayout(stored)).toEqual(template);
  });

  it.each(Object.entries(ROOM_TEMPLATES))('the %s template survives as an old single-floor save', (_key, template) => {
    const ground = template.floors[0]!;
    const legacy: unknown = JSON.parse(
      JSON.stringify({
        name: template.name,
        width: template.width,
        height: template.height,
        items: ground.items,
        floorColor: ground.floorColor,
        wallColors: { north: '#111111' },
      })
    );
    const parsed = parseStoredLayout(legacy)!;
    expect(parsed.floors).toHaveLength(1);
    expect(parsed.floors[0]!.items).toEqual(ground.items);
    // The migrated house is a current-format save that loads as itself.
    expect(parseStoredLayout(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('a cleaned layout parses to itself', () => {
    const messy = {
      ...makeLayout({
        floors: [makeFloor({ items: [makeItem({ id: 'a' }), makeItem({ id: 'a' })], hiddenWalls: ['up'] as never })],
      }),
      bloat: 1,
    };
    const once = parseStoredLayout(messy)!;
    expect(parseStoredLayout(once)).toBe(once);
  });
});
