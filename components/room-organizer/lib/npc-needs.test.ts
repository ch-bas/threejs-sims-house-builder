import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import {
  NEED_LACK_LABELS,
  NEED_URGENT,
  type NeedSpot,
  type NpcNeeds,
  decayNeeds,
  findNeedSpots,
  householdLacks,
  needOfType,
  pickNeedSpot,
  randomNeeds,
  refillNeed,
  scoreNeedSpot,
  unmetNeeds,
  urgency,
} from './npc-needs';
import { findNpcSeats } from './npc-seats';
import type { FurnitureItem } from './types';

/** Deterministic PRNG (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function needs(hunger: number, energy: number, fun: number, hygiene = 1): NpcNeeds {
  return { hunger, energy, fun, hygiene };
}

describe('needs run down and are met (#617)', () => {
  it('decay at their own rates and never below empty', () => {
    const n = needs(1, 1, 1);
    decayNeeds(n, 60);
    expect(n.fun).toBeLessThan(n.hunger);
    expect(n.hunger).toBeLessThan(n.hygiene);
    expect(n.hygiene).toBeLessThan(n.energy);
    expect(n.energy).toBeLessThan(1);
    // Hygiene runs out in about 200 s (#904).
    expect(n.hygiene).toBeCloseTo(1 - 60 / 200);
    decayNeeds(n, 10_000);
    expect(n).toEqual(needs(0, 0, 0, 0));
  });

  it('a few seconds of use meet a need, never past full', () => {
    const n = needs(0.1, 0.5, 0.5);
    refillNeed(n, 'hunger', 3);
    expect(n.hunger).toBeGreaterThan(NEED_URGENT);
    refillNeed(n, 'hunger', 100);
    expect(n.hunger).toBe(1);
    expect(n.energy).toBe(0.5);
  });

  it('is pressing only below the threshold, and most when empty', () => {
    expect(urgency(needs(NEED_URGENT, 1, 1), 'hunger')).toBe(0);
    expect(urgency(needs(0, 1, 1), 'hunger')).toBe(1);
    expect(urgency(needs(0.25, 1, 1), 'hunger')).toBeCloseTo(0.5);
  });

  it('start spread out, none of them pressing', () => {
    const random = seeded(1);
    for (let i = 0; i < 50; i++) {
      const n = randomNeeds(random);
      for (const level of [n.hunger, n.energy, n.fun, n.hygiene]) {
        expect(level).toBeGreaterThan(0.34);
        expect(level).toBeLessThanOrEqual(1);
      }
    }
  });

  it('knows what each item is for, and nothing for a prototype key', () => {
    expect(['fridge', 'stove', 'bed', 'sofa', 'tv', 'bookshelf'].map(needOfType)).toEqual(['hunger', 'hunger', 'energy', 'energy', 'fun', 'fun']);
    expect(['toilet', 'shower', 'bathtub', 'bathroom-sink'].map(needOfType)).toEqual(['hygiene', 'hygiene', 'hygiene', 'hygiene']);
    expect(needOfType('computer')).toBe('fun');
    expect(needOfType('chair')).toBeNull();
    expect(needOfType('desk')).toBeNull();
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(needOfType(key)).toBeNull();
  });
});

describe('findNeedSpots', () => {
  const fridge = makeItem({ id: 'fridge', type: 'fridge', width: 0.7, depth: 0.7, height: 1.8, position: { x: 2, z: -3 }, rotation: 0 });
  const sofa = makeItem({ id: 'sofa', type: 'sofa', width: 2, depth: 0.9, height: 0.8, position: { x: 0, z: -1 }, rotation: 0 });
  const tv = makeItem({ id: 'tv', type: 'tv', width: 1.5, depth: 0.4, height: 0.5, position: { x: 0, z: 2 }, rotation: Math.PI });
  const bed = makeItem({ id: 'bed', type: 'bed', width: 2, depth: 1.6, height: 0.6, position: { x: -3, z: 2 }, rotation: Math.PI / 2 });
  const shelf = makeItem({ id: 'shelf', type: 'bookshelf', width: 1, depth: 0.3, height: 2, position: { x: 3, z: 2 }, rotation: -Math.PI / 2 });
  const chair = makeItem({ id: 'chair', type: 'chair', width: 0.5, depth: 0.5, height: 0.9, position: { x: 3, z: -1 }, rotation: Math.PI });
  const spotsOf = (items: FurnitureItem[]) => findNeedSpots(items, findNpcSeats(items));

  it('stands in front of a fridge, facing it', () => {
    const [spot] = spotsOf([fridge]);
    expect(spot).toMatchObject({ need: 'hunger', itemId: 'fridge', seatKey: null, x: 2 });
    expect(spot!.z).toBeCloseTo(-3 + 0.35 + 0.35);
    // Heading π faces −z, back at the fridge.
    expect(Math.cos(spot!.heading)).toBeCloseTo(-1);
  });

  it('rests in the sofa and on the end of the bed, and watches the TV from the sofa that faces it', () => {
    const spots = spotsOf([sofa, tv, bed, chair]);
    const energy = spots.filter((spot) => spot.need === 'energy');
    expect(new Set(energy.map((spot) => spot.itemId))).toEqual(new Set(['sofa', 'bed']));
    expect(energy.every((spot) => spot.seatKey !== null)).toBe(true);
    const fun = spots.filter((spot) => spot.need === 'fun');
    // The chair faces away from the TV; the sofa's three places face it.
    expect(fun).toHaveLength(3);
    expect(fun.every((spot) => spot.itemId === 'sofa' && spot.seatKey?.startsWith('sofa:'))).toBe(true);
  });

  it('stands in front of a TV no seat faces, and of a bookshelf', () => {
    const spots = spotsOf([tv, shelf]);
    expect(spots.map((spot) => [spot.itemId, spot.need, spot.seatKey])).toEqual([
      ['tv', 'fun', null],
      ['shelf', 'fun', null],
    ]);
    expect(spots[0]!.z).toBeCloseTo(2 - 0.2 - 1.2);
    // A bookshelf turned to face −x: stand to its −x side.
    expect(spots[1]!.x).toBeCloseTo(3 - 0.15 - 0.35);
  });

  it('washes standing in front of the toilet, the shower, the bath and the basin (#904)', () => {
    const toilet = makeItem({ id: 'toilet', type: 'toilet', width: 0.4, depth: 0.7, height: 0.8, position: { x: 0, z: -2 }, rotation: 0 });
    const shower = makeItem({ id: 'shower', type: 'shower', width: 0.9, depth: 0.9, height: 2.1, position: { x: 2, z: -2 }, rotation: 0 });
    const bath = makeItem({ id: 'bath', type: 'bathtub', width: 1.7, depth: 0.8, height: 0.55, position: { x: -3, z: 0 }, rotation: Math.PI / 2 });
    const basin = makeItem({ id: 'basin', type: 'bathroom-sink', width: 0.6, depth: 0.45, height: 0.85, position: { x: 3, z: 1 }, rotation: Math.PI });
    const spots = spotsOf([toilet, shower, bath, basin]);
    expect(spots.map((spot) => [spot.itemId, spot.need, spot.seatKey])).toEqual([
      ['toilet', 'hygiene', null],
      ['shower', 'hygiene', null],
      ['bath', 'hygiene', null],
      ['basin', 'hygiene', null],
    ]);
    expect(spots[0]!.z).toBeCloseTo(-2 + 0.35 + 0.35);
    expect(spots[1]!.z).toBeCloseTo(-2 + 0.45 + 0.35);
    // The bath turned to face +x: stand on its +x side, facing back at it.
    expect(spots[2]!.x).toBeCloseTo(-3 + 0.4 + 0.35);
    expect(Math.sin(spots[2]!.heading)).toBeCloseTo(-1);
    // The basin faces −z.
    expect(spots[3]!.z).toBeCloseTo(1 - 0.225 - 0.35);
  });

  it('uses the computer from the desk chair facing it, and stands at one no seat faces (#904)', () => {
    const desk = makeItem({ id: 'desk', type: 'desk', width: 1.2, depth: 0.6, height: 0.75, position: { x: 0, z: -2 }, rotation: 0 });
    const computer = makeItem({ id: 'pc', type: 'computer', width: 0.5, depth: 0.5, height: 0.5, position: { x: 0, z: -2 }, rotation: 0 });
    // The desk chair faces the desk (−z), just in front of it.
    const deskChair = makeItem({ id: 'desk-chair', type: 'chair', width: 0.5, depth: 0.5, height: 0.9, position: { x: 0, z: -1.25 }, rotation: Math.PI });
    // Facing the computer, but across the room: too far to use it.
    const farChair = makeItem({ id: 'far-chair', type: 'chair', width: 0.5, depth: 0.5, height: 0.9, position: { x: 0, z: 2 }, rotation: Math.PI });
    const spots = spotsOf([desk, computer, deskChair, farChair]);
    expect(spots.map((spot) => [spot.key, spot.itemId, spot.need, spot.seatKey])).toEqual([
      ['pc>desk-chair:0', 'desk-chair', 'fun', 'desk-chair:0'],
    ]);
    const alone = spotsOf([desk, computer, farChair]);
    expect(alone).toHaveLength(1);
    expect(alone[0]).toMatchObject({ itemId: 'pc', need: 'fun', seatKey: null, x: 0 });
    expect(alone[0]!.z).toBeCloseTo(-2 + 0.25 + 0.35);
  });

  it('meets nothing with a chair or a table', () => {
    expect(spotsOf([chair, makeItem({ id: 't', type: 'table' })])).toEqual([]);
  });
});

describe('pickNeedSpot', () => {
  const spot = (key: string, need: NeedSpot['need'], x: number): NeedSpot => ({
    key, itemId: key, itemType: key, need, x, z: 0, heading: 0, seatKey: null,
  });
  const fridge = spot('fridge', 'hunger', 3);
  const farFridge = spot('far-fridge', 'hunger', 12);
  const bed = spot('bed', 'energy', 3);
  const shelf = spot('shelf', 'fun', 1);
  const all = [fridge, farFridge, bed, shelf];
  const always = () => true;

  function tally(n: NpcNeeds, spots = all, skip: NeedSpot['need'] | null = null): Map<string, number> {
    const random = seeded(617);
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i++) {
      const picked = pickNeedSpot(n, spots, 0, 0, always, random, skip);
      const key = picked?.key ?? 'none';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  it('goes nowhere in particular while no need is pressing', () => {
    expect(pickNeedSpot(needs(0.9, 0.6, NEED_URGENT), all, 0, 0, always, seeded(1))).toBeNull();
  });

  it('heads for what meets the lowest need', () => {
    const counts = tally(needs(0.05, 0.4, 0.45));
    expect(counts.get('fridge')! + counts.get('far-fridge')!).toBeGreaterThan(1600);
    expect(counts.get('shelf') ?? 0).toBeLessThan(counts.get('bed') ?? 0);
  });

  it('prefers the nearer of two that meet the same need', () => {
    const counts = tally(needs(0.1, 1, 1));
    expect(counts.get('fridge')!).toBeGreaterThan(counts.get('far-fridge')! * 1.5);
  });

  it('heads for the toilet when hygiene is what is pressing (#904)', () => {
    const toilet = spot('toilet', 'hygiene', 4);
    expect(pickNeedSpot(needs(1, 1, 1, 0.6), [...all, toilet], 0, 0, always, seeded(1))).toBeNull();
    expect(tally(needs(1, 1, 1, 0.1), [...all, toilet]).get('toilet')).toBe(2000);
    const counts = tally(needs(0.4, 1, 1, 0.05), [...all, toilet]);
    expect(counts.get('toilet')!).toBeGreaterThan((counts.get('fridge') ?? 0) + (counts.get('far-fridge') ?? 0));
  });

  it('only weighs what meets a pressing need', () => {
    expect(scoreNeedSpot(needs(0.1, 1, 1), bed, 0, 0)).toBe(0);
    expect(tally(needs(1, 0.2, 1)).get('bed')).toBe(2000);
  });

  it('passes over spots it can not use, and the need being met now', () => {
    expect(pickNeedSpot(needs(0.1, 1, 1), all, 0, 0, (s) => s !== fridge, seeded(2))).toBe(farFridge);
    expect(pickNeedSpot(needs(0.1, 1, 1), all, 0, 0, () => false, seeded(2))).toBeNull();
    expect(tally(needs(0.1, 0.3, 1), all, 'hunger').get('bed')).toBe(2000);
  });

  it('is deterministic for a given random source', () => {
    const run = () => {
      const random = seeded(5);
      return Array.from({ length: 20 }, () => pickNeedSpot(needs(0.2, 0.2, 0.2), all, 0, 0, always, random)?.key);
    };
    expect(run()).toEqual(run());
  });
});

describe('what the household lacks (#906)', () => {
  const at = (id: string, type: string, x: number, z: number, rotation = 0): FurnitureItem =>
    makeItem({ id, type, width: type === 'bed' ? 2 : 0.6, depth: type === 'bed' ? 1.6 : 0.6, height: 0.8, position: { x, z }, rotation });
  const spotsOf = (items: FurnitureItem[]) => findNeedSpots(items, findNpcSeats(items));

  it('lists the needs no spot meets, in a fixed order', () => {
    expect(unmetNeeds([])).toEqual(['hunger', 'energy', 'fun', 'hygiene']);
    expect(unmetNeeds(spotsOf([at('f', 'fridge', 0, 0), at('t', 'bathroom-sink', 2, 0)]))).toEqual(['energy', 'fun']);
    expect(unmetNeeds(spotsOf([at('f', 'fridge', 0, 0), at('b', 'bed', 2, 2), at('s', 'bookshelf', -2, 0), at('t', 'shower', 2, -2)]))).toEqual([]);
    // A toilet alone is not somewhere to wash.
    expect(unmetNeeds(spotsOf([at('t', 'toilet', 2, -2)]))).toContain('hygiene');
    expect(unmetNeeds(spotsOf([at('t', 'toilet', 2, -2), at('b', 'bathtub', -2, 2)]))).not.toContain('hygiene');
    // A chair and a table meet nothing; neither does an item type named like a prototype key.
    expect(unmetNeeds(spotsOf([at('c', 'chair', 0, 0), at('x', 'constructor', 1, 1)]))).toHaveLength(4);
  });

  it('says it in words', () => {
    expect(['hunger', 'energy', 'fun', 'hygiene'].map((need) => NEED_LACK_LABELS[need as keyof typeof NEED_LACK_LABELS])).toEqual([
      'nowhere to eat',
      'nowhere to rest',
      'nothing to do',
      'nowhere to wash',
    ]);
  });

  it('per storey: a fridge upstairs feeds nobody downstairs, and the garden counts for nothing', () => {
    const { position: _position, ...unplaced } = at('unplaced', 'toilet', 0, 0);
    const building = {
      width: 8,
      height: 6,
      floors: [
        { items: [at('b', 'bed', 0, 0), at('garden-fridge', 'fridge', 6, 0), unplaced] },
        { items: [at('f', 'fridge', 0, 0), at('tv', 'tv', 2, 2)] },
      ],
    };
    expect(householdLacks(building)).toEqual([
      { floorIndex: 0, lacks: ['hunger', 'fun', 'hygiene'] },
      { floorIndex: 1, lacks: ['energy', 'hygiene'] },
    ]);
  });

  it('a corner cut is outside too', () => {
    const building = { width: 8, height: 6, cutout: { corner: 'ne' as const, width: 3, depth: 2 }, floors: [{ items: [at('f', 'fridge', 3.5, -2.5)] }] };
    expect(householdLacks(building)[0]!.lacks).toContain('hunger');
  });
});
