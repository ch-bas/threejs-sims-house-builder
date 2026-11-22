import { describe, expect, it, vi } from 'vitest';
import { INITIAL_LAYOUT, layoutReducer } from '../hooks/layout-reducer';
import { measureCpu } from './__testfixtures__/cpu-time';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { ACHIEVEMENTS, achievementsEarned } from './achievements';
import { DEFAULT_ROOF, ROOF_STYLE_DEFAULT_COLORS } from './constants';
import { hasCollisions } from './geometry';
import { houseRoomScores, ROOM_CHECKS } from './room-score';
import type { FloorLayout, FurnitureItem, RoomLayout, RoomZone } from './types';

// The room goals' collision passes are counted (#903): the real check, watched.
vi.mock('./geometry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./geometry')>();
  return { ...actual, hasCollisions: vi.fn(actual.hasCollisions) };
});

function achievement(id: string) {
  const found = ACHIEVEMENTS.find((a) => a.id === id);
  if (!found) throw new Error(`No achievement ${id}`);
  return found;
}

function layoutWithItems(items: FurnitureItem[]) {
  return makeLayout({ floors: [makeFloor({ items })] });
}

function repeatItems(n: number, overrides: Partial<FurnitureItem> = {}): FurnitureItem[] {
  return Array.from({ length: n }, (_, i) => makeItem({ id: `i${i}`, ...overrides }));
}

describe('achievements — count thresholds fire at the boundary', () => {
  it('first-steps fires at 1 item, not at 0', () => {
    expect(achievement('first-steps').isMet(layoutWithItems([]))).toBe(false);
    expect(achievement('first-steps').isMet(layoutWithItems(repeatItems(1)))).toBe(true);
  });

  it('furnished fires at 10, not at 9', () => {
    expect(achievement('furnished').isMet(layoutWithItems(repeatItems(9)))).toBe(false);
    expect(achievement('furnished').isMet(layoutWithItems(repeatItems(10)))).toBe(true);
  });

  it('overstuffed fires at 25, not at 24', () => {
    expect(achievement('overstuffed').isMet(layoutWithItems(repeatItems(24)))).toBe(false);
    expect(achievement('overstuffed').isMet(layoutWithItems(repeatItems(25)))).toBe(true);
  });

  it('counts items across all floors', () => {
    const layout = makeLayout({
      floors: [makeFloor({ id: 'g', items: repeatItems(6) }), makeFloor({ id: 'u', items: repeatItems(6) })],
    });
    expect(achievement('furnished').isMet(layout)).toBe(true);
  });
});

describe('achievements — spend thresholds', () => {
  it('big-spender fires strictly over $10,000, not at exactly 10,000', () => {
    const at = repeatItems(1, { price: 10_000 });
    const over = repeatItems(1, { price: 10_001 });
    expect(achievement('big-spender').isMet(layoutWithItems(at))).toBe(false);
    expect(achievement('big-spender').isMet(layoutWithItems(over))).toBe(true);
  });

  it('open-plan requires >=5 items AND total under §3,000', () => {
    const cheapFive = repeatItems(5, { price: 100 }); // total 500
    const pricyFive = repeatItems(5, { price: 1_000 }); // total 5000
    const cheapFour = repeatItems(4, { price: 100 });
    expect(achievement('open-plan').isMet(layoutWithItems(cheapFive))).toBe(true);
    expect(achievement('open-plan').isMet(layoutWithItems(pricyFive))).toBe(false);
    expect(achievement('open-plan').isMet(layoutWithItems(cheapFour))).toBe(false);
  });
});

