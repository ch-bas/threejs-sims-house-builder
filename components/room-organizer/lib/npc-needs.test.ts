import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import {
  NEED_URGENT,
  type NeedSpot,
  type NpcNeeds,
  decayNeeds,
  findNeedSpots,
  needOfType,
  pickNeedSpot,
  randomNeeds,
  refillNeed,
  scoreNeedSpot,
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

function needs(hunger: number, energy: number, fun: number): NpcNeeds {
  return { hunger, energy, fun };
}

describe('needs run down and are met (#617)', () => {
  it('decay at their own rates and never below empty', () => {
    const n = needs(1, 1, 1);
    decayNeeds(n, 60);
    expect(n.fun).toBeLessThan(n.hunger);
    expect(n.hunger).toBeLessThan(n.energy);
    expect(n.energy).toBeLessThan(1);
    decayNeeds(n, 10_000);
    expect(n).toEqual(needs(0, 0, 0));
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
      for (const level of [n.hunger, n.energy, n.fun]) {
        expect(level).toBeGreaterThan(0.34);
        expect(level).toBeLessThanOrEqual(1);
      }
    }
  });

  it('knows what each item is for, and nothing for a prototype key', () => {
    expect(['fridge', 'stove', 'bed', 'sofa', 'tv', 'bookshelf'].map(needOfType)).toEqual(['hunger', 'hunger', 'energy', 'energy', 'fun', 'fun']);
    expect(needOfType('chair')).toBeNull();
    expect(needOfType('constructor')).toBeNull();
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
