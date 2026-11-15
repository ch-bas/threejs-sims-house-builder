import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { isHardBudgetOn, budgetOf } from './budget';
import { CHALLENGES, challengeById, challengeLayout, challengeProgress, goalLabel, goalMet, isRoomGoal, isUntouchedChallengeLot, repairChallenge } from './challenges';
import { parseStoredLayout } from './schema';
import type { FurnitureItem, RoomLayout, RoomZone } from './types';

const at = (id: string, type: string, x: number, z: number, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  makeItem({ id, type, name: type, width: 0.6, depth: 0.6, height: 1, price: 100, position: { x, z }, ...extra });

/** A 4 x 4 m zone from (x, z) with `types` in a row, a lamp and a window on its north edge: three stars or more. */
function room(id: string, x: number, z: number, types: string[]): { zone: RoomZone; items: FurnitureItem[] } {
  return {
    zone: { id, name: id, color: '#ffffff', x, z, w: 4, d: 4 },
    items: [
      ...types.map((type, i) => at(`${id}-${type}`, type, x + 0.5 + i * 0.8, z + 2)),
      at(`${id}-lamp`, 'lamp', x + 3.5, z + 3.5, { category: 'electronics', width: 0.3, depth: 0.3 }),
      at(`${id}-win`, 'window', x + 2, z + 0.05, { category: 'structure', width: 1.2, depth: 0.1 }),
    ],
  };
}

function houseWith(rooms: ReturnType<typeof room>[], extra: Partial<RoomLayout> = {}): RoomLayout {
  return makeLayout({ width: 8, height: 8, floors: [makeFloor({ items: rooms.flatMap((r) => r.items), zones: rooms.map((r) => r.zone) })], ...extra });
}

describe('challenge briefs (#909)', () => {
  it('lists five or six briefs with distinct ids, funds and two to four goals each', () => {
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(5);
    expect(CHALLENGES.length).toBeLessThanOrEqual(6);
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
    for (const challenge of CHALLENGES) {
      expect(challenge.goals.length).toBeGreaterThanOrEqual(2);
      expect(challenge.goals.length).toBeLessThanOrEqual(4);
      expect(challenge.funds).toBeGreaterThan(0);
    }
  });

  it('starts an empty house of its own lot, with its funds and the hard budget on', () => {
    const starter = challengeById('starter-home')!;
    const layout = challengeLayout(starter, 1234);
    expect(layout).toMatchObject({ name: 'Starter home', width: starter.width, height: starter.depth, challenge: { id: 'starter-home', startedAt: 1234 } });
    expect(layout.floors.flatMap((floor) => floor.items)).toEqual([]);
    expect(isHardBudgetOn(layout)).toBe(true);
    expect(budgetOf(layout)).toBe(8_000);
    // The schema takes it as it is.
    expect(parseStoredLayout(layout)).toEqual(layout);
  });

  it('a fresh brief meets none of its goals but the ones that are free', () => {
    for (const challenge of CHALLENGES) {
      const progress = challengeProgress(challengeLayout(challenge, 0))!;
      const free = challenge.goals.filter((goal) => goal.kind === 'spend-under').length;
      expect(progress.met).toBe(free);
      expect(progress.done).toBe(false);
    }
  });

  it('ticks the room goals off as the rooms reach their stars', () => {
    const bed = room('bed', -4, -4, ['bed']);
    const kitchen = room('kit', 0, -4, ['fridge', 'stove', 'counter']);
    const bath = room('bath', -4, 0, ['toilet', 'bathroom-sink']);
    const start = { challenge: { id: 'starter-home', startedAt: 0 } };
    expect(challengeProgress(houseWith([bed, kitchen], start))).toMatchObject({ met: 2, done: false });
    const done = challengeProgress(houseWith([bed, kitchen, bath], start))!;
    expect(done.goals.map((goal) => goal.met)).toEqual([true, true, true]);
    expect(done.done).toBe(true);
    // A room under its stars doesn't count: no lamp and no window is two short.
    const dim = { ...bath, items: bath.items.filter((item) => item.type !== 'lamp' && item.type !== 'window') };
    expect(challengeProgress(houseWith([bed, kitchen, dim], start))!.done).toBe(false);
  });

  it('counts rooms, money, storeys and lamps', () => {
    const bed = room('bed', -4, -4, ['bed']);
    const two = room('bed2', 0, -4, ['bed']);
    const layout = houseWith([bed, two]);
    expect(goalMet({ kind: 'room', type: 'bedroom', count: 2, minStars: 3 }, layout)).toBe(true);
    expect(goalMet({ kind: 'room', type: 'bedroom', count: 3, minStars: 3 }, layout)).toBe(false);
    expect(goalMet({ kind: 'spend-under', amount: 1_000 }, layout)).toBe(true);
    expect(goalMet({ kind: 'spend-under', amount: 500 }, layout)).toBe(false);
    // What selling back lost counts as spent while the hard budget is on.
    expect(goalMet({ kind: 'spend-under', amount: 1_000 }, { ...layout, budget: { writeOff: 500 } })).toBe(false);
    expect(goalMet({ kind: 'floors', count: 2 }, layout)).toBe(false);
    expect(goalMet({ kind: 'floors', count: 2 }, { ...layout, floors: [...layout.floors, makeFloor({ id: 'up' })] })).toBe(true);
    expect(goalMet({ kind: 'lit-rooms', rooms: 2 }, layout)).toBe(true);
    expect(goalMet({ kind: 'lit-rooms', rooms: 3 }, layout)).toBe(false);
  });

  it('says what each goal asks for', () => {
    expect(goalLabel({ kind: 'room', type: 'kitchen', count: 1, minStars: 3 })).toBe('A kitchen at 3★ or more');
    expect(goalLabel({ kind: 'room', type: 'bedroom', count: 2, minStars: 3 })).toBe('2 bedrooms at 3★ or more');
    expect(goalLabel({ kind: 'spend-under', amount: 3_000 })).toBe('Spend under $3,000');
    expect(goalLabel({ kind: 'floors', count: 2 })).toBe('2 storeys');
    expect(goalLabel({ kind: 'five-star' })).toBe('A room with all 5 stars');
  });

  it('a lot nothing was done on is untouched, whatever its id or key order', () => {
    const starter = challengeById('starter-home')!;
    const lot = challengeLayout(starter, 42);
    expect(isUntouchedChallengeLot({ id: 'house-1', ...lot })).toBe(true);
    expect(isUntouchedChallengeLot(JSON.parse(JSON.stringify({ challenge: lot.challenge, ...lot })) as RoomLayout)).toBe(true);
    expect(isUntouchedChallengeLot({ ...lot, name: 'Mine' })).toBe(false);
    expect(isUntouchedChallengeLot({ ...lot, floors: [makeFloor({ items: [makeItem()] })] })).toBe(false);
    expect(isUntouchedChallengeLot(makeLayout())).toBe(false);
  });

  it('takes the editor collisions for the active storey', () => {
    const kitchen = room('kit', 0, -4, ['fridge', 'stove', 'counter']);
    const layout = houseWith([kitchen]);
    const goal = { kind: 'room', type: 'kitchen', count: 1, minStars: 4 } as const;
    expect(goalMet(goal, { ...layout })).toBe(true);
    // The editor says the fridge collides: one star fewer.
    expect(goalMet(goal, { ...layout }, { floorIndex: 0, ids: new Set(['kit-fridge']) })).toBe(false);
    expect(isRoomGoal(goal)).toBe(true);
    expect(isRoomGoal({ kind: 'floors', count: 2 })).toBe(false);
  });

  it('a house with no brief, or a brief this version does not know, has no checklist', () => {
    expect(challengeProgress(makeLayout())).toBeNull();
    expect(challengeProgress(makeLayout({ challenge: { id: 'from-the-future', startedAt: 0 } }))).toBeNull();
  });
});

describe('repairChallenge (#909)', () => {
  it('keeps a clean brief as it is, and repairs or drops the rest', () => {
    const clean = { id: 'starter-home', startedAt: 5 };
    expect(repairChallenge(clean)).toBe(clean);
    expect(repairChallenge({ id: 'starter-home', startedAt: -1 })).toEqual({ id: 'starter-home', startedAt: 0 });
    expect(repairChallenge({ id: 'starter-home', startedAt: 5, extra: true })).toEqual(clean);
    expect(repairChallenge({ id: 'nope', startedAt: 5 })).toBeUndefined();
    expect(repairChallenge('starter-home')).toBeUndefined();
    expect(repairChallenge(null)).toBeUndefined();
  });

  it('an old save loads unchanged, and a bad brief costs only the brief', () => {
    const old = makeLayout();
    expect(parseStoredLayout(old)).toEqual(old);
    const bad = parseStoredLayout({ ...makeLayout(), challenge: { id: 7 } });
    expect(bad).not.toBeNull();
    expect(bad).not.toHaveProperty('challenge');
    // Both repaired fields at once: a dropped budget doesn't skip the brief's repair.
    const both = parseStoredLayout({ ...makeLayout(), budget: 'x', challenge: { id: 'starter-home', startedAt: Number.NaN } });
    expect(both).not.toHaveProperty('budget');
    expect(both?.challenge).toEqual({ id: 'starter-home', startedAt: 0 });
  });
});
