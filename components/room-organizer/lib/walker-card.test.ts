import { describe, expect, it, vi } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { type NeedSpot, type NpcNeeds, findNeedSpots } from './npc-needs';
import { findNpcSeats } from './npc-seats';
import {
  placeWalkerCard,
  BUBBLE_URGENCY,
  type WalkerCardSnapshot,
  type WalkerDoing,
  bubbleNeed,
  createWalkerCards,
  needBit,
  strandedNeeds,
} from './walker-card';
import { NEED_BAR_LABELS, WANT_LINES, walkerActivity, walkerName } from './walker-card-text';

function needs(hunger: number, energy: number, fun: number, hygiene = 1): NpcNeeds {
  return { hunger, energy, fun, hygiene };
}

const idle: WalkerDoing = { asleep: false, seated: false, seeking: null, using: null };
const ALL = needBit('hunger') | needBit('energy') | needBit('fun') | needBit('hygiene');

describe('what a walker can reach (#906)', () => {
  const at = (id: string, type: string, x: number, z: number, rotation = 0) =>
    makeItem({ id, type, width: type === 'bed' ? 2 : 0.6, depth: type === 'bed' ? 1.6 : 0.6, height: 0.8, position: { x, z }, rotation });
  const spotsOf = (items: ReturnType<typeof at>[]): NeedSpot[] => findNeedSpots(items, findNpcSeats(items));

  it('a need is stranded when no spot for it can be used', () => {
    expect(strandedNeeds([], () => true)).toBe(ALL);
    const spots = spotsOf([at('f', 'fridge', 0, 0), at('b', 'bed', 2, 2)]);
    expect(strandedNeeds(spots, () => true)).toBe(needBit('fun') | needBit('hygiene'));
    // The fridge out of reach: hunger is stranded too.
    expect(strandedNeeds(spots, (spot) => spot.itemId !== 'f')).toBe(needBit('hunger') | needBit('fun') | needBit('hygiene'));
    // A walker that can't sit has nowhere to rest on a bed.
    expect(strandedNeeds(spots, (spot) => spot.seatKey === null) & needBit('energy')).toBe(needBit('energy'));
  });

  it('a chair at a table is not somewhere to find food', () => {
    const table = makeItem({ id: 't', type: 'dining-table', width: 1.8, depth: 1, position: { x: 0, z: 0 } });
    const chair = makeItem({ id: 'c', type: 'dining-chair', width: 0.45, depth: 0.45, position: { x: 0, z: -0.95 }, rotation: 0 });
    const spots = spotsOf([table, chair]);
    expect(spots.some((spot) => spot.meal)).toBe(true);
    expect(strandedNeeds(spots, () => true) & needBit('hunger')).toBe(needBit('hunger'));
  });
});

describe('the thought bubble (#906)', () => {
  it('shows the most pressing need past the threshold, only when nothing reachable meets it', () => {
    expect(BUBBLE_URGENCY).toBe(0.6);
    expect(bubbleNeed(needs(1, 1, 1, 1), ALL, idle)).toBeNull();
    // Pressing, but not yet bubble-worthy: about a fifth full is the line.
    expect(bubbleNeed(needs(0.3, 1, 1), ALL, idle)).toBeNull();
    expect(bubbleNeed(needs(0.15, 1, 1), ALL, idle)).toBe('hunger');
    expect(bubbleNeed(needs(0.15, 0.05, 1), ALL, idle)).toBe('energy');
    // A fridge it can reach: no bubble, however hungry.
    expect(bubbleNeed(needs(0.05, 1, 1), ALL & ~needBit('hunger'), idle)).toBeNull();
    // Only the worst need counts: a stranded second worst never shows.
    expect(bubbleNeed(needs(0.05, 0.1, 1), needBit('energy'), idle)).toBeNull();
  });

  it('none while asleep, while using something, or on the way to meet it', () => {
    expect(bubbleNeed(needs(0.05, 1, 1), ALL, { ...idle, asleep: true, seated: true, using: 'energy' })).toBeNull();
    expect(bubbleNeed(needs(0.05, 1, 1), ALL, { ...idle, seated: true, using: 'fun' })).toBeNull();
    expect(bubbleNeed(needs(0.05, 1, 1), ALL, { ...idle, seeking: 'hunger' })).toBeNull();
    // On the way to something else, the stranded need still shows.
    expect(bubbleNeed(needs(0.05, 1, 1), ALL, { ...idle, seeking: 'fun' })).toBe('hunger');
  });
});

describe('walker names (#906)', () => {
  it('the same for the same seed, and 32 in a row all different', () => {
    const names = Array.from({ length: 32 }, (_, seed) => walkerName(seed));
    expect(new Set(names).size).toBe(32);
    for (const name of names) expect(name).toMatch(/^[A-Z][a-z]+$/);
    expect(walkerName(5)).toBe(names[5]);
    expect(walkerName(-3)).toMatch(/^[A-Z][a-z]+$/);
  });
});

