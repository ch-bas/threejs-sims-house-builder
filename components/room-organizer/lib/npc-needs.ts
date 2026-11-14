/**
 * What drives the walkers (hooks/use-npcs.ts) round the house (#617): three
 * needs that run down over time, and the things on the floor that top each
 * one up. Hunger sends a walker to the fridge or the stove, a lack of
 * energy to the bed or the sofa, boredom to the TV (a seat facing it) or
 * the bookshelf. The scoring is pure and allocation-free, with randomness
 * injected, so it is tested here and the walk only asks where to go.
 */

import type { NpcSeat } from './npc-seats';
import type { FurnitureItem } from './types';

export type NeedKind = 'hunger' | 'energy' | 'fun';

/** Each need from 0 (empty) to 1 (met). */
export interface NpcNeeds {
  hunger: number;
  energy: number;
  fun: number;
}

/** Seconds a need takes to run from met to empty. */
const NEED_SECONDS: Readonly<Record<NeedKind, number>> = { hunger: 150, energy: 240, fun: 120 };
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

/** What each item type is for: everything else meets no need. */
const NEED_OF_TYPE: Readonly<Record<string, NeedKind>> = {
  fridge: 'hunger',
  stove: 'hunger',
  bed: 'energy',
  sofa: 'energy',
  tv: 'fun',
  bookshelf: 'fun',
};

/** The need an item type meets; null for most things (and prototype keys such as "constructor"). */
export function needOfType(type: string): NeedKind | null {
  return Object.hasOwn(NEED_OF_TYPE, type) ? NEED_OF_TYPE[type]! : null;
}

/** Fresh needs for a new walker: each somewhere between a third and full, so they don't all get hungry at once. */
export function randomNeeds(random: () => number): NpcNeeds {
  const level = () => 0.35 + random() * 0.65;
  return { hunger: level(), energy: level(), fun: level() };
}

/** Run every need down by `seconds` of time. */
export function decayNeeds(needs: NpcNeeds, seconds: number): void {
  needs.hunger = Math.max(0, needs.hunger - seconds / NEED_SECONDS.hunger);
  needs.energy = Math.max(0, needs.energy - seconds / NEED_SECONDS.energy);
  needs.fun = Math.max(0, needs.fun - seconds / NEED_SECONDS.fun);
}

/** Top a need up for `seconds` of using what meets it. */
export function refillNeed(needs: NpcNeeds, need: NeedKind, seconds: number): void {
  needs[need] = Math.min(1, needs[need] + seconds * NEED_REFILL_PER_SECOND);
}

/** How pressing a need is: 0 at or above `NEED_URGENT`, 1 when empty. */
export function urgency(needs: NpcNeeds, need: NeedKind): number {
  return Math.max(0, (NEED_URGENT - needs[need]) / NEED_URGENT);
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
 * Every spot on a floor that meets a need: in front of a fridge, a stove or
 * a bookshelf; in a sofa or on the end of a bed (`seats`, from
 * `findNpcSeats`); in any seat facing a TV, or in front of a TV no seat
 * faces. Items face their local +z. Build with the seats, not per frame.
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
    if (item.type === 'tv') {
      const watching = seats.filter((seat) => seat.itemType !== 'bed' && facesTv(seat, item.position!));
      for (const seat of watching) spots.push({ ...seatSpot(seat, 'fun'), key: `${item.id}>${seat.key}` });
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

function facesTv(seat: NpcSeat, tv: { x: number; z: number }): boolean {
  const toX = tv.x - seat.x;
  const toZ = tv.z - seat.z;
  const distance = Math.hypot(toX, toZ);
  if (distance < 1e-6 || distance > TV_RANGE) return false;
  return (toX * Math.sin(seat.rotation) + toZ * Math.cos(seat.rotation)) / distance > TV_FACING_COS;
}

/**
 * How much a walker at (fromX, fromZ) wants to head for `spot`: the urgency
 * of its need, squared so the most pressing need dominates, and halved at
 * `NEAR_SCALE` metres away. 0 when its need isn't pressing.
 */
export function scoreNeedSpot(needs: NpcNeeds, spot: NeedSpot, fromX: number, fromZ: number): number {
  const pull = urgency(needs, spot.need);
  if (pull <= 0) return 0;
  const distance = Math.hypot(spot.x - fromX, spot.z - fromZ);
  return (pull * pull) / (1 + distance / NEAR_SCALE);
}

/**
 * Where a walker goes to meet its needs: a spot picked at random, weighted
 * by `scoreNeedSpot`, among those `usable` says it can reach and nobody
 * holds. `skip` leaves out the need being met right now (it is about to be
 * topped up). Null when no need is pressing or nothing usable meets one.
 * One random draw per candidate; no allocation.
 */
export function pickNeedSpot(
  needs: NpcNeeds,
  spots: readonly NeedSpot[],
  fromX: number,
  fromZ: number,
  usable: (spot: NeedSpot) => boolean,
  random: () => number,
  skip: NeedKind | null = null
): NeedSpot | null {
  if (urgency(needs, 'hunger') <= 0 && urgency(needs, 'energy') <= 0 && urgency(needs, 'fun') <= 0) return null;
  let chosen: NeedSpot | null = null;
  let total = 0;
  for (const spot of spots) {
    if (spot.need === skip) continue;
    const weight = scoreNeedSpot(needs, spot, fromX, fromZ);
    if (weight <= 0 || !usable(spot)) continue;
    total += weight;
    if (random() * total < weight) chosen = spot;
  }
  return chosen;
}