describe('achievements — type/structure predicates', () => {
  it('wifi-everywhere requires a real wifi access point flag', () => {
    expect(achievement('wifi-everywhere').isMet(layoutWithItems(repeatItems(1)))).toBe(false);
    expect(
      achievement('wifi-everywhere').isMet(layoutWithItems([makeItem({ isWiFiAccessPoint: true })]))
    ).toBe(true);
  });

  it('sky-high and penthouse fire at 2 and 4 floors', () => {
    const floors = (n: number) => makeLayout({ floors: Array.from({ length: n }, (_, i) => makeFloor({ id: `f${i}` })) });
    expect(achievement('sky-high').isMet(floors(1))).toBe(false);
    expect(achievement('sky-high').isMet(floors(2))).toBe(true);
    expect(achievement('penthouse').isMet(floors(3))).toBe(false);
    expect(achievement('penthouse').isMet(floors(4))).toBe(true);
  });

  it('going-up needs a staircase; door-installer needs a door', () => {
    expect(achievement('going-up').isMet(layoutWithItems([makeItem({ type: 'stairs' })]))).toBe(true);
    expect(achievement('going-up').isMet(layoutWithItems([makeItem({ type: 'chair' })]))).toBe(false);
    expect(achievement('door-installer').isMet(layoutWithItems([makeItem({ type: 'door' })]))).toBe(true);
  });

  it('roof-it needs a roof that differs from the starter one (#165)', () => {
    const roofIt = achievement('roof-it');
    expect(roofIt.isMet(makeLayout({ roof: { style: 'none' } }))).toBe(false);
    // The starter roof, in any letter case, isn't earned.
    expect(roofIt.isMet(makeLayout({ roof: DEFAULT_ROOF }))).toBe(false);
    expect(
      roofIt.isMet(makeLayout({ roof: { style: DEFAULT_ROOF.style, color: DEFAULT_ROOF.color.toUpperCase() } }))
    ).toBe(false);
    // A new style or a new colour is — including a colourless gable (e.g. a
    // template load + "Gable"), which renders in the gable default, not the
    // starter colour.
    expect(roofIt.isMet(makeLayout({ roof: { style: DEFAULT_ROOF.style } }))).toBe(true);
    expect(roofIt.isMet(makeLayout({ roof: { style: 'hipped' } }))).toBe(true);
    expect(roofIt.isMet(makeLayout({ roof: { style: 'flat', color: DEFAULT_ROOF.color } }))).toBe(true);
    expect(roofIt.isMet(makeLayout({ roof: { style: DEFAULT_ROOF.style, color: '#1d3f78' } }))).toBe(true);
  });

  it('green-thumb fires at 3 plants/trees/flowerpots', () => {
    const two = [makeItem({ id: '1', type: 'plant' }), makeItem({ id: '2', type: 'tree' })];
    const three = [...two, makeItem({ id: '3', type: 'flowerpot' })];
    expect(achievement('green-thumb').isMet(layoutWithItems(two))).toBe(false);
    expect(achievement('green-thumb').isMet(layoutWithItems(three))).toBe(true);
  });

  it('green-thumb counts the broader planted catalog (pine-tree, bush, tulips, …)', () => {
    const mixed = [
      makeItem({ id: '1', type: 'pine-tree' }),
      makeItem({ id: '2', type: 'bush' }),
      makeItem({ id: '3', type: 'tulips' }),
    ];
    expect(achievement('green-thumb').isMet(layoutWithItems(mixed))).toBe(true);
    // Non-plant outdoor items (e.g. a pond) must not count toward it.
    const water = [
      makeItem({ id: '1', type: 'pond' }),
      makeItem({ id: '2', type: 'pool' }),
      makeItem({ id: '3', type: 'birdbath' }),
    ];
    expect(achievement('green-thumb').isMet(layoutWithItems(water))).toBe(false);
  });

  it('window-watcher fires at 3 windows', () => {
    expect(achievement('window-watcher').isMet(layoutWithItems(repeatItems(2, { type: 'window' })))).toBe(false);
    expect(achievement('window-watcher').isMet(layoutWithItems(repeatItems(3, { type: 'window' })))).toBe(true);
  });

  it('wall-whisperer fires when any floor has an interior wall', () => {
    const withWall = makeLayout({
      floors: [makeFloor({ interiorWalls: [{ id: 'w', x1: 0, z1: 0, x2: 1, z2: 0 }] })],
    });
    expect(achievement('wall-whisperer').isMet(makeLayout())).toBe(false);
    expect(achievement('wall-whisperer').isMet(withWall)).toBe(true);
  });

  it('decorator fires at 6 unique furniture types', () => {
    const types = ['chair', 'table', 'bed', 'desk', 'lamp', 'sofa'];
    const items = types.map((t, i) => makeItem({ id: `i${i}`, type: t }));
    expect(achievement('decorator').isMet(layoutWithItems(items.slice(0, 5)))).toBe(false);
    expect(achievement('decorator').isMet(layoutWithItems(items))).toBe(true);
  });
});

