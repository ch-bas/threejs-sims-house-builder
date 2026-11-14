import { floorKeepOut } from './floor-keep-out';
import { footprintArea, hasCollisions } from './geometry';
import { isNightLit } from './night-lights';
import { storeyHeight } from './storeys';
import { entrancePlanOutline } from './street';
import { itemsInZone, zoneArea, zoneRings, type ZoneShape } from './zones';
import type { FloorLayout, FurnitureItem, RoomLayout, RoomZone, Vec2 } from './types';

/*
 * What a zone is for, and how nice it is (#613). Pure: the Statistics panel
 * shows it, and nothing is stored. A zone's type comes from the furniture
 * standing in it (centre inside, as `itemsInZone`); its score is one star per
 * check met, out of ROOM_CHECKS.length.
 */

export type RoomType = 'bathroom' | 'kitchen' | 'bedroom' | 'living' | 'dining' | 'study';

export const ROOM_TYPE_LABELS: Readonly<Record<RoomType, string>> = {
  bathroom: 'Bathroom',
  kitchen: 'Kitchen',
  bedroom: 'Bedroom',
  living: 'Living room',
  dining: 'Dining room',
  study: 'Study',
};

/**
 * First match wins, so a bedroom with a desk is a bedroom and a kitchen with
 * a dining table a kitchen. Each rule lists what the room needs: every group,
 * and any one type out of each group.
 */
const ROOM_RULES: ReadonlyArray<{ type: RoomType; needs: ReadonlyArray<readonly string[]> }> = [
  { type: 'bathroom', needs: [['toilet'], ['bathroom-sink']] },
  { type: 'kitchen', needs: [['fridge'], ['stove'], ['counter', 'kitchen-sink']] },
  { type: 'bedroom', needs: [['bed']] },
  { type: 'living', needs: [['sofa']] },
  { type: 'dining', needs: [['dining-table']] },
  { type: 'study', needs: [['desk']] },
];

/** The room the furniture makes, or null when it doesn't make one yet. */
export function classifyRoom(items: readonly Pick<FurnitureItem, 'type'>[]): RoomType | null {
  const types = new Set(items.map((item) => item.type));
  const rule = ROOM_RULES.find(({ needs }) => needs.every((group) => group.some((type) => types.has(type))));
  return rule?.type ?? null;
}

export type RoomCheckKey = 'decor' | 'window' | 'lamp' | 'clear' | 'space';

/** The checks a room is scored on, one star each, with what the player is told it wants ("For more stars: …"). */
export const ROOM_CHECKS: ReadonlyArray<{ key: RoomCheckKey; label: string }> = [
  { key: 'decor', label: 'more decor (a piece per 10 m²)' },
  { key: 'window', label: 'a window on its walls' },
  { key: 'lamp', label: 'a lamp for the night' },
  { key: 'clear', label: 'no collisions' },
  { key: 'space', label: 'furniture under 70% of the floor' },
];

/** Floor per piece of decor the decor check asks for. */
export const DECOR_AREA_PER_PIECE = 10;
/** Most of a room's floor its furniture may cover and still score. */
export const MAX_ROOM_COVERAGE = 0.7;
/** How far off a zone's edge a window still counts as on that wall: a wall's half-thickness and a hand-drawn zone's slack. */
export const WINDOW_EDGE_REACH = 0.5;

export interface RoomScore {
  type: RoomType | null;
  /** Checks met, 0 to ROOM_CHECKS.length; 0 for a room with no type. */
  stars: number;
  /** The checks not met, in ROOM_CHECKS order; empty for a room with no type. */
  missing: readonly RoomCheckKey[];
}

export interface ScoreZoneInput {
  zone: ZoneShape;
  /** Everything on the zone's storey. */
  floorItems: readonly FurnitureItem[];
  /** The zone's floor, less any porch, in m² (`zoneArea`). */
  area: number;
  /** Whether an item collides where it stands (`hasCollisions` with the storey's context). */
  collides(item: FurnitureItem): boolean;
}

