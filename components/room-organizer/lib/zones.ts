import { MAX_ROOM_DIMENSION } from './constants';
import { autoOrganize, type AutoOrganizeStrategy, type CollisionContext, totalCost } from './geometry';
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
 * The rectangle spanned by two dragged corners (any order), clamped to the
 * room's footprint; `null` when what's left is too small to be a room. A
 * corner rounds to ZONE_GRID, except one within half a step of a wall (or
 * past it), which lands on the wall, so a zone drawn edge to edge on a
 * 5.05 m floor ends at the wall rather than 5 cm past it (#618). Used by
 * the 2D draw gesture and, on every add/update, by the reducer — so a
 * stored zone always fits its floor, and re-fitting it changes nothing.
 */
export function zoneFromCorners(a: Vec2, b: Vec2, roomWidth: number, roomDepth: number): ZoneRect | null {
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const x0 = snapCorner(Math.min(a.x, b.x), halfW);
  const x1 = snapCorner(Math.max(a.x, b.x), halfW);
  const z0 = snapCorner(Math.min(a.z, b.z), halfD);
  const z1 = snapCorner(Math.max(a.z, b.z), halfD);
  // Sizes from the corners, without re-rounding to the grid; only float
  // noise is trimmed, and never past the far wall.
  const w = Math.min(trimNoise(x1 - x0), halfW - x0);
  const d = Math.min(trimNoise(z1 - z0), halfD - z0);
  if (!(w >= MIN_ZONE_SIZE) || !(d >= MIN_ZONE_SIZE)) return null;
  return { x: x0, z: z0, w, d };
}

/** A corner on the grid, or on the wall when it is within half a grid step of it or beyond. */
function snapCorner(value: number, half: number): number {
  // Round first, then test the rounded corner: a value that rounds to within
  // half a step of the wall must land on it, or the next re-fit would move it.
  const snapped = round(value);
  if (snapped >= half - ZONE_GRID / 2 || value >= half - ZONE_GRID / 2) return half;
  if (snapped <= -half + ZONE_GRID / 2 || value <= -half + ZONE_GRID / 2) return -half;
  return snapped;
}

/** Drops binary float noise (2.9999999999 → 3) without moving a value off the wall. */
function trimNoise(value: number): number {
  return Math.round(value * 1e9) / 1e9;
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

/**
 * Arrange (#629) zone by zone, so a house with rooms keeps each room's
 * furniture in it: each zone's items (centre inside, the first zone wins on
 * a shared edge) are packed inside that zone, around the locked items and
 * the zones already done; then the items outside every zone are packed into
 * the space the zones leave. Without zones it is plain `autoOrganize`. The
 * result keeps the input order.
 */
export function arrangeByZone(
  items: readonly FurnitureItem[],
  roomWidth: number,
  roomDepth: number,
  strategy: AutoOrganizeStrategy,
  options: { zones?: readonly ZoneRect[] | undefined; context?: CollisionContext; margin?: number }
): FurnitureItem[] {
  const zones = options.zones ?? [];
  const shared = {
    ...(options.context ? { context: options.context } : {}),
    ...(options.margin !== undefined ? { margin: options.margin } : {}),
  };
  if (zones.length === 0) return autoOrganize(items, roomWidth, roomDepth, strategy, shared);

  const locked = items.filter((item) => item.locked);
  let rest = items.filter((item) => !item.locked);
  const arranged: FurnitureItem[] = [];
  for (const zone of zones) {
    const inside = itemsInZone(zone, rest);
    if (inside.length === 0) continue;
    rest = rest.filter((item) => !inside.includes(item));
    const bounds = { x0: zone.x, x1: zone.x + zone.w, z0: zone.z, z1: zone.z + zone.d };
    arranged.push(
      ...autoOrganize(inside, roomWidth, roomDepth, strategy, { ...shared, bounds, obstacles: [...locked, ...arranged] })
    );
  }
  if (rest.length > 0) {
    const zoneRects = zones.map((zone) => ({ x0: zone.x, x1: zone.x + zone.w, z0: zone.z, z1: zone.z + zone.d }));
    const context = { ...options.context, keepOut: [...(options.context?.keepOut ?? []), ...zoneRects] };
    arranged.push(
      ...autoOrganize(rest, roomWidth, roomDepth, strategy, { ...shared, context, obstacles: [...locked, ...arranged] })
    );
  }
  const byId = new Map(arranged.map((item) => [item.id, item]));
  return items.map((item) => byId.get(item.id) ?? item);
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