describe('achievements — catalogue invariants', () => {
  // Anything met by the untouched starting layout unlocks before the first
  // click and can never be earned — the Roof It bug (#165) generalised.
  it('none is already met by the initial layout', () => {
    expect(ACHIEVEMENTS.filter((a) => a.isMet(INITIAL_LAYOUT)).map((a) => a.id)).toEqual([]);
  });

  // The porch's door and back wall are structure: switching on the recessed
  // entrance earns nothing on an otherwise empty house (#382).
  it('none is met by switching on the recessed entrance', () => {
    const { layout } = layoutReducer(
      { layout: INITIAL_LAYOUT, activeFloorIndex: 0 },
      { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } }
    );
    expect(layout.floors[0]!.items.some((item) => item.type === 'door')).toBe(true);
    expect(layout.floors[0]!.interiorWalls?.length).toBe(1);
    expect(ACHIEVEMENTS.filter((a) => a.isMet(layout)).map((a) => a.id)).toEqual([]);
  });

  it('the starter roof colour is not any style\'s colourless default', () => {
    // Otherwise a colourless roof of that style would look like the starter
    // yet count as customised (or vice versa).
    expect(Object.values(ROOF_STYLE_DEFAULT_COLORS)).not.toContain(DEFAULT_ROOF.color);
  });

  it('every achievement has a distinct icon', () => {
    const icons = ACHIEVEMENTS.map((a) => a.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe('achievementsEarned (#450)', () => {
  const none = new Set<string>();
  const earned = (before: FurnitureItem[] | null, now: FurnitureItem[], change: 'loaded' | 'edit' = 'edit') =>
    achievementsEarned(change, before ? layoutWithItems(before) : null, layoutWithItems(now), none).map((a) => a.id);
  const ap = (id: string) => makeItem({ id, type: 'wifi', isWiFiAccessPoint: true });

  it('a loaded house earns nothing, however much it meets', () => {
    expect(earned([], [ap('a')], 'loaded')).toEqual([]);
  });

  it('the starting house earns nothing', () => {
    expect(earned(null, [ap('a')])).toEqual([]);
  });

  it('an edit earns what it made true', () => {
    expect(earned([], [makeItem()])).toEqual(['first-steps']);
  });

  it('an edit that keeps the counts earns nothing already met', () => {
    expect(earned([ap('a')], [{ ...ap('a'), position: { x: 1, z: 1 } }])).toEqual([]);
  });

  it('an edit that raises a goal\'s count earns it, though it was already met', () => {
    const got = earned([ap('a')], [ap('a'), ap('b')]);
    expect(got).toContain('wifi-everywhere');
    expect(got).toContain('first-steps');
  });

  it('a count goal earned by raising a different count is not handed out', () => {
    // Adding a chair to a house that already has a door doesn't install a door.
    const door = makeItem({ id: 'd', type: 'door' });
    expect(earned([door], [door, makeItem({ id: 'c', type: 'chair' })])).not.toContain('door-installer');
  });

  it('a goal that is not a count needs to become true', () => {
    const cheap = repeatItems(5, { price: 100 });
    // Already under budget with five items: a sixth keeps it so, not earned.
    expect(earned(cheap, [...cheap, makeItem({ id: 'x', price: 100 })])).not.toContain('open-plan');
    expect(earned(cheap.slice(0, 4), cheap)).toContain('open-plan');
  });

  it('never earns an achievement twice', () => {
    expect(
      achievementsEarned('edit', layoutWithItems([]), layoutWithItems([makeItem()]), new Set(['first-steps']))
    ).toEqual([]);
  });

  it('every count goal has a progress measure that grows with it', () => {
    const counts = ACHIEVEMENTS.filter((a) => a.progress !== undefined).map((a) => a.id);
    expect(counts.sort()).toEqual(
      [
        'big-spender', 'decorator', 'door-installer', 'first-steps', 'five-stars', 'furnished', 'going-up', 'green-thumb',
        'home-sweet-home', 'night-owl', 'overstuffed', 'penthouse', 'real-kitchen', 'sky-high', 'wall-whisperer',
        'wifi-everywhere', 'window-watcher',
      ].sort()
    );
    expect(achievement('window-watcher').progress?.(layoutWithItems(repeatItems(2, { type: 'window' })))).toBe(2);
  });
});


describe('room goals (#903)', () => {
  const at = (id: string, type: string, x: number, z: number, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
    makeItem({ id, type, name: type, width: 0.6, depth: 0.6, height: 1, position: { x, z }, ...extra });
  // A 4 x 3 m kitchen in the north-west corner of an 8 x 8 m house: 12 m² asks for two pieces of decor.
  const kitchenZone: RoomZone = { id: 'k', name: 'Kitchen', color: '#ffffff', x: -4, z: -4, w: 4, d: 3 };
  const kitchen = [at('fridge', 'fridge', -3.5, -3), at('stove', 'stove', -2.5, -3), at('counter', 'counter', -1.5, -3)];
  const lamp = at('lamp', 'lamp', -1.5, -1.5, { category: 'electronics', width: 0.3, depth: 0.3 });
  const decor = [
    at('plant', 'plant', -3.5, -1.5, { category: 'decor', width: 0.4, depth: 0.4 }),
    at('vase', 'vase', -2.5, -1.5, { category: 'decor', width: 0.2, depth: 0.2 }),
  ];
  const window = at('win', 'window', -2, -3.95, { category: 'structure', width: 1.2, depth: 0.1 });
  const fiveStarKitchen = [...kitchen, lamp, ...decor, window];
  const house = (items: FurnitureItem[], zones: RoomZone[] = [kitchenZone]): RoomLayout =>
    makeLayout({ floors: [makeFloor({ items, zones })] });
  const goal = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!;
  const none = new Set<string>();
  const earnedIds = (change: 'loaded' | 'edit', before: RoomLayout, now: RoomLayout) =>
    achievementsEarned(change, before, now, none).map((a) => a.id);

  it('the fixture kitchen meets every check', () => {
    expect(houseRoomScores(house(fiveStarKitchen))[0]).toMatchObject({ type: 'kitchen', stars: ROOM_CHECKS.length });
  });

  it('A Real Kitchen needs a zone the furniture makes a kitchen of', () => {
    expect(goal('real-kitchen').isMet(house(kitchen))).toBe(true);
    expect(goal('real-kitchen').isMet(house(kitchen.slice(0, 2)))).toBe(false);
    // The same furniture with no zone around it is not a room.
    expect(goal('real-kitchen').isMet(house(kitchen, []))).toBe(false);
  });

  it('Five Stars needs a room with every star, and counts the best room', () => {
    expect(goal('five-stars').isMet(house(fiveStarKitchen))).toBe(true);
    const noLamp = fiveStarKitchen.filter((item) => item.id !== 'lamp');
    expect(goal('five-stars').isMet(house(noLamp))).toBe(false);
    expect(goal('five-stars').progress?.(house(noLamp))).toBe(ROOM_CHECKS.length - 1);
    expect(earnedIds('edit', house(noLamp), house(fiveStarKitchen))).toContain('five-stars');
  });

  it('Home Sweet Home counts the four rooms that have three stars', () => {
    // Each room: its furniture, a lamp and a window; two of three decor
    // pieces short is still three stars (decor, collisions and space aside).
    const room = (id: string, x: number, z: number, types: string[]): { zone: RoomZone; items: FurnitureItem[] } => ({
      zone: { id, name: id, color: '#ffffff', x, z, w: 4, d: 4 },
      items: [
        ...types.map((type, i) => at(`${id}-${type}`, type, x + 0.5 + i * 0.8, z + 2)),
        at(`${id}-lamp`, 'lamp', x + 3.5, z + 3.5, { category: 'electronics', width: 0.3, depth: 0.3 }),
      ],
    });
    const rooms = [
      room('bed', -4, -4, ['bed']),
      room('kit', 0, -4, ['fridge', 'stove', 'counter']),
      room('bath', -4, 0, ['toilet', 'bathroom-sink']),
      room('liv', 0, 0, ['sofa']),
    ];
    const layout = (count: number) =>
      house(rooms.slice(0, count).flatMap((r) => r.items), rooms.slice(0, count).map((r) => r.zone));
    const scores = houseRoomScores(layout(4));
    expect(scores.map((s) => s.type)).toEqual(['bedroom', 'kitchen', 'bathroom', 'living']);
    expect(scores.every((s) => s.stars >= 3)).toBe(true);
    expect(goal('home-sweet-home').progress?.(layout(3))).toBe(3);
    expect(goal('home-sweet-home').isMet(layout(3))).toBe(false);
    expect(goal('home-sweet-home').isMet(layout(4))).toBe(true);
  });

  it('Night Owl needs a lamp in every furnished room, and at least one room', () => {
    expect(goal('night-owl').isMet(house([]))).toBe(false);
    expect(goal('night-owl').isMet(house(kitchen))).toBe(false);
    expect(goal('night-owl').isMet(house([...kitchen, lamp]))).toBe(true);
    const bedroom: RoomZone = { id: 'b', name: 'Bedroom', color: '#ffffff', x: 0, z: 0, w: 4, d: 4 };
    const bed = at('bed', 'bed', 2, 2, { width: 1.6, depth: 2 });
    expect(goal('night-owl').isMet(house([...kitchen, lamp, bed], [kitchenZone, bedroom]))).toBe(false);
    expect(goal('night-owl').progress?.(house([...kitchen, lamp, bed], [kitchenZone, bedroom]))).toBe(1);
  });

  it('Five Stars: another five-star room earns it, and 3 to 4 stars is progress before the first', () => {
    const noLamp = fiveStarKitchen.filter((item) => item.id !== 'lamp');
    const noLampOrDecor = noLamp.filter((item) => item.id !== 'plant');
    const five = goal('five-stars');
    expect(five.progress!(house(noLamp))).toBeGreaterThan(five.progress!(house(noLampOrDecor)));
    // A loaded house with one five-star kitchen: a second one is doing the thing.
    const second: RoomZone = { id: 'k2', name: 'Kitchen 2', color: '#ffffff', x: 0, z: -4, w: 4, d: 3 };
    const copy = fiveStarKitchen.map((item) => ({ ...item, id: `2-${item.id}`, position: { x: item.position!.x + 4, z: item.position!.z } }));
    const one = house(fiveStarKitchen, [kitchenZone, second]);
    const two = house([...fiveStarKitchen, ...copy], [kitchenZone, second]);
    expect(houseRoomScores(two).map((room) => room.stars)).toEqual([ROOM_CHECKS.length, ROOM_CHECKS.length]);
    expect(earnedIds('edit', one, two)).toContain('five-stars');
  });

  it('Home Sweet Home: another good room of the four kinds earns it again', () => {
    const at4 = (id: string, x: number, z: number, types: string[]) => ({
      zone: { id, name: id, color: '#ffffff', x, z, w: 4, d: 4 } as RoomZone,
      items: [
        ...types.map((type, i) => at(`${id}-${type}`, type, x + 0.5 + i * 0.8, z + 2)),
        at(`${id}-lamp`, 'lamp', x + 3.5, z + 3.5, { category: 'electronics', width: 0.3, depth: 0.3 }),
      ],
    });
    const rooms = [at4('bed', -4, -4, ['bed']), at4('kit', 0, -4, ['fridge', 'stove', 'counter']), at4('bath', -4, 0, ['toilet', 'bathroom-sink']), at4('liv', 0, 0, ['sofa'])];
    const build = (list: typeof rooms) => makeLayout({ width: 16, height: 8, floors: [makeFloor({ items: list.flatMap((r) => r.items), zones: list.map((r) => r.zone) })] });
    const home = build(rooms);
    const more = build([...rooms, at4('bed2', 4, -4, ['bed'])]);
    expect(goal('home-sweet-home').isMet(home)).toBe(true);
    expect(earnedIds('edit', home, more)).toContain('home-sweet-home');
  });

  it('a loaded house with a five-star kitchen earns nothing until the player edits it', () => {
    const template = house(fiveStarKitchen);
    expect(earnedIds('loaded', house([]), template)).toEqual([]);
    // An edit that raises nothing the template met earns none of its goals.
    const nudged = house(fiveStarKitchen.map((item) => (item.id === 'vase' ? { ...item, position: { x: -2.6, z: -1.5 } } : item)));
    expect(earnedIds('edit', template, nudged)).toEqual([]);
    // A second kitchen is doing the thing.
    const second: RoomZone = { id: 'k2', name: 'Kitchen 2', color: '#ffffff', x: 0, z: 0, w: 4, d: 4 };
    const more = house([...fiveStarKitchen, at('f2', 'fridge', 0.5, 2), at('s2', 'stove', 1.5, 2), at('c2', 'counter', 2.5, 2)], [kitchenZone, second]);
    expect(earnedIds('edit', template, more)).toContain('real-kitchen');
  });

  it("with the editor's collisions, an edit runs no collision pass at all", () => {
    // A full storey: 2,000 chairs under one zone with a bed in it.
    const items = Array.from({ length: 2000 }, (_, i) =>
      at(`i${i}`, i === 0 ? 'bed' : 'chair', -9 + (i % 45) * 0.4, -9 + Math.floor(i / 45) * 0.4, { width: 0.3, depth: 0.3 })
    );
    const zone: RoomZone = { id: 'z', name: 'Z', color: '#ffffff', x: -10, z: -10, w: 20, d: 20 };
    const before = makeLayout({ width: 20, height: 20, floors: [makeFloor({ items, zones: [zone] })] });
    const nudged = items.map((item, i) => (i === 1999 ? { ...item, position: { x: item.position!.x, z: item.position!.z + 0.01 } } : item));
    const now = makeLayout({ width: 20, height: 20, floors: [makeFloor({ items: nudged, zones: [zone] })] });
    const known = { floorIndex: 0, ids: new Set<string>() };
    const watched = vi.mocked(hasCollisions);
    watched.mockClear();
    const { cpuMs } = measureCpu(() => achievementsEarned('edit', before, now, new Set(), { before: known, now: known }));
    expect(watched).not.toHaveBeenCalled();
    expect(cpuMs).toBeLessThan(50);
  }, 30_000);

  it('with every room goal earned, scores rooms only for a house played under an unearned brief (#909)', () => {
    const storey = (id: string): FloorLayout =>
      makeFloor({ id, name: id, items: fiveStarKitchen.map((item) => ({ ...item, id: `${id}-${item.id}` })), zones: [kitchenZone] });
    const roomGoals = ['real-kitchen', 'five-stars', 'home-sweet-home', 'night-owl'];
    const unlocked = new Set(ACHIEVEMENTS.map((a) => a.id).filter((id) => !id.startsWith('challenge-')).concat(roomGoals));
    const known = { floorIndex: 0, ids: new Set<string>() };
    const watched = vi.mocked(hasCollisions);
    const passes = (extra: Partial<RoomLayout>, earned: ReadonlySet<string> = unlocked): number => {
      // Fresh layouts each time: the scores are kept per layout.
      const before = makeLayout({ floors: [storey('g'), storey('u')], ...extra });
      const after = makeLayout({ floors: [before.floors[0]!, { ...before.floors[1]!, items: [...before.floors[1]!.items, at('x', 'chair', 2, 2)] }], ...extra });
      watched.mockClear();
      achievementsEarned('edit', before, after, earned, { before: known, now: known });
      return watched.mock.calls.length;
    };
    // No brief: nothing reads the upstairs rooms, no collision pass.
    expect(passes({})).toBe(0);
    // An unearned brief may read them; an earned one doesn't.
    const brief = { challenge: { id: 'starter-home', startedAt: 0 } };
    expect(passes(brief)).toBeGreaterThan(0);
    expect(passes(brief, new Set([...unlocked, 'challenge-starter-home']))).toBe(0);
  });

  it('an edit on a four-storey house re-scores only the storey it changed', () => {
    const storey = (id: string): FloorLayout =>
      makeFloor({ id, name: id, items: fiveStarKitchen.map((item) => ({ ...item, id: `${id}-${item.id}` })), zones: [kitchenZone] });
    const floors = ['g', '1', '2', '3'].map(storey);
    const before = makeLayout({ floors });
    // Everything else unlocked, so only the room goals look at the house.
    const others = new Set(ACHIEVEMENTS.map((a) => a.id).filter((id) => !['real-kitchen', 'five-stars', 'home-sweet-home', 'night-owl'].includes(id)));
    achievementsEarned('edit', makeLayout(), before, others);
    const edited = floors[2]!;
    const after = makeLayout({ floors: floors.map((floor) => (floor === edited ? { ...floor, items: [...floor.items, at('x', 'chair', 2, 2)] } : floor)) });
    const watched = vi.mocked(hasCollisions);
    watched.mockClear();
    achievementsEarned('edit', before, after, others);
    const checked = new Set(watched.mock.calls.map((call) => call[1]));
    expect(checked).toEqual(new Set([after.floors[2]!.items]));
  });
});