describe('what the card says (#906)', () => {
  it('says what the walker is doing', () => {
    expect(walkerActivity(idle)).toBe('Pottering about');
    expect(walkerActivity({ ...idle, seated: true })).toBe('Sitting down');
    expect(walkerActivity({ ...idle, seeking: 'hunger' })).toBe('Off to eat');
    expect(walkerActivity({ ...idle, seeking: 'hygiene' })).toBe('Off for a wash');
    expect(walkerActivity({ ...idle, using: 'hunger', seated: true })).toBe('Eating');
    expect(walkerActivity({ ...idle, using: 'fun' })).toBe('Having fun');
    expect(walkerActivity({ ...idle, using: 'energy', seated: true, asleep: true })).toBe('Asleep');
  });

  it('has a label for every bar and a line for every want, in en-GB', () => {
    expect(Object.values(NEED_BAR_LABELS)).toEqual(['Food', 'Energy', 'Fun', 'Hygiene']);
    for (const line of Object.values(WANT_LINES)) expect(line).toMatch(/^[A-Z][^.]+$/);
  });
});

describe('the walker card store (#906)', () => {
  const card = (id: number, hunger = 0.5, doing: WalkerDoing = idle): WalkerCardSnapshot => ({ id, seed: 2, doing, needs: needs(hunger, 1, 1), wants: null });

  it('opens on a tap, takes the walk’s snapshots for that walker only, and closes', () => {
    const cards = createWalkerCards();
    const listener = vi.fn();
    cards.subscribe(listener);
    expect(cards.selected()).toBeNull();
    cards.select(3, { x: 100, y: 200 });
    expect(cards.selected()).toBe(3);
    expect(cards.anchor()).toEqual({ x: 100, y: 200 });
    expect(cards.snapshot()).toBeNull();
    cards.publish(card(4));
    expect(cards.snapshot()).toBeNull();
    cards.publish(card(3));
    expect(cards.snapshot()?.id).toBe(3);
    cards.close();
    expect([cards.selected(), cards.snapshot(), cards.anchor()]).toEqual([null, null, null]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('re-renders nothing for a snapshot the card would show the same', () => {
    const cards = createWalkerCards();
    cards.select(1);
    cards.publish(card(1, 0.501));
    const listener = vi.fn();
    cards.subscribe(listener);
    const first = cards.snapshot();
    cards.publish(card(1, 0.502));
    expect(cards.snapshot()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
    cards.publish(card(1, 0.49));
    expect(listener).toHaveBeenCalledTimes(1);
    cards.publish(card(1, 0.49, { ...idle, seeking: 'hunger' }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('a tap on another walker, or the same one elsewhere, moves the card; closing twice tells nobody', () => {
    const cards = createWalkerCards();
    cards.select(1, { x: 1, y: 1 });
    cards.publish(card(1));
    const listener = vi.fn();
    const stop = cards.subscribe(listener);
    cards.select(1);
    expect(listener).not.toHaveBeenCalled();
    cards.select(1, { x: 5, y: 5 });
    expect(cards.anchor()).toEqual({ x: 5, y: 5 });
    cards.select(2, { x: 9, y: 9 });
    expect([cards.selected(), cards.snapshot()]).toEqual([2, null]);
    cards.close();
    cards.close();
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
    cards.select(7);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('where the card goes (#906)', () => {
  const size = { width: 200, height: 150 };
  const phone = { width: 390, height: 664 };
  const overlap = (at: { left: number; top: number }, r: { left: number; top: number; right: number; bottom: number }) =>
    at.left < r.right && r.left < at.left + size.width && at.top < r.bottom && r.top < at.top + size.height;

  it('above and to the right of the tap, on the page, with nothing in the way', () => {
    expect(placeWalkerCard({ x: 100, y: 400 }, size, phone, [])).toEqual({ left: 114, top: 236 });
    // At the right edge it is pulled in; near the top it goes below.
    expect(placeWalkerCard({ x: 380, y: 100 }, size, phone, [])).toEqual({ left: 390 - 200 - 8, top: 114 });
  });

  it("keeps clear of the HUD: the phone's walls pill (shots/ph-card.png), the left rail, the dock", () => {
    // iPhone 13 in CSS px: the UP/CUT/DOWN pill, the camera rail, the dock and the item sheet.
    const pill = { left: 217, top: 68, right: 382, bottom: 115 };
    const rail = { left: 8, top: 8, right: 52, bottom: 300 };
    const dock = { left: 8, top: 337, right: 382, bottom: 526 };
    const occluders = [pill, rail, dock];
    const at = placeWalkerCard({ x: 205, y: 270 }, size, phone, occluders);
    for (const r of occluders) expect(overlap(at, r)).toBe(false);
    // Only as far from the first choice as the pill needs.
    expect(at.top).toBe(pill.bottom + 8);
  });

  it('covers as little of the HUD as it can when nothing is clear', () => {
    const everywhere = [{ left: 0, top: 0, right: 390, bottom: 400 }];
    const at = placeWalkerCard({ x: 200, y: 300 }, size, phone, everywhere);
    expect(at.top).toBe(408);
  });
});
