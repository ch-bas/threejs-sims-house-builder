/**
 * What drives the walkers (hooks/use-npcs.ts) round the house (#617): four
 * needs that run down over time, and the things on the floor that top each
 * one up. Hunger sends a walker to the fridge or the stove, a lack of
 * energy to the bed or the sofa, boredom to the TV or the computer (a seat
 * facing it) or the bookshelf, and hygiene to the toilet, the shower, the
 * bath or the basin (#904). The scoring is pure and allocation-free, with randomness
 * injected, so it is tested here and the walk only asks where to go.
 */

import { type FootprintBuilding, isInsideBuilding } from './footprint';
import { type NpcSeat, findNpcSeats } from './npc-seats';
import type { NeedBias } from './npc-schedule';
import type { FloorLayout, FurnitureItem } from './types';

export type NeedKind = 'hunger' | 'energy' | 'fun' | 'hygiene';

/** Every need, in a fixed order. */
export const NEED_KINDS: readonly NeedKind[] = ['hunger', 'energy', 'fun', 'hygiene'];

/** Each need from 0 (empty) to 1 (met). */
export interface NpcNeeds {
  hunger: number;
  energy: number;
  fun: number;
  hygiene: number;
}

/** Seconds a need takes to run from met to empty. */
const NEED_SECONDS: Readonly<Record<NeedKind, number>> = { hunger: 150, energy: 240, fun: 120, hygiene: 200 };
/** A need under this sends the walker to whatever meets it. */
export const NEED_URGENT = 0.5;
/** How fast using something tops its need up, per second: a stop of a few seconds meets it. */
export const NEED_REFILL_PER_SECOND = 0.25;
/** Distance (m) at which a spot's pull is halved: nearer things win, all else equal. */
const NEAR_SCALE = 4;
/** Where a walker stands to use something: this far in front of it. */
const STAND_GAP = 0.35;
/** A walker watches a TV from a seat facing it within this range (m). */
const TV_RANGE = 4.5;
/** cos of the widest angle off a seat's facing at which its TV is watched. */
const TV_FACING_COS = 0.3;
/** With no seat facing it, a TV is watched standing this far in front. */
const TV_STAND_GAP = 1.2;
/** A computer is used from a seat facing it within this range (m): the desk chair (#904). */
const COMPUTER_RANGE = 1.3;

/** What each item type is for: everything else meets no need. */
const NEED_OF_TYPE: Readonly<Record<string, NeedKind>> = {
  fridge: 'hunger',
  stove: 'hunger',
  bed: 'energy',
  sofa: 'energy',
  tv: 'fun',
  bookshelf: 'fun',
  computer: 'fun',
  toilet: 'hygiene',
  shower: 'hygiene',
  bathtub: 'hygiene',
  'bathroom-sink': 'hygiene',
};

/** Screens: used from a seat facing them within range, or else standing in front (#904). */
const SCREEN_RANGE: Readonly<Record<string, number>> = { tv: TV_RANGE, computer: COMPUTER_RANGE };

/** The need an item type meets; null for most things (and prototype keys such as "constructor"). */
export function needOfType(type: string): NeedKind | null {
  return Object.hasOwn(NEED_OF_TYPE, type) ? NEED_OF_TYPE[type]! : null;
}

/** Fresh needs for a new walker: each somewhere between a third and full, so they don't all get hungry at once. */
export function randomNeeds(random: () => number): NpcNeeds {
  const level = () => 0.35 + random() * 0.65;
  return { hunger: level(), energy: level(), fun: level(), hygiene: level() };
}

/** Run every need down by `seconds` of time. */
export function decayNeeds(needs: NpcNeeds, seconds: number): void {
  needs.hunger = Math.max(0, needs.hunger - seconds / NEED_SECONDS.hunger);
  needs.energy = Math.max(0, needs.energy - seconds / NEED_SECONDS.energy);
  needs.fun = Math.max(0, needs.fun - seconds / NEED_SECONDS.fun);
  needs.hygiene = Math.max(0, needs.hygiene - seconds / NEED_SECONDS.hygiene);
}

