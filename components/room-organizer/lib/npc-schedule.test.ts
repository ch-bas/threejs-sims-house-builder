import { describe, expect, it } from 'vitest';
import { type NeedSpot, type NpcNeeds, pickNeedSpot, urgency } from './npc-needs';
import { NO_BIAS, isMealHour, isSleepHour, needBias } from './npc-schedule';

function needs(hunger: number, energy: number, fun: number, hygiene = 1): NpcNeeds {
  return { hunger, energy, fun, hygiene };
}

describe('the walkers keep the clock (#907)', () => {
  it('sleep from 23:00 to 07:00, wrapping round midnight', () => {
    expect([22.99, 23, 0, 3, 6.99, 7, 12].map(isSleepHour)).toEqual([false, true, true, true, true, false, false]);
    expect(isSleepHour(27)).toBe(true);
    expect(isSleepHour(-0.5)).toBe(true);
    expect(isSleepHour(Number.NaN)).toBe(false);
  });

  it('eat around 08, 13 and 19', () => {
    expect([7.25, 8, 8.75, 9, 12.5, 13, 16, 19.5].map(isMealHour)).toEqual([true, true, true, false, true, true, false, true]);
    expect(isMealHour(Number.NaN)).toBe(false);
  });

  it('tilts rest at night, hunger at mealtimes, nothing otherwise or without a clock', () => {
    expect(needBias(3)).toEqual({ energy: 1 });
    expect(needBias(13)).toEqual({ hunger: 0.3 });
    expect(needBias(16)).toBe(NO_BIAS);
    expect(needBias(Number.NaN)).toBe(NO_BIAS);
    // Shared constants: no allocation per stop.
    expect(needBias(2)).toBe(needBias(4));
  });

  it('at night rest presses even when met; at noon hunger presses sooner', () => {
    const rested = needs(1, 1, 1);
    expect(urgency(rested, 'energy')).toBe(0);
    expect(urgency(rested, 'energy', needBias(3).energy)).toBeGreaterThan(0);
    const peckish = needs(0.7, 1, 1);
    expect(urgency(peckish, 'hunger')).toBe(0);
    expect(urgency(peckish, 'hunger', needBias(13).hunger)).toBeGreaterThan(0);
    // Just fed, even a mealtime doesn't send it back.
    expect(urgency(needs(1, 1, 1), 'hunger', needBias(13).hunger)).toBe(0);
  });

  it('sends a sated walker to bed at night and to the fridge at lunch, and nowhere at four', () => {
    const spot = (key: string, need: NeedSpot['need']): NeedSpot => ({ key, itemId: key, itemType: key, need, x: 2, z: 0, heading: 0, seatKey: null });
    const spots = [spot('bed', 'energy'), spot('fridge', 'hunger'), spot('shelf', 'fun')];
    const pick = (n: NpcNeeds, hour: number) => pickNeedSpot(n, spots, 0, 0, () => true, () => 0.5, null, needBias(hour))?.key ?? null;
    expect(pick(needs(1, 1, 1), 2)).toBe('bed');
    expect(pick(needs(0.7, 1, 1), 13)).toBe('fridge');
    expect(pick(needs(0.7, 1, 1), 16)).toBeNull();
    // Starving at night still eats first: the bias makes rest press, not win.
    expect(pick(needs(0.02, 1, 1), 2)).toBe('fridge');
  });
});