/**
 * Whether `p` lies on one of the zone's own edges: within `reach` of the
 * edge and alongside it, not out past either end. A window past a corner
 * is on the neighbour's wall, however close (holes' edges count too).
 */
export function onZoneEdge(zone: ZoneShape, p: Vec2, reach: number): boolean {
  return zoneRings(zone).some((ring) =>
    ring.some((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length === 0) return false;
      const along = ((p.x - a.x) * dx + (p.z - a.z) * dz) / length;
      const across = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / length;
      return along >= 0 && along <= length && across <= reach;
    })
  );
}

/** The type and score of one zone. A zone the furniture doesn't make a room of isn't scored. */
export function scoreZone({ zone, floorItems, area, collides }: ScoreZoneInput): RoomScore {
  const inside = itemsInZone(zone, floorItems);
  const type = classifyRoom(inside);
  if (type === null) return { type, stars: 0, missing: [] };
  const decor = inside.filter((item) => item.category === 'decor').length;
  const met: Record<RoomCheckKey, boolean> = {
    decor: decor >= Math.max(1, Math.ceil(area / DECOR_AREA_PER_PIECE)),
    window: floorItems.some(
      (item) => item.type === 'window' && item.position !== undefined && onZoneEdge(zone, item.position, WINDOW_EDGE_REACH)
    ),
    lamp: inside.some((item) => item.category !== 'outdoor' && isNightLit(item.type)),
    clear: !inside.some(collides),
    // A rug lies under the furniture: it takes no room to move.
    space: area > 0 && footprintArea(inside.filter((item) => item.type !== 'rug')) < area * MAX_ROOM_COVERAGE,
  };
  const missing = ROOM_CHECKS.filter((check) => !met[check.key]).map((check) => check.key);
  return { type, stars: ROOM_CHECKS.length - missing.length, missing };
}

export interface HouseRoomScore extends RoomScore {
  floorIndex: number;
  zone: RoomZone;
}

/** A storey's scores, kept while the storey and what its collisions read are unchanged. */
const floorCache = new WeakMap<FloorLayout, { key: string; scores: HouseRoomScore[] }>();

/** What the editor already knows about the active storey's collisions (its `collidingIds`). */
export interface KnownCollisions {
  floorIndex: number;
  ids: ReadonlySet<string>;
}

/**
 * Every zone of the house, typed and scored. Collisions are checked the way
 * the editor checks them (porch, stairwell and cut-out keep-out, interior
 * walls, storey height), but only for the items standing in a zone. The
 * active storey's come from `known`, the set the editor keeps anyway; any
 * other storey costs a collision pass, so one an edit didn't touch is
 * answered from a cache.
 */
export function houseRoomScores(layout: RoomLayout, known?: KnownCollisions): HouseRoomScore[] {
  return layout.floors.flatMap((floor, floorIndex) => {
    const zones = floor.zones ?? [];
    if (zones.length === 0) return [];
    const recess = entrancePlanOutline(layout, floorIndex);
    const score = (collides: (item: FurnitureItem) => boolean): HouseRoomScore[] =>
      zones.map((zone) => ({
        floorIndex,
        zone,
        ...scoreZone({ zone, floorItems: floor.items, area: zoneArea(zone, recess), collides }),
      }));
    if (known?.floorIndex === floorIndex) return score((item) => known.ids.has(item.id));
    const keepOut = floorKeepOut(layout, floorIndex);
    const key = JSON.stringify([floorIndex, layout.width, layout.height, keepOut, recess]);
    const cached = floorCache.get(floor);
    if (cached?.key === key) return cached.scores;
    const context = { keepOut, interiorWalls: floor.interiorWalls, storeyHeight: storeyHeight(floor) };
    const scores = score((item) => hasCollisions(item, floor.items, layout.width, layout.height, context));
    floorCache.set(floor, { key, scores });
    return scores;
  });
}
