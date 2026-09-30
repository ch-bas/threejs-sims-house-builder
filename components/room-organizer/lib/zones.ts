import { MAX_ROOM_DIMENSION } from './constants';
import { totalCost } from './geometry';
import type { FurnitureItem, RoomZone, Vec2 } from './types';

/**
 * Room zones (#155): named, coloured rectangles a floor is divided into by
 * hand — "Bedroom", "Kitchen" — so the plan, the blueprint and the stats
 * panel can measure and cost each room. Interior walls don't bound space
 * (a documented limitation), so a zone is the user's own say on where a
 * room is; an item belongs to a zone when its centre lies inside it.
 * Everything here is pure: the validation the schema uses, the rectangle
 * normalisation the 2D draw gesture and the reducer share, and the stats.
 */

export const MAX_ZONES = 32;
/** A drawn rectangle thinner than this on either side is a slip, not a room. */
export const MIN_ZONE_SIZE = 0.3;
/** Drawn corners round to this many metres so areas read as clean numbers. */
const ZONE_GRID = 0.1;

/** Fill / label colours handed out in turn as zones are added. */
export const ZONE_COLORS: readonly string[] = [
  '#3b82f6',
  '#f59e0b',
  '#10b981',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#ef4444',
  '#f97316',
];

/** The geometry of a zone: its north-west corner and its extent (see `RoomZone`). */
export type ZoneRect = Pick<RoomZone, 'x' | 'z' | 'w' | 'd'>;

export interface ZoneStats {
  itemCount: number;
  /** Sum of the prices of the items inside, in §. */
  cost: number;
  /** w × d, in m². */
  area: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Bounded like a room dimension: a non-finite corner or a zero, negative or
 * absurd size must not reach the renderer (it would paint nothing, or a
 * rectangle the size of the street).
 */
export function isZoneRect(value: unknown): value is ZoneRect {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isFiniteNumber(v.x) &&
    isFiniteNumber(v.z) &&
    Math.abs(v.x) <= MAX_ROOM_DIMENSION &&
    Math.abs(v.z) <= MAX_ROOM_DIMENSION &&
    isFiniteNumber(v.w) &&
    isFiniteNumber(v.d) &&
    v.w > 0 &&
    v.d > 0 &&
    v.w <= MAX_ROOM_DIMENSION &&
    v.d <= MAX_ROOM_DIMENSION
  );
}

export function isRoomZone(value: unknown): value is RoomZone {
  if (!isZoneRect(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.color === 'string';
}

/**
 * The rectangle spanned by two dragged corners (any order), rounded to
 * ZONE_GRID and clamped to the room's footprint; `null` when what's left
 * is too small to be a room. Used by the 2D draw gesture and, on every
 * add/update, by the reducer — so a stored zone always fits its floor.
 */
export function zoneFromCorners(a: Vec2, b: Vec2, roomWidth: number, roomDepth: number): ZoneRect | null {
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const x0 = clamp(round(Math.min(a.x, b.x)), -halfW, halfW);
  const x1 = clamp(round(Math.max(a.x, b.x)), -halfW, halfW);
  const z0 = clamp(round(Math.min(a.z, b.z)), -halfD, halfD);
  const z1 = clamp(round(Math.max(a.z, b.z)), -halfD, halfD);
  const w = round(x1 - x0);
  const d = round(z1 - z0);
  if (!(w >= MIN_ZONE_SIZE) || !(d >= MIN_ZONE_SIZE)) return null;
  return { x: x0, z: z0, w, d };
}

/** `zoneFromCorners` for a rectangle already expressed as corner + size. */
export function clampZoneRect(rect: ZoneRect, roomWidth: number, roomDepth: number): ZoneRect | null {
  if (!isZoneRect(rect)) return null;
  return zoneFromCorners({ x: rect.x, z: rect.z }, { x: rect.x + rect.w, z: rect.z + rect.d }, roomWidth, roomDepth);
}

/** Inclusive on every edge, so an item centred on a shared boundary counts for both rooms. */
export function zoneContains(zone: ZoneRect, x: number, z: number): boolean {
  return x >= zone.x && x <= zone.x + zone.w && z >= zone.z && z <= zone.z + zone.d;
}

/** The items whose centre lies inside the zone (unplaced items never do). */
export function itemsInZone(zone: ZoneRect, items: readonly FurnitureItem[]): FurnitureItem[] {
  return items.filter((item) => item.position !== undefined && zoneContains(zone, item.position.x, item.position.z));
}

export function zoneArea(zone: ZoneRect): number {
  return zone.w * zone.d;
}

export function zoneStats(zone: ZoneRect, items: readonly FurnitureItem[]): ZoneStats {
  const inside = itemsInZone(zone, items);
  return { itemCount: inside.length, cost: totalCost(inside), area: zoneArea(zone) };
}

/** The first palette colour no zone uses yet, cycling once they're all taken. */
export function nextZoneColor(existing: readonly RoomZone[]): string {
  const used = new Set(existing.map((zone) => zone.color));
  const free = ZONE_COLORS.find((color) => !used.has(color));
  return free ?? ZONE_COLORS[existing.length % ZONE_COLORS.length]!;
}

/** "Zone 1", "Zone 2", … — the first number no zone on the floor is named after. */
export function defaultZoneName(existing: readonly RoomZone[]): string {
  const names = new Set(existing.map((zone) => zone.name));
  for (let n = 1; ; n++) {
    const name = `Zone ${n}`;
    if (!names.has(name)) return name;
  }
}

/** Field-wise equality, so re-submitting a zone unchanged keeps state identity. */
export function sameZone(a: RoomZone, b: RoomZone): boolean {
  return (
    a.id === b.id && a.name === b.name && a.color === b.color && a.x === b.x && a.z === b.z && a.w === b.w && a.d === b.d
  );
}

function round(value: number): number {
  const steps = 1 / ZONE_GRID;
  return Math.round(value * steps) / steps;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
