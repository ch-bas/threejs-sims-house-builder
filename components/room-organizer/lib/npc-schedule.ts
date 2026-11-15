/**
 * The walkers keep the clock (#907): the hour of the day (the view's
 * `timeOfDay`) tilts what they want. From 23:00 to 07:00 rest is always
 * pressing, and a walker that reaches a bed stays there until morning;
 * around breakfast, lunch and dinner hunger presses sooner. Pure and
 * allocation-free: the biases are shared constants, read by
 * `pickNeedSpot` (lib/npc-needs.ts) at each stop.
 */

import type { NeedKind } from './npc-needs';

/** How much sooner each need counts as pressing: added to `NEED_URGENT`. */
export type NeedBias = Readonly<Partial<Record<NeedKind, number>>>;

/** The sleep window: from this hour ... */
export const SLEEP_FROM = 23;
/** ... to this one, the next morning. */
export const SLEEP_TO = 7;
/** Mealtimes (hours), and how long either side of one hunger presses sooner. */
export const MEAL_HOURS: readonly number[] = [8, 13, 19];
export const MEAL_SPAN = 0.75;

/** No tilt: daytime between meals, or no clock. */
export const NO_BIAS: NeedBias = Object.freeze({});
/** Night: rest presses even when met, so everyone heads for bed. */
const NIGHT_BIAS: NeedBias = Object.freeze({ energy: 1 });
/** A mealtime: hunger counts as pressing below 0.8 instead of 0.5. */
const MEAL_BIAS: NeedBias = Object.freeze({ hunger: 0.3 });

/** The hour folded into [0, 24); NaN (no clock) stays NaN. */
function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

/** Whether `hour` falls in the night, when walkers sleep (23:00 to 07:00). False with no clock (NaN). */
export function isSleepHour(hour: number): boolean {
  if (!Number.isFinite(hour)) return false;
  const h = wrapHour(hour);
  return h >= SLEEP_FROM || h < SLEEP_TO;
}

/** Whether `hour` is within `MEAL_SPAN` of a mealtime. */
export function isMealHour(hour: number): boolean {
  if (!Number.isFinite(hour)) return false;
  const h = wrapHour(hour);
  for (const meal of MEAL_HOURS) if (Math.abs(h - meal) <= MEAL_SPAN) return true;
  return false;
}

/** How the hour tilts the walkers' needs: rest at night, hunger at mealtimes, nothing otherwise. */
export function needBias(hour: number): NeedBias {
  if (isSleepHour(hour)) return NIGHT_BIAS;
  if (isMealHour(hour)) return MEAL_BIAS;
  return NO_BIAS;
}