/** Top a need up for `seconds` of using what meets it. */
export function refillNeed(needs: NpcNeeds, need: NeedKind, seconds: number): void {
  needs[need] = Math.min(1, needs[need] + seconds * NEED_REFILL_PER_SECOND);
}

/**
 * How pressing a need is: 0 at or above `NEED_URGENT`, 1 when empty. A
 * `bias` (the hour, lib/npc-schedule.ts) raises the threshold, so the need
 * presses sooner; a bias of 1 or more makes it press even when met.
 */
export function urgency(needs: NpcNeeds, need: NeedKind, bias = 0): number {
  const threshold = NEED_URGENT + Math.max(0, bias);
  return Math.max(0, (threshold - needs[need]) / threshold);
}

/** The bias for one need; 0 when the table has none (or for a prototype key). */
function biasOf(bias: NeedBias | undefined, need: NeedKind): number {
  return bias && Object.hasOwn(bias, need) ? (bias[need] ?? 0) : 0;
}

/** Somewhere on the floor that meets a need. */
export interface NeedSpot {
  key: string;
  itemId: string;
  itemType: string;
  need: NeedKind;
  /** Where the walker heads: the spot it stands on, or the seat's approach point. */
  x: number;
  z: number;
  /** The heading that faces the item while standing there. */
  heading: number;
  /** The seat to sit in (`NpcSeat.key`), or null to stand. */
  seatKey: string | null;
}

/**
 * Every spot on a floor that meets a need: in front of a fridge, a stove, a
 * bookshelf, a toilet, a shower, a bath or a basin; in a sofa or on the end
 * of a bed (`seats`, from `findNpcSeats`); in any seat facing a TV or a
 * computer, or in front of one no seat faces. Items face their local +z.
 * Build with the seats, not per frame.
 */
export function findNeedSpots(items: readonly FurnitureItem[], seats: readonly NpcSeat[]): NeedSpot[] {
  const spots: NeedSpot[] = [];
  for (const seat of seats) {
    const need = needOfType(seat.itemType);
    if (need === null) continue;
    spots.push(seatSpot(seat, need));
  }
  for (const item of items) {
    const need = needOfType(item.type);
    if (!item.position || need === null || item.type === 'bed' || item.type === 'sofa') continue;
    const range = Object.hasOwn(SCREEN_RANGE, item.type) ? SCREEN_RANGE[item.type]! : 0;
    if (range > 0) {
      const watching = seats.filter((seat) => seat.itemType !== 'bed' && facesScreen(seat, item.position!, range));
      for (const seat of watching) spots.push({ ...seatSpot(seat, need), key: `${item.id}>${seat.key}` });
      if (watching.length > 0) continue;
    }
    const rotation = item.rotation ?? 0;
    const gap = item.depth / 2 + (item.type === 'tv' ? TV_STAND_GAP : STAND_GAP);
    spots.push({
      key: item.id,
      itemId: item.id,
      itemType: item.type,
      need,
      x: item.position.x + Math.sin(rotation) * gap,
      z: item.position.z + Math.cos(rotation) * gap,
      // Facing back at the item's front.
      heading: rotation + Math.PI,
      seatKey: null,
    });
  }
  return spots;
}

function seatSpot(seat: NpcSeat, need: NeedKind): NeedSpot {
  return {
    key: seat.key,
    itemId: seat.itemId,
    itemType: seat.itemType,
    need,
    x: seat.approachX,
    z: seat.approachZ,
    heading: seat.rotation,
    seatKey: seat.key,
  };
}

function facesScreen(seat: NpcSeat, screen: { x: number; z: number }, range: number): boolean {
  const toX = screen.x - seat.x;
  const toZ = screen.z - seat.z;
  const distance = Math.hypot(toX, toZ);
  if (distance < 1e-6 || distance > range) return false;
  return (toX * Math.sin(seat.rotation) + toZ * Math.cos(seat.rotation)) / distance > TV_FACING_COS;
}

