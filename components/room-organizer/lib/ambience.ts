/**
 * Ambient sound in EXPLORE (#911): rain on the roof, footsteps, birds by
 * day, crickets at night and the doors as they swing, with no audio assets.
 * The mappings, pure and tested: what each sound's gain is, and when it
 * plays. The Web Audio engine that plays them is `lib/ambience-engine.ts`,
 * loaded only once a walk wants the ambience.
 */

import type { Weather } from './types';

export interface RainSound {
  /** Gain of the rain loop, 0 for silence. */
  gain: number;
  /** Low-pass cutoff (Hz): indoors the roof and the walls muffle it. */
  cutoffHz: number;
}

/** Rain heard out on the lot. */
export const RAIN_OUTDOORS: RainSound = { gain: 0.16, cutoffHz: 5200 };
/** Rain heard through the roof: quieter and duller. */
const RAIN_INDOORS: RainSound = { gain: 0.07, cutoffHz: 900 };

/**
 * What the rain sounds like from where the walker is. Snow falls silently, and
 * a clear sky has no rain. The cutoff is kept whatever the gain, so a fade
 * never sweeps the filter.
 */
export function rainSound(weather: Weather, indoors: boolean): RainSound {
  const heard = indoors ? RAIN_INDOORS : RAIN_OUTDOORS;
  return weather === 'rain' ? heard : { gain: 0, cutoffHz: heard.cutoffHz };
}

/** Metres walked per footstep. */
export const STRIDE_METRES = 0.75;

export interface StrideState {
  /** Metres walked since the last step. */
  carry: number;
  /** Steps that fall due over this stretch. */
  steps: number;
}

/**
 * Footsteps paced by the distance walked, not by time: standing still or
 * walking into a wall makes no sound, and a sprint steps twice as often. At
 * most one step per call, so a long frame never plays a burst of them.
 */
export function advanceStride(carry: number, walked: number, stride: number = STRIDE_METRES, out: StrideState = { carry: 0, steps: 0 }): StrideState {
  const total = carry + Math.max(0, walked);
  out.carry = total < stride ? total : total % stride;
  out.steps = total < stride ? 0 : 1;
  return out;
}

export interface WildlifeSound {
  /** Gain of a bird's call, 0 for none. */
  birds: number;
  /** Gain of a cricket's trill, 0 for none. */
  crickets: number;
}

/** A bird's call at full voice, and a cricket's trill. */
const BIRD_GAIN = 0.09;
const CRICKET_GAIN = 0.035;
/** Indoors the walls and the glass keep most of it out. */
const WILDLIFE_INDOORS = 0.3;
/** Under a light snow fewer birds call; in the rain none do. */
const BIRDS_IN_SNOW = 0.4;

/** 0 at `from`, 1 at `to`, linear between (either way round). */
function ramp(hour: number, from: number, to: number): number {
  const t = (hour - from) / (to - from);
  return Math.max(0, Math.min(1, t));
}

/**
 * Who is calling at `hour` (in [0, 24)): birds by day, loudest in the dawn
 * chorus and quieting through dusk, crickets after 21:00 until the small
 * hours (#911). Rain silences both; snow leaves a few birds and no crickets.
 * Indoors it is all much quieter. Pure: the gain mapping the engine plays.
 * Written into `out` when given (the per-frame caller reuses one).
 */
export function wildlifeSound(hour: number, weather: Weather, indoors: boolean, out: WildlifeSound = { birds: 0, crickets: 0 }): WildlifeSound {
  const h = ((hour % 24) + 24) % 24;
  // The chorus swells from 5:00, peaks 6–8, settles to half by 10, fades 19–20:30.
  const chorus = ramp(h, 5, 6) * (1 - 0.5 * ramp(h, 8, 10));
  const birdsByHour = h < 19 ? chorus : chorus * (1 - ramp(h, 19, 20.5));
  // Crickets come in over 20:30–21:30 and go before dawn, 4–5.
  const cricketsByHour = h >= 12 ? ramp(h, 20.5, 21.5) : 1 - ramp(h, 4, 5);
  const room = indoors ? WILDLIFE_INDOORS : 1;
  const birdsWeather = weather === 'rain' ? 0 : weather === 'snow' ? BIRDS_IN_SNOW : 1;
  const cricketsWeather = weather === 'clear' ? 1 : 0;
  out.birds = BIRD_GAIN * birdsByHour * birdsWeather * room;
  out.crickets = CRICKET_GAIN * cricketsByHour * cricketsWeather * room;
  return out;
}

/** The kinds that call, for a loop that allocates nothing. */
export const WILDLIFE_KINDS: readonly (keyof WildlifeSound)[] = ['birds', 'crickets'];

/** Seconds from one call to the next: a bird now and then, crickets all but steady. */
const CALL_SPACING = { birds: [1.4, 5.5], crickets: [0.55, 1.3] } as const;

/**
 * The wait (s) before the next call of `kind`, from a random draw in [0, 1).
 * A louder chorus calls more often (up to twice as often for the birds);
 * nothing calls at gain 0.
 */
export function nextCallDelay(kind: keyof WildlifeSound, gain: number, random: number): number {
  if (!(gain > 0)) return Infinity;
  const [min, max] = CALL_SPACING[kind];
  const wait = min + (max - min) * Math.max(0, Math.min(1, random));
  if (kind === 'crickets') return wait;
  return wait / (1 + Math.min(1, gain / BIRD_GAIN));
}

/** A door is heard this far (m), through the house, before it is silent. */
const DOOR_HEARD_METRES = 12;
const DOOR_GAIN = 0.16;
/** Another storey's door comes through the floor faintly. */
const DOOR_OTHER_STOREY = 0.25;

/**
 * How loud a door that starts to swing, or shuts, is for a listener
 * `distance` metres away (#911): full voice within a metre, then falling
 * with distance to nothing at 12 m. A door on another storey is faint.
 */
export function doorSoundGain(distance: number, sameStorey: boolean): number {
  if (!(distance < DOOR_HEARD_METRES)) return 0;
  const near = Math.max(1, distance);
  const fade = 1 - (near - 1) / (DOOR_HEARD_METRES - 1);
  return DOOR_GAIN * (fade / near) * (sameStorey ? 1 : DOOR_OTHER_STOREY);
}

/** What a door's leaf did over a frame, for its sound: started to open, came shut, or neither. */
export type DoorSound = 'open' | 'shut';

/** From how open a leaf was (0 shut … 1) to how open it is now. */
export function doorSoundOf(wasOpen: number, isOpen: number): DoorSound | null {
  if (wasOpen <= 0 && isOpen > 0) return 'open';
  if (wasOpen > 0 && isOpen <= 0) return 'shut';
  return null;
}
