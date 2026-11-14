/**
 * A short buzz under the finger for a placement, a wall snap and a refusal
 * (#687), beside the sound cues: touch has no other tactile feedback, and the
 * sounds start off. `navigator.vibrate` exists on Android browsers only, so
 * everywhere else (iOS Safari, desktops) this is a no-op. A mouse never
 * buzzes, even on a touch laptop, and neither does a device set to reduce
 * motion. The switch beside the sound switch turns it off for this device.
 */

import { rotatedHalfExtents, shellWalls, type FootprintBuilding } from './footprint';
import { COARSE_POINTER_QUERY } from './hud-layout';
import { prefersReducedMotion } from './reduced-motion';
import { safeGetItem, safeSetItem } from './safe-storage';
import type { SoundCue } from './sounds';
import type { FurnitureItem } from './types';

export type HapticKind = 'place' | 'snap' | 'refused';

/** Milliseconds: a tap for a placement, a tick for a snap, a double knock for a refusal. */
const PATTERNS: Record<HapticKind, number | number[]> = {
  place: 10,
  snap: 6,
  refused: [12, 60, 12],
};

/** What a sound cue buzzes, if anything: the cue call site is the one place each event fires. */
const CUE_HAPTICS: Partial<Record<SoundCue, HapticKind>> = {
  place: 'place',
  refused: 'refused',
};

type Vibrate = (pattern: number | number[]) => boolean;

/** Whether the browser has the vibration API at all (Android, not iOS Safari). */
export function canVibrate(): boolean {
  return vibrator() !== null;
}

function vibrator(): Vibrate | null {
  if (typeof navigator === 'undefined') return null;
  const vibrate = (navigator as { vibrate?: unknown }).vibrate;
  return typeof vibrate === 'function' ? (vibrate as Vibrate).bind(navigator) : null;
}

function coarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COARSE_POINTER_QUERY).matches;
}

/** Buzz for `kind`. True when the device was asked to vibrate. */
export function haptic(kind: HapticKind): boolean {
  const vibrate = vibrator();
  if (!vibrate || !coarsePointer() || prefersReducedMotion()) return false;
  try {
    return vibrate(PATTERNS[kind]);
  } catch {
    return false;
  }
}

/** The buzz that goes with a sound cue (place, refused); the others are silent to the touch. */
export function cueHaptic(cue: SoundCue): boolean {
  const kind = Object.hasOwn(CUE_HAPTICS, cue) ? CUE_HAPTICS[cue] : undefined;
  return kind ? haptic(kind) : false;
}

const CHOICE_KEY = 'haptics';

/** The switch, per device. On unless turned off here. */
export function loadHapticsChoice(storage?: Storage): boolean {
  return safeGetItem(CHOICE_KEY, storage) !== 'off';
}

export function saveHapticsChoice(enabled: boolean, storage?: Storage): void {
  safeSetItem(CHOICE_KEY, enabled ? 'on' : 'off', storage);
}

/**
 * The walls an item is against on one move of a drag: `touching` the ones it
 * sits flush on, `near` the ones it is still within the release band of (a
 * superset). A wall counts as left only once the item is out of the band, so
 * a finger wavering at the snap distance doesn't buzz on every re-entry.
 */
export interface WallContact {
  touching: readonly string[];
  near: readonly string[];
}

export const NO_WALLS: WallContact = { touching: [], near: [] };

/**
 * Decides when a drag snaps onto a wall: `next(contact)` for every move is
 * true when the item touches a wall it wasn't already against, never for
 * the walls the drag started on, nor for one it slid back onto from a
 * corner. `reset` starts a new drag.
 */
export interface SnapTicker {
  reset(): void;
  next(contact: WallContact): boolean;
}

export function createSnapTicker(): SnapTicker {
  let started = false;
  let against = new Set<string>();
  return {
    reset() {
      started = false;
      against = new Set();
    },
    next({ touching, near }) {
      const arrived = started && touching.some((wall) => !against.has(wall));
      started = true;
      const held = new Set(touching);
      for (const wall of against) if (near.includes(wall)) held.add(wall);
      against = held;
      return arrived;
    },
  };
}

/** How far (m) past the face an item must go before its wall counts as left: past the 0.35 m snap. */
export const WALL_RELEASE = 0.6;
const FLUSH = 1e-6;

/**
 * The shell walls a free-standing item at `position` sits flush on, and the
 * ones it is within WALL_RELEASE of, by the same faces snap-to-wall uses:
 * inside for an indoor item, outside for an outdoor one. However it got
 * there: the wall snap, or a grid step that already landed on the face.
 */
export function wallContact(
  position: { x: number; z: number },
  item: Pick<FurnitureItem, 'width' | 'depth' | 'rotation' | 'category'>,
  building: FootprintBuilding
): WallContact {
  const { halfW, halfD } = rotatedHalfExtents(item);
  const sign = item.category === 'outdoor' ? 1 : -1;
  const touching: string[] = [];
  const near: string[] = [];
  for (const wall of shellWalls(building)) {
    let gap: number;
    if (wall.side === 'west' || wall.side === 'east') {
      if (position.z - halfD >= wall.z2 || position.z + halfD <= wall.z1) continue;
      gap = Math.abs(position.x - (wall.x1 + (wall.side === 'east' ? 1 : -1) * sign * halfW));
    } else {
      if (position.x - halfW >= wall.x2 || position.x + halfW <= wall.x1) continue;
      gap = Math.abs(position.z - (wall.z1 + (wall.side === 'south' ? 1 : -1) * sign * halfD));
    }
    if (gap < FLUSH) touching.push(wall.id);
    if (gap < WALL_RELEASE) near.push(wall.id);
  }
  return { touching, near };
}

/**
 * Names the wall line an item sits on, for the snap ticker: an opening along
 * a wall at `rotation` (the item's, as Three.js turns +X towards -Z) keys on
 * the wall's direction and its distance from the origin, so sliding along one
 * wall keeps one key and a 180° flip doesn't change it.
 */
export function wallLineKey(position: { x: number; z: number }, rotation: number): string {
  const degrees = ((Math.round((rotation * 180) / Math.PI) % 180) + 180) % 180;
  const angle = (degrees * Math.PI) / 180;
  const offset = position.x * Math.sin(angle) + position.z * Math.cos(angle);
  return `${degrees}:${Math.round(offset * 100)}`;
}