/**
 * How much a walker at (fromX, fromZ) wants to head for `spot`: the urgency
 * of its need, squared so the most pressing need dominates, and halved at
 * `NEAR_SCALE` metres away. 0 when its need isn't pressing.
 */
export function scoreNeedSpot(needs: NpcNeeds, spot: NeedSpot, fromX: number, fromZ: number, bias?: NeedBias): number {
  const pull = urgency(needs, spot.need, biasOf(bias, spot.need));
  if (pull <= 0) return 0;
  const distance = Math.hypot(spot.x - fromX, spot.z - fromZ);
  return (pull * pull) / (1 + distance / NEAR_SCALE);
}

function anyUrgent(needs: NpcNeeds, bias: NeedBias | undefined): boolean {
  for (const need of NEED_KINDS) if (urgency(needs, need, biasOf(bias, need)) > 0) return true;
  return false;
}

/**
 * Where a walker goes to meet its needs: a spot picked at random, weighted
 * by `scoreNeedSpot`, among those `usable` says it can reach and nobody
 * holds. `skip` leaves out the need being met right now (it is about to be
 * topped up). `bias` is the hour's tilt (`needBias`, lib/npc-schedule.ts).
 * Null when no need is pressing or nothing usable meets one.
 * One random draw per candidate; no allocation.
 */
export function pickNeedSpot(
  needs: NpcNeeds,
  spots: readonly NeedSpot[],
  fromX: number,
  fromZ: number,
  usable: (spot: NeedSpot) => boolean,
  random: () => number,
  skip: NeedKind | null = null,
  bias?: NeedBias
): NeedSpot | null {
  if (!anyUrgent(needs, bias)) return null;
  let chosen: NeedSpot | null = null;
  let total = 0;
  for (const spot of spots) {
    if (spot.need === skip) continue;
    const weight = scoreNeedSpot(needs, spot, fromX, fromZ, bias);
    if (weight <= 0 || !usable(spot)) continue;
    total += weight;
    if (random() * total < weight) chosen = spot;
  }
  return chosen;
}

/**
 * The needs no spot meets (#906), in `NEED_KINDS` order: what the walkers
 * on that storey go without. Empty when every need is met somewhere. A
 * toilet alone is not somewhere to wash: that takes a basin, a shower or
 * a bath, though a walker in need uses the toilet too.
 */
export function unmetNeeds(spots: readonly NeedSpot[]): NeedKind[] {
  return NEED_KINDS.filter((need) => !spots.some((spot) => spot.need === need && !(need === 'hygiene' && spot.itemType === 'toilet')));
}

/** What a storey lacks, as the Household block in Statistics says it (#906). */
export const NEED_LACK_LABELS: Readonly<Record<NeedKind, string>> = {
  hunger: 'nowhere to eat',
  energy: 'nowhere to rest',
  fun: 'nothing to do',
  hygiene: 'nowhere to wash',
};

/** One storey's unmet needs. */
export interface StoreyLacks {
  floorIndex: number;
  lacks: NeedKind[];
}

/**
 * For each storey, the needs nothing on it meets (#906): walkers keep to
 * their storey (#580), so a fridge upstairs feeds nobody downstairs. Only
 * what stands on the building counts: the walkers stay indoors. Pure; for
 * a panel, not per frame.
 */
export function householdLacks(building: FootprintBuilding & { floors: readonly Pick<FloorLayout, 'items'>[] }): StoreyLacks[] {
  return building.floors.map((floor, floorIndex) => {
    const items = floor.items.filter((item) => item.position && isInsideBuilding(building, item.position.x, item.position.z));
    return { floorIndex, lacks: unmetNeeds(findNeedSpots(items, findNpcSeats(items))) };
  });
}
