import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { MAX_FLOORS, MAX_ITEM_DIMENSION, MAX_ROOM_DIMENSION } from './constants';
import { isFloorLayout, isFurnitureItem, isRoomLayout, parseStoredLayout } from './schema';

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
    ['unknown stairsDirection', makeItem({ stairsDirection: 'up' as never })],
    ['non-string cctvModelId', makeItem({ cctvModelId: 42 as never })],
    ['non-boolean hasVisionCone', makeItem({ hasVisionCone: 'yes' as never })],
  ])('rejects %s (#121)', (_label, value) => {
    expect(isFurnitureItem(value)).toBe(false);
  });

  it('accepts valid enum/range fields (#121)', () => {
    expect(
      isFurnitureItem(
        makeItem({ sofaShape: 'L-shape', stairsDirection: 'north', visionFov: 90, visionRange: 5, signalRange: 8, hasVisionCone: true, cctvModelId: 'some-model' })
      )
    ).toBe(true);
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
