import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { ACHIEVEMENTS, achievementsEarned } from './achievements';
import { isHardBudgetOn, budgetOf, budgetSpent } from './budget';
import { briefTermsBroken, CHALLENGES, challengeAchievementId, challengeById, challengeLayout, challengeProgress, goalLabel, goalMet, isRoomGoal, isUntouchedChallengeLot, repairChallenge } from './challenges';
import { FURNITURE_CATALOG } from './constants';
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
    expect(goalLabel({ kind: 'needs-met' })).toBe('Every need met on every storey');
  });

  it('meets every need only when each storey has something to eat, rest, do and wash at', () => {
    const needs = (prefix: string, x: number) => [
      at(`${prefix}-stove`, 'stove', x, -2),
      at(`${prefix}-sofa`, 'sofa', x, 0, { width: 2, depth: 0.9 }),
      at(`${prefix}-shelf`, 'bookshelf', x, 2, { width: 1, depth: 0.3 }),
      at(`${prefix}-sink`, 'bathroom-sink', x + 2, 2),
    ];
    const goal = { kind: 'needs-met' } as const;
    const ground = makeFloor({ id: 'g', items: needs('g', -2) });
    expect(goalMet(goal, makeLayout({ width: 8, height: 8, floors: [ground] }))).toBe(true);
    // An empty storey upstairs feeds nobody up there.
    const bare = makeFloor({ id: 'u', items: [] });
    expect(goalMet(goal, makeLayout({ width: 8, height: 8, floors: [ground, bare] }))).toBe(false);
    // A toilet alone is no wash: the walkers' own rule.
    const upstairs = makeFloor({ id: 'u', items: [...needs('u', -2).filter((item) => item.type !== 'bathroom-sink'), at('u-wc', 'toilet', 2, 2)] });
    expect(goalMet(goal, makeLayout({ width: 8, height: 8, floors: [ground, upstairs] }))).toBe(false);
    const washed = { ...upstairs, items: [...upstairs.items, at('u-sink', 'bathroom-sink', 0, 2)] };
    expect(goalMet(goal, makeLayout({ width: 8, height: 8, floors: [ground, washed] }))).toBe(true);
    // Only what stands in the house counts: a fridge in the garden doesn't.
    const garden = makeFloor({ id: 'g', items: [...needs('g', -2).filter((item) => item.type !== 'stove'), at('out', 'fridge', 6, 0)] });
    expect(goalMet(goal, makeLayout({ width: 8, height: 8, floors: [garden] }))).toBe(false);
    // Not a room goal: no zones needed.
    expect(isRoomGoal(goal)).toBe(false);
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

describe('Lived-in (#909)', () => {
  /** The cheapest catalogue entry of `type`, bought and placed at (x, z). */
  const buy = (floor: string, type: string, x: number, z: number): FurnitureItem => {
    const entry = FURNITURE_CATALOG.filter((candidate) => candidate.type === type).sort((a, b) => a.price - b.price)[0]!;
    return { ...entry, id: `${floor}-${type}`, position: { x, z }, rotation: 0 } as FurnitureItem;
  };
  /** One storey at the least it takes: a bedroom with a bed and a lamp, then something to eat, do and wash at. */
  const storey = (id: string) =>
    makeFloor({
      id,
      name: id,
      items: [buy(id, 'bed', -2, -1.5), buy(id, 'lamp', -0.6, -0.5), buy(id, 'stove', 1.2, 0), buy(id, 'bookshelf', 2.8, 0), buy(id, 'bathroom-sink', 1.2, 2.2)],
      zones: [{ id: `${id}-bedroom`, name: 'Bedroom', color: '#ffffff', x: -4, z: -3.5, w: 4, d: 3.5 }],
    });

  it('can be met within its funds, with stairs bought, but not with much to spare', () => {
    const challenge = challengeById('lived-in')!;
    const lot = challengeLayout(challenge, 0);
    const house: RoomLayout = { ...lot, floors: [storey(lot.floors[0]!.id), storey('upstairs')] };
    const progress = challengeProgress(house)!;
    expect(progress.goals.map((goal) => goal.met)).toEqual([true, true, true]);
    expect(progress.termsBroken).toBeNull();
    const stairs = Math.min(...FURNITURE_CATALOG.filter((entry) => entry.type === 'stairs').map((entry) => entry.price));
    const least = budgetSpent(house) + stairs;
    expect(least).toBeLessThanOrEqual(challenge.funds);
    // A brief, not a free hand: the least it takes is most of the funds.
    expect(least).toBeGreaterThan(challenge.funds * 0.75);
  });

  it('asks more than a bed for each bedroom: two stars is not enough', () => {
    const lot = challengeLayout(challengeById('lived-in')!, 0);
    const dark = (id: string) => {
      const floor = storey(id);
      return { ...floor, items: floor.items.filter((item) => item.type !== 'lamp') };
    };
    expect(challengeProgress({ ...lot, floors: [dark(lot.floors[0]!.id), dark('upstairs')] })!.goals.map((goal) => goal.met)).toEqual([true, true, false]);
  });
});

describe('completing a brief (#909)', () => {
  // The Starter home's own terms: its 9 x 7 m lot, its funds, the hard budget on.
  const starter = challengeById('starter-home')!;
  const terms = { width: 9, height: 7, budget: { writeOff: 0, amount: 8_000 }, challenge: { id: 'starter-home', startedAt: 0 } };
  /** A 3 x 3.5 m room along the north wall from `x`, with a lamp and (unless `window` is false) a window. */
  const cell = (id: string, x: number, types: string[], window = true): ReturnType<typeof room> => ({
    zone: { id, name: id, color: '#ffffff', x, z: -3.5, w: 3, d: 3.5 },
    items: [
      ...types.map((type, i) => at(`${id}-${type}`, type, x + 0.4 + i * 0.8, -1.5)),
      at(`${id}-lamp`, 'lamp', x + 2.6, -0.6, { category: 'electronics', width: 0.3, depth: 0.3 }),
      ...(window ? [at(`${id}-win`, 'window', x + 1.5, -3.45, { category: 'structure', width: 1.2, depth: 0.1 })] : []),
    ],
  });
  const bed = cell('bed', -4.5, ['bed']);
  const kitchen = cell('kit', -1.5, ['fridge', 'stove', 'counter']);
  const bath = cell('bath', 1.5, ['toilet', 'bathroom-sink']);
  const lot = (rooms: ReturnType<typeof room>[], extra: Partial<RoomLayout> = {}): RoomLayout =>
    makeLayout({ ...terms, floors: [makeFloor({ items: rooms.flatMap((r) => r.items), zones: rooms.map((r) => r.zone) })], ...extra });
  const none = new Set<string>();
  const earned = (change: 'loaded' | 'edit', before: RoomLayout | null, now: RoomLayout, unlocked: ReadonlySet<string> = none) =>
    achievementsEarned(change, before, now, unlocked).map((a) => a.id);
  const id = challengeAchievementId('starter-home');

  it('every brief records its completion as an achievement with its own badge', () => {
    for (const challenge of CHALLENGES) {
      const achievement = ACHIEVEMENTS.find((a) => a.id === challengeAchievementId(challenge.id));
      expect(achievement).toMatchObject({ name: challenge.name, icon: challenge.badge, challengeId: challenge.id });
      // A count it is not: only meeting the last goal earns it.
      expect(achievement?.progress).toBeUndefined();
    }
  });

  it('no badge is an icon the app already shows: a catalogue item, another achievement, a panel header', () => {
    const badges = CHALLENGES.map((challenge) => challenge.badge);
    expect(new Set(badges).size).toBe(badges.length);
    const taken = new Set<string>([
      ...FURNITURE_CATALOG.map((entry) => entry.icon),
      ...ACHIEVEMENTS.filter((a) => a.challengeId === undefined).map((a) => a.icon),
      '🏆', // the Achievements panel's header
      '🌙', // the time-of-day panel's Night
    ]);
    expect(badges.filter((badge) => taken.has(badge))).toEqual([]);
  });

  it('the edit that meets the last goal earns it, once', () => {
    const almost = lot([bed, kitchen]);
    const done = lot([bed, kitchen, bath]);
    expect(challengeProgress(done)).toMatchObject({ done: true, termsBroken: null });
    expect(earned('edit', almost, done)).toContain(id);
    expect(earned('edit', almost, done, new Set([id]))).not.toContain(id);
  });

  it('a load earns nothing, nor does an edit that keeps a loaded brief done', () => {
    const almost = lot([bed, kitchen]);
    const done = lot([bed, kitchen, bath]);
    expect(earned('loaded', almost, done)).not.toContain(id);
    expect(earned('edit', null, done)).not.toContain(id);
    const nudged = lot([bed, kitchen, { ...bath, items: bath.items.map((item) => (item.type === 'lamp' ? { ...item, position: { x: 4.1, z: -0.8 } } : item)) }]);
    expect(challengeProgress(nudged)!.done).toBe(true);
    expect(earned('edit', done, nudged)).not.toContain(id);
  });

  it('only within the brief: its terms kept, its own id, every goal met', () => {
    const almost = lot([bed, kitchen]);
    // Funds raised, the hard budget off, the lot resized: goals met, no badge.
    for (const [extra, reason] of [
      [{ budget: { writeOff: 0, amount: 9_000 } }, /funds raised/],
      [{ budget: { writeOff: 0, amount: 8_000, enabled: false } }, /hard budget is off/],
      [{ width: 10 }, /lot was resized/],
    ] as const) {
      const broken = lot([bed, kitchen, bath], extra);
      expect(challengeProgress(broken)).toMatchObject({ done: true, termsBroken: expect.stringMatching(reason) as string });
      expect(earned('edit', almost, broken)).not.toContain(id);
    }
    // Overspent while the funds were raised or the budget was off, then put
    // back within the terms: the spending still breaks them, either route.
    const pricey = (r: ReturnType<typeof room>): ReturnType<typeof room> => ({ ...r, items: r.items.map((item) => ({ ...item, price: 1_000 })) });
    const over = [pricey(bed), pricey(kitchen), pricey(bath)];
    expect(budgetSpent(lot(over))).toBeGreaterThan(8_000);
    for (const before of [
      lot([pricey(bed), pricey(kitchen)], { budget: { writeOff: 0, amount: 20_000 } }),
      lot([pricey(bed), pricey(kitchen)], { budget: { writeOff: 0, amount: 8_000, enabled: false } }),
    ]) {
      const completed = lot(over, { budget: before.budget! });
      expect(challengeProgress(completed)).toMatchObject({ done: true, termsBroken: expect.any(String) as string });
      expect(earned('edit', before, completed)).not.toContain(id);
      // Funds lowered / the budget switched back on.
      const back = lot(over);
      expect(challengeProgress(back)).toMatchObject({ done: true, termsBroken: expect.stringMatching(/spent .* over the funds/) as string });
      expect(earned('edit', completed, back)).not.toContain(id);
    }
    // Spending exactly the funds keeps to them.
    const exact = lot([bed, kitchen, bath], { budget: { writeOff: 8_000 - budgetSpent(lot([bed, kitchen, bath])), amount: 8_000 } });
    expect(budgetSpent(exact)).toBe(8_000);
    expect(briefTermsBroken(exact, starter)).toBeNull();
    // Fewer funds than the brief gave is harder, not easier: still within its terms.
    expect(earned('edit', lot([bed, kitchen], { budget: { writeOff: 0, amount: 6_000 } }), lot([bed, kitchen, bath], { budget: { writeOff: 0, amount: 6_000 } }))).toContain(id);
    // Another brief, or none, earns nothing for this one.
    const other = { challenge: { id: 'family-of-four', startedAt: 0 } };
    expect(earned('edit', lot([bed, kitchen], other), lot([bed, kitchen, bath], other)).filter((a) => a.startsWith('challenge-'))).toEqual([]);
    const { challenge: _c, ...plain } = terms;
    expect(earned('edit', makeLayout({ ...plain, floors: almost.floors }), makeLayout({ ...plain, floors: lot([bed, kitchen, bath]).floors })).filter((a) => a.startsWith('challenge-'))).toEqual([]);
    for (const challenge of CHALLENGES) {
      expect(earned('edit', makeLayout(), challengeLayout(challenge, 0))).not.toContain(challengeAchievementId(challenge.id));
    }
    expect(briefTermsBroken(challengeLayout(starter, 0), starter)).toBeNull();
  });

  it('scores the rooms with the editor collisions, as the room goals do', () => {
    // A bath with no window stands at three stars exactly.
    const plain = cell('bath', 1.5, ['toilet', 'bathroom-sink'], false);
    expect(challengeProgress(lot([bed, kitchen, plain]))!.done).toBe(true);
    // Fresh layouts (the scores are kept per layout): the editor has the
    // toilet colliding, a star short, and the brief isn't done.
    const before = lot([bed, kitchen]);
    const now = lot([bed, kitchen, plain]);
    const known = { floorIndex: 0, ids: new Set(['bath-toilet']) };
    const got = achievementsEarned('edit', before, now, none, { before: known, now: known }).map((a) => a.id);
    expect(got).not.toContain(id);
    expect(challengeProgress(now)!.done).toBe(false);
  });
});
