import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { MAX_FLOORS, MAX_ROOM_DIMENSION } from './constants';
import { isFloorLayout, isFurnitureItem, isRoomLayout, parseStoredLayout } from './schema';

describe('isFurnitureItem', () => {
  it('accepts a well-formed item', () => {
    expect(isFurnitureItem(makeItem())).toBe(true);
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
});

describe('isRoomLayout', () => {
  it('accepts the current multi-floor shape', () => {
    expect(isRoomLayout(makeLayout())).toBe(true);
  });

  it.each([
    ['zero width', makeLayout({ width: 0 })],
    ['negative height', makeLayout({ height: -4 })],
    ['over-max dimension', makeLayout({ width: MAX_ROOM_DIMENSION + 1 })],
    ['empty floors', makeLayout({ floors: [] })],
    ['too many floors', makeLayout({ floors: Array.from({ length: MAX_FLOORS + 1 }, (_, i) => makeFloor({ id: `f${i}` })) })],
  ])('rejects %s', (_label, value) => {
    expect(isRoomLayout(value)).toBe(false);
  });

  it('rejects a bad roof style', () => {
    expect(isRoomLayout({ ...makeLayout(), roof: { style: 'dome' } })).toBe(false);
  });

  it('rejects a bad floorPlanFitMode', () => {
    expect(isRoomLayout({ ...makeLayout(), floorPlanFitMode: 'squish' })).toBe(false);
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
