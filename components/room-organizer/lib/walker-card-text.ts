/**
 * The walker card's words (#906): a first name per walker, the line saying
 * what it is doing, the bars' labels and what it can't find. Only the card
 * (panels/walker-card.tsx, lazy) imports this, so none of it is in the
 * first load.
 */

import type { NeedKind } from './npc-needs';
import type { WalkerDoing } from './walker-card';

const NAMES: readonly string[] = [
  'Alex', 'Ash', 'Billie', 'Cam', 'Charlie', 'Dani', 'Eden', 'Ellis', 'Frankie', 'Harper', 'Jamie', 'Jo',
  'Jude', 'Kai', 'Kit', 'Lou', 'Morgan', 'Nico', 'Olly', 'Pat', 'Quinn', 'Remy', 'Riley', 'Robin',
  'Rowan', 'Sam', 'Sasha', 'Skye', 'Tam', 'Toni', 'Viv', 'Wren',
];

/**
 * A walker's first name, fixed by its seed. The walk hands out seeds in
 * order across the whole house, and a step coprime with the list's length
 * walks every name before one repeats: 32 walkers, 32 names.
 */
export function walkerName(seed: number): string {
  const n = NAMES.length;
  return NAMES[(((Math.trunc(seed) * 13 + 7) % n) + n) % n]!;
}

const USING_LINES: Readonly<Record<NeedKind, string>> = {
  hunger: 'Eating',
  energy: 'Resting',
  fun: 'Having fun',
  hygiene: 'Washing',
};

const SEEKING_LINES: Readonly<Record<NeedKind, string>> = {
  hunger: 'Off to eat',
  energy: 'Off for a rest',
  fun: 'Off for some fun',
  hygiene: 'Off for a wash',
};

/** The card's line: asleep, using something, on the way to it, or pottering about. */
export function walkerActivity(doing: Readonly<WalkerDoing>): string {
  if (doing.asleep) return 'Asleep';
  if (doing.using) return USING_LINES[doing.using];
  if (doing.seeking) return SEEKING_LINES[doing.seeking];
  return doing.seated ? 'Sitting down' : 'Pottering about';
}

/** The card's bars, in `NEED_KINDS` order: full is a need met. */
export const NEED_BAR_LABELS: Readonly<Record<NeedKind, string>> = {
  hunger: 'Food',
  energy: 'Energy',
  fun: 'Fun',
  hygiene: 'Hygiene',
};

/** What the card says a walker with a bubble goes without. */
export const WANT_LINES: Readonly<Record<NeedKind, string>> = {
  hunger: 'Hungry, and can’t find food',
  energy: 'Tired, and can’t find a bed',
  fun: 'Bored, with nothing to do',
  hygiene: 'Needs a wash, and can’t find one',
};
