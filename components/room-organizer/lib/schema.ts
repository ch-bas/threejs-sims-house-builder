import { MAX_FLOORS, MAX_ITEM_DIMENSION, MAX_ROOM_DIMENSION } from './constants';
import { MAX_DORMERS, isDormerSpec } from './dormers';
import { NEIGHBOUR_FLAGS, isStreetSeed, isTerrainY } from './site';
import { isStairsLeadIn, isStairsShape } from './stairs';
import { isStoreyHeight } from './storeys';
import { ENTRANCE_DOOR_ID, ENTRANCE_WALL_ID, isEntranceSpec, isSillHeight } from './street';
import { MAX_ZONES, isRoomZone } from './zones';
import type {
  DormerOpening,
  DormerSpec,
  EntranceSpec,
  FloorLayout,
  FloorPattern,
  FloorPlanFitMode,
  FurnitureItem,
  InteriorWall,
  NeighbourFlag,
  RoofSpec,
  RoofStyle,
  RoomLayout,
  RoomZone,
  SofaShape,
  TerrainSpec,
  WallId,
  WallPattern,
} from './types';

/*
 * Caps on what a stored, imported or shared layout may carry (#332, #350).
 * They bound what a crafted file or link can make the tab hold, render and
 * re-save. They REPAIR, never refuse: parseStoredLayout truncates, clamps
 * and slices to them, because a save from an older version (or an edit the
 * reducer let through) that broke a cap must still open — a refused main
 * save is replaced by the default house on the next autosave. The reducer
 * applies the same caps, so its output always parses unchanged.
 */
/** House, floor, item and zone names. */
export const MAX_NAME_LENGTH = 200;
/** Ids, group ids, item types and CCTV model ids. */
export const MAX_ID_LENGTH = 128;
/** Any colour string: `#rrggbb` in practice, room for a CSS colour name. */
export const MAX_COLOR_LENGTH = 64;
/** An item's emoji icon (multi-code-point sequences included). */
export const MAX_ICON_LENGTH = 32;
export const MAX_ITEMS_PER_FLOOR = 2000;
export const MAX_INTERIOR_WALLS_PER_FLOOR = 1000;
/**
 * Item positions and wall ends, in metres from the room centre. The largest
 * room's lot reaches ±306 m (`outdoorGroundSize`), and a drag ray can land
 * beyond it, so this leaves room for both. `1e300` used to pass and turned
 * the camera fit and every matrix non-finite (#350).
 */
export const MAX_COORDINATE = 10 * MAX_ROOM_DIMENSION;
/**
 * Largest layout JSON the app will read, in bytes — a share link's inflated
 * payload or an imported file (#332). The biggest house the editor can save
 * (localStorage holds ~5 M characters, floor plan included) fits with room
 * to spare; a deflate bomb is cut off here instead of filling the tab.
 */
export const MAX_LAYOUT_JSON_BYTES = 8 * 1024 * 1024;

const WALL_IDS: readonly WallId[] = ['north', 'south', 'east', 'west'];

const FIT_MODES: readonly FloorPlanFitMode[] = ['stretch', 'cover', 'contain'];
const FLOOR_PATTERNS: readonly FloorPattern[] = ['solid', 'wood', 'tile', 'carpet', 'concrete'];
const WALL_PATTERNS: readonly WallPattern[] = [
  'solid',
  'brick',
  'wallpaper',
  'panel',
  'plaster',
  'siding',
];
const ROOF_STYLES: readonly RoofStyle[] = ['none', 'flat', 'gable', 'hipped'];
const SOFA_SHAPES: readonly SofaShape[] = ['standard', 'L-shape', 'U-shape'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/**
 * A room dimension must be finite AND strictly positive (0/negative break
 * PlaneGeometry, fitTextureToRoom, and collision math) and sanely bounded so a
 * corrupt value can't blow up the geometry.
 */
function isRoomDimension(value: unknown): value is number {
  return isPositiveNumber(value) && value <= MAX_ROOM_DIMENSION;
}

/**
 * Item dims need an upper bound too: room dims are capped at 100 but a
 * crafted item `width: 1e12` passed a bare positivity check and destroyed
 * the scene scale (#121).
 */
function isItemDimension(value: unknown): value is number {
  return isPositiveNumber(value) && value <= MAX_ITEM_DIMENSION;
}

function isOptionalPositiveNumber(value: unknown): boolean {
  return value === undefined || isPositiveNumber(value);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

/**
 * A floor-plan image flows straight into `new THREE.TextureLoader().load(url)`
 * in three/room-builder.ts. A poisoned localStorage entry or imported JSON
 * could point it at `http://attacker/beacon.png`, firing an outbound request on
 * load. Only accept inline `data:image/...` URLs so nothing can trigger a
 * network fetch.
 */
function isDataImageUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\//.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isVec2(value: unknown): boolean {
  return isPlainObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.z);
}

export function isFurnitureItem(value: unknown): value is FurnitureItem {
  if (!isPlainObject(value)) return false;
  const v = value;
  if (
    typeof v.id !== 'string' ||
    typeof v.type !== 'string' ||
    typeof v.name !== 'string' ||
    !isItemDimension(v.width) ||
    !isItemDimension(v.depth) ||
    !isItemDimension(v.height) ||
    typeof v.color !== 'string' ||
    typeof v.icon !== 'string'
  ) {
    return false;
  }
  if (v.price !== undefined && !isFiniteNumber(v.price)) return false;
  if (!isOptionalString(v.category)) return false;
  if (v.position !== undefined && !isVec2(v.position)) return false;
  if (v.rotation !== undefined && !isFiniteNumber(v.rotation)) return false;
  // Ranges must be positive: negative signal/vision values invert ring and
  // cone geometry (#121). FOV additionally caps at a full circle.
  if (!isOptionalPositiveNumber(v.signalRange)) return false;
  if (!isOptionalPositiveNumber(v.visionRange)) return false;
  if (v.visionFov !== undefined && (!isPositiveNumber(v.visionFov) || v.visionFov > 360)) return false;
  if (v.wallRotation !== undefined && !isFiniteNumber(v.wallRotation)) return false;
  // Sill height places the window hole in the wall (#204).
  if (v.sillHeight !== undefined && !isSillHeight(v.sillHeight)) return false;
  // Enum-ish fields ingested from external data must match their unions —
  // an unknown sofaShape reaches builder switch statements unchecked (#121).
  // cctvModelId only needs to be a string: unknown ids fall back to the
  // default model at lookup time. The retired `stairsDirection` is not
  // checked at all — parseStoredLayout strips it (#410).
  if (v.sofaShape !== undefined && !SOFA_SHAPES.includes(v.sofaShape as SofaShape)) return false;
  if (v.stairsShape !== undefined && !isStairsShape(v.stairsShape)) return false;
  if (v.stairsLeadIn !== undefined && !isStairsLeadIn(v.stairsLeadIn)) return false;
  if (!isOptionalString(v.cctvModelId)) return false;
  // A group id only ever compares equal to other items' ids (#154): any
  // non-empty string is a valid group, anything else is corruption.
  if (v.groupId !== undefined && (typeof v.groupId !== 'string' || v.groupId === '')) return false;
  // Booleans must be real booleans: a corrupt `locked:"no"` reads truthy for
  // keyboard-delete guards yet fails `=== true` drag checks, desyncing the two.
  if (!isOptionalBoolean(v.locked)) return false;
  if (!isOptionalBoolean(v.mirrored)) return false;
  if (!isOptionalBoolean(v.cameraBracket)) return false;
  if (!isOptionalBoolean(v.isCCTV)) return false;
  if (!isOptionalBoolean(v.isWiFiAccessPoint)) return false;
  if (!isOptionalBoolean(v.hasVisionCone)) return false;
  return true;
}

export function isFloorLayout(value: unknown): value is FloorLayout {
  if (!isPlainObject(value)) return false;
  const v = value;
  if (typeof v.id !== 'string') return false;
  if (typeof v.name !== 'string') return false;
  if (typeof v.floorColor !== 'string') return false;
  if (!isItemList(v.items)) return false;
  // Patterns must match their unions, not just be strings: an unknown key
  // reaches `PATTERNS[pattern].draw(...)` in the texture builders and throws
  // on every scene build — and because the layout would keep validating, it
  // would keep autosaving and crash every subsequent mount too (#208). Same
  // class as the sofaShape check above (#121).
  if (v.floorPattern !== undefined && !FLOOR_PATTERNS.includes(v.floorPattern as FloorPattern)) {
    return false;
  }
  if (v.wallPattern !== undefined && !WALL_PATTERNS.includes(v.wallPattern as WallPattern)) {
    return false;
  }
  // Keys other than the four walls, and unknown or repeated hidden walls,
  // are dropped by parseStoredLayout rather than refused (#350).
  if (v.wallColors !== undefined && !isWallColors(v.wallColors)) return false;
  if (v.hiddenWalls !== undefined) {
    if (!Array.isArray(v.hiddenWalls)) return false;
    if (!v.hiddenWalls.every((wall) => typeof wall === 'string')) return false;
  }
  if (v.interiorWalls !== undefined) {
    if (!Array.isArray(v.interiorWalls)) return false;
    for (const wall of v.interiorWalls) {
      if (!isPlainObject(wall)) return false;
      if (
        typeof wall.id !== 'string' ||
        !isFiniteNumber(wall.x1) ||
        !isFiniteNumber(wall.z1) ||
        !isFiniteNumber(wall.x2) ||
        !isFiniteNumber(wall.z2)
      ) {
        return false;
      }
      if (!isOptionalString(wall.color)) return false;
    }
  }
  // Storey height feeds every floor's elevation and the roof base: a zero,
  // negative or absurd value collapses or launches the whole stack (#202).
  if (v.height !== undefined && !isStoreyHeight(v.height)) return false;
  // Zone rectangles are painted and measured as-is: a NaN corner or a
  // negative size must not reach the renderer or the stats (#155).
  if (v.zones !== undefined) {
    if (!Array.isArray(v.zones)) return false;
    if (!v.zones.every(isRoomZone)) return false;
  }
  return true;
}

function isItemList(value: unknown): value is FurnitureItem[] {
  return Array.isArray(value) && value.every(isFurnitureItem);
}

function isWallColors(value: unknown): value is Record<string, string> {
  return (
    isPlainObject(value) && Object.values(value).every((color) => typeof color === 'string')
  );
}

export function isRoomLayout(value: unknown): value is RoomLayout {
  if (!isPlainObject(value)) return false;
  const v = value;

  if (typeof v.name !== 'string') return false;
  if (!isOptionalString(v.id)) return false;
  if (!isRoomDimension(v.width)) return false;
  if (!isRoomDimension(v.height)) return false;
  if (
    !Array.isArray(v.floors) ||
    v.floors.length === 0 ||
    v.floors.length > MAX_FLOORS ||
    !v.floors.every(isFloorLayout)
  ) {
    return false;
  }

  if (v.floorPlanImage !== undefined && !isDataImageUrl(v.floorPlanImage)) return false;
  // Opacity outside [0,1] is corruption, not preference — the UI slider only
  // produces this range and canvas globalAlpha silently misbehaves outside it.
  if (
    v.floorPlanOpacity !== undefined &&
    (!isFiniteNumber(v.floorPlanOpacity) || v.floorPlanOpacity < 0 || v.floorPlanOpacity > 1)
  ) {
    return false;
  }
  if (
    v.floorPlanFitMode !== undefined &&
    !FIT_MODES.includes(v.floorPlanFitMode as FloorPlanFitMode)
  ) {
    return false;
  }

  if (v.roof !== undefined) {
    if (!isPlainObject(v.roof)) return false;
    const roof = v.roof;
    if (!ROOF_STYLES.includes(roof.style as RoofStyle)) return false;
    if (!isOptionalString(roof.color)) return false;
    // Dormer numbers size real geometry on the roof; an absurd width or a
    // non-finite offset must not reach the builder (#203).
    if (roof.dormers !== undefined) {
      if (!Array.isArray(roof.dormers) || roof.dormers.length > MAX_DORMERS) return false;
      if (!roof.dormers.every(isDormerSpec)) return false;
    }
  }

  // Terrain heights place the whole outdoor scene and the plinth depth; a
  // non-finite or absurd value would sink or launch the lot (#202).
  if (v.terrain !== undefined) {
    if (!isPlainObject(v.terrain)) return false;
    if (!isTerrainY(v.terrain.frontY) || !isTerrainY(v.terrain.backY)) return false;
  }
  if (v.entrance !== undefined && !isEntranceSpec(v.entrance)) return false;
  if (v.frontage !== undefined && v.frontage !== 'garden' && v.frontage !== 'pavement') return false;
  // The street's houses are generated from these (#310): an unknown flag or
  // a non-integer seed must not reach the generator.
  if (v.neighbours !== undefined) {
    if (!isPlainObject(v.neighbours)) return false;
    for (const [key, value] of Object.entries(v.neighbours)) {
      if (key === 'seed') {
        if (!isStreetSeed(value)) return false;
      } else if (!NEIGHBOUR_FLAGS.includes(key as NeighbourFlag) || typeof value !== 'boolean') {
        return false;
      }
    }
  }

  return true;
}

/**
 * Accepts either the current multi-floor shape or the legacy single-floor
 * shape (with top-level `items` / `floorColor` / `wallColors` / etc.) and
 * normalises both to the current `RoomLayout` shape. Returns `null` if the
 * input matches neither.
 *
 * The result holds only the fields the app knows (#350), within the caps
 * above, with unique ids (#338). Only a structurally invalid value is
 * refused; anything over a cap is repaired. An input that already is
 * exactly that comes back as-is.
 */
export function parseStoredLayout(value: unknown): RoomLayout | null {
  const layout = isRoomLayout(value)
    ? value
    : isLegacySingleFloorLayout(value)
      ? migrateLegacyLayout(value)
      : null;
  return layout && withUniqueIds(repairLayout(layout));
}

/*
 * Whitelists (#350). Every object in a parsed layout is rebuilt from these,
 * so unknown keys — `bloat`, an own `__proto__`, fields nothing reads any
 * more like the retired `stairsDirection` (#410) — stop riding along in
 * every save and share link. Each list is a full `Record` of its type's
 * keys, so a field added to the type without being listed here fails to
 * compile instead of being silently dropped on load.
 */
function keysOf<T>(keys: Record<keyof T, true>): readonly string[] {
  return Object.keys(keys);
}

const LAYOUT_KEYS = keysOf<RoomLayout>({
  id: true,
  name: true,
  width: true,
  height: true,
  floors: true,
  roof: true,
  floorPlanImage: true,
  floorPlanOpacity: true,
  floorPlanFitMode: true,
  terrain: true,
  neighbours: true,
  entrance: true,
  frontage: true,
});
const FLOOR_KEYS = keysOf<FloorLayout>({
  id: true,
  name: true,
  items: true,
  floorColor: true,
  floorPattern: true,
  wallPattern: true,
  wallColors: true,
  hiddenWalls: true,
  interiorWalls: true,
  zones: true,
  height: true,
});
const ITEM_KEYS = keysOf<FurnitureItem>({
  id: true,
  type: true,
  name: true,
  width: true,
  depth: true,
  height: true,
  color: true,
  icon: true,
  price: true,
  category: true,
  position: true,
  rotation: true,
  isWiFiAccessPoint: true,
  isCCTV: true,
  signalRange: true,
  hasVisionCone: true,
  visionRange: true,
  visionFov: true,
  cctvModelId: true,
  wallRotation: true,
  cameraBracket: true,
  sofaShape: true,
  locked: true,
  mirrored: true,
  stairsShape: true,
  stairsLeadIn: true,
  sillHeight: true,
  groupId: true,
});
const VEC2_KEYS = ['x', 'z'] as const;
const WALL_KEYS = keysOf<InteriorWall>({ id: true, x1: true, z1: true, x2: true, z2: true, color: true });
const ZONE_KEYS = keysOf<RoomZone>({ id: true, name: true, color: true, x: true, z: true, w: true, d: true });
const ROOF_KEYS = keysOf<RoofSpec>({ style: true, color: true, dormers: true });
const DORMER_KEYS = keysOf<DormerSpec>({
  id: true,
  side: true,
  width: true,
  offset: true,
  height: true,
  setback: true,
  openings: true,
  window: true,
  balcony: true,
  color: true,
});
const OPENING_KEYS = keysOf<DormerOpening>({ kind: true, from: true, to: true });
const TERRAIN_KEYS = keysOf<TerrainSpec>({ frontY: true, backY: true });
const ENTRANCE_KEYS = keysOf<EntranceSpec>({ width: true, depth: true, offset: true, height: true, door: true });

/** `value` itself when it has no other own keys; otherwise a copy holding only `keys`. */
function pick<T extends object>(value: T, keys: readonly string[]): T {
  if (Object.keys(value).every((key) => keys.includes(key))) return value;
  const source = value as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) copy[key] = source[key];
  }
  return copy as T;
}

/** `list.map(fn)`, or `list` itself when `fn` changed nothing (copy-on-write). */
function mapSame<T>(list: T[], fn: (entry: T) => T): T[] {
  let changed = false;
  const next = list.map((entry) => {
    const mapped = fn(entry);
    if (mapped !== entry) changed = true;
    return mapped;
  });
  return changed ? next : list;
}

/** `pick`, then overwrite the fields `patch` cleaned; `value` itself when nothing changed. */
function rebuild<T extends object>(value: T, keys: readonly string[], patch: Partial<T>): T {
  const picked = pick(value, keys);
  const changed = (Object.keys(patch) as (keyof T)[]).filter((key) => patch[key] !== picked[key]);
  if (changed.length === 0) return picked;
  return { ...picked, ...patch };
}

/** `text` cut to `max` UTF-16 units, never leaving half a surrogate pair. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export function clampCoordinate(value: number): number {
  return Math.min(MAX_COORDINATE, Math.max(-MAX_COORDINATE, value));
}

/** The first `max` entries; `list` itself when it already fits. */
function sliceTo<T>(list: T[], max: number): T[] {
  return list.length <= max ? list : list.slice(0, max);
}

/**
 * Cut a floor's list to its cap while always keeping the porch entry
 * (`keep`): the porch door and back wall are added by the entrance re-fit
 * after everything else, so a plain slice dropped them on every reload of a
 * full floor. Other entries get `max - 1` — the slot the reducer keeps free
 * for the porch (#332). Returns the input when nothing is cut.
 */
function capKeeping<T extends { id: string }>(list: T[], max: number, keep: string): T[] {
  if (list.length < max) return list;
  let porchKept = false;
  let others = 0;
  const kept = list.filter((entry) => {
    if (entry.id === keep && !porchKept) {
      porchKept = true;
      return true;
    }
    if (others >= max - 1) return false;
    others += 1;
    return true;
  });
  return kept.length === list.length ? list : kept;
}

function repairVec2(vec: { x: number; z: number }): { x: number; z: number } {
  const picked = pick(vec, VEC2_KEYS);
  const x = clampCoordinate(picked.x);
  const z = clampCoordinate(picked.z);
  return x === picked.x && z === picked.z ? picked : { x, z };
}

function repairItem(item: FurnitureItem): FurnitureItem {
  const patch: Partial<FurnitureItem> = {
    id: capText(item.id, MAX_ID_LENGTH),
    type: capText(item.type, MAX_ID_LENGTH),
    name: capText(item.name, MAX_NAME_LENGTH),
    color: capText(item.color, MAX_COLOR_LENGTH),
    icon: capText(item.icon, MAX_ICON_LENGTH),
  };
  if (item.cctvModelId !== undefined) patch.cctvModelId = capText(item.cctvModelId, MAX_ID_LENGTH);
  if (item.groupId !== undefined) patch.groupId = capText(item.groupId, MAX_ID_LENGTH);
  // A negative price turns the budget and every cost total upside down (#350).
  if (item.price !== undefined && item.price < 0) patch.price = 0;
  if (item.position) patch.position = repairVec2(item.position);
  return rebuild(item, ITEM_KEYS, patch);
}

function repairWall(wall: InteriorWall): InteriorWall {
  const patch: Partial<InteriorWall> = {
    id: capText(wall.id, MAX_ID_LENGTH),
    x1: clampCoordinate(wall.x1),
    z1: clampCoordinate(wall.z1),
    x2: clampCoordinate(wall.x2),
    z2: clampCoordinate(wall.z2),
  };
  if (wall.color !== undefined) patch.color = capText(wall.color, MAX_COLOR_LENGTH);
  return rebuild(wall, WALL_KEYS, patch);
}

function repairFloor(floor: FloorLayout): FloorLayout {
  const patch: Partial<FloorLayout> = {
    id: capText(floor.id, MAX_ID_LENGTH),
    name: capText(floor.name, MAX_NAME_LENGTH),
    floorColor: capText(floor.floorColor, MAX_COLOR_LENGTH),
    items: mapSame(capKeeping(floor.items, MAX_ITEMS_PER_FLOOR, ENTRANCE_DOOR_ID), repairItem),
  };
  if (floor.wallColors) {
    const all = floor.wallColors;
    const colors = Object.entries(all).filter(([wall]) => WALL_IDS.includes(wall as WallId));
    const clean = colors.every(([, color]) => color.length <= MAX_COLOR_LENGTH);
    patch.wallColors =
      clean && colors.length === Object.keys(all).length
        ? all
        : Object.fromEntries(colors.map(([wall, color]) => [wall, capText(color, MAX_COLOR_LENGTH)]));
  }
  if (floor.hiddenWalls) {
    const all = floor.hiddenWalls;
    const clean = all.filter((wall, index) => WALL_IDS.includes(wall) && all.indexOf(wall) === index);
    patch.hiddenWalls = clean.length === all.length ? all : clean;
  }
  if (floor.interiorWalls) {
    // A zero-length wall has no direction to build, cut or snap to (#350).
    const repaired = mapSame(floor.interiorWalls, repairWall);
    const walls = repaired.filter((wall) => wall.x1 !== wall.x2 || wall.z1 !== wall.z2);
    patch.interiorWalls = capKeeping(
      walls.length === repaired.length ? repaired : walls,
      MAX_INTERIOR_WALLS_PER_FLOOR,
      ENTRANCE_WALL_ID
    );
  }
  if (floor.zones) {
    patch.zones = mapSame(sliceTo(floor.zones, MAX_ZONES), (zone) =>
      rebuild(zone, ZONE_KEYS, {
        id: capText(zone.id, MAX_ID_LENGTH),
        name: capText(zone.name, MAX_NAME_LENGTH),
        color: capText(zone.color, MAX_COLOR_LENGTH),
      })
    );
  }
  return rebuild(floor, FLOOR_KEYS, patch);
}

function repairRoof(roof: RoofSpec): RoofSpec {
  const patch: Partial<RoofSpec> = {};
  if (roof.color !== undefined) patch.color = capText(roof.color, MAX_COLOR_LENGTH);
  if (roof.dormers) {
    patch.dormers = mapSame(roof.dormers, (dormer) => {
      const fields: Partial<DormerSpec> = { id: capText(dormer.id, MAX_ID_LENGTH) };
      if (dormer.color !== undefined) fields.color = capText(dormer.color, MAX_COLOR_LENGTH);
      if (dormer.openings) {
        fields.openings = mapSame(dormer.openings, (opening) => pick(opening, OPENING_KEYS));
      }
      return rebuild(dormer, DORMER_KEYS, fields);
    });
  }
  return rebuild(roof, ROOF_KEYS, patch);
}

/** Whitelist every object (#350) and bring every field within the caps above. */
function repairLayout(layout: RoomLayout): RoomLayout {
  const patch: Partial<RoomLayout> = {
    name: capText(layout.name, MAX_NAME_LENGTH),
    floors: mapSame(layout.floors, repairFloor),
  };
  if (layout.id !== undefined) patch.id = capText(layout.id, MAX_ID_LENGTH);
  if (layout.roof) patch.roof = repairRoof(layout.roof);
  if (layout.terrain) patch.terrain = pick(layout.terrain, TERRAIN_KEYS);
  if (layout.entrance) patch.entrance = pick(layout.entrance, ENTRANCE_KEYS);
  return rebuild(layout, LAYOUT_KEYS, patch);
}

/**
 * Ids are the only handle the reducer has on an item, a floor, a wall or a
 * zone: two items sharing one recolour, delete and drag together (#338). A
 * repeat gets the first free `-2`, `-3`… suffix instead of failing the
 * file. The porch door and the porch's back wall are singletons the
 * reducer re-fits by id, so every copy after the first in the building is
 * dropped.
 */
function withUniqueIds(layout: RoomLayout): RoomLayout {
  const keepFirst = new Set<string>();
  const dropRepeats = <T extends { id: string }>(list: T[], singleton: string): T[] => {
    const kept = list.filter((entry) => {
      if (entry.id !== singleton) return true;
      if (keepFirst.has(singleton)) return false;
      keepFirst.add(singleton);
      return true;
    });
    return kept.length === list.length ? list : kept;
  };
  const floors = mapSame(layout.floors, (floor) => {
    const items = uniqueIds(dropRepeats(floor.items, ENTRANCE_DOOR_ID));
    const walls = floor.interiorWalls && uniqueIds(dropRepeats(floor.interiorWalls, ENTRANCE_WALL_ID));
    const zones = floor.zones && uniqueIds(floor.zones);
    if (items === floor.items && walls === floor.interiorWalls && zones === floor.zones) return floor;
    return { ...floor, items, ...(walls ? { interiorWalls: walls } : {}), ...(zones ? { zones } : {}) };
  });
  const unique = uniqueIds(floors);
  // Dormers are edited and removed by id too (#338).
  const dormers = layout.roof?.dormers && uniqueIds(layout.roof.dormers);
  const roof = layout.roof && dormers && dormers !== layout.roof.dormers ? { ...layout.roof, dormers } : layout.roof;
  if (unique === layout.floors && roof === layout.roof) return layout;
  return { ...layout, floors: unique, ...(roof ? { roof } : {}) };
}

/** `list` itself when its ids are already unique. */
function uniqueIds<T extends { id: string }>(list: T[]): T[] {
  const taken = new Set(list.map((entry) => entry.id));
  if (taken.size === list.length) return list;
  const seen = new Set<string>();
  return list.map((entry) => {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      return entry;
    }
    let id = entry.id;
    for (let n = 2; taken.has(id); n++) {
      const suffix = `-${n}`;
      // Stay under the id cap, or the next load would refuse the house.
      id = `${entry.id.slice(0, MAX_ID_LENGTH - suffix.length)}${suffix}`;
    }
    taken.add(id);
    seen.add(id);
    return { ...entry, id };
  });
}

interface LegacySingleFloorLayout {
  id?: string;
  name: string;
  width: number;
  height: number;
  items: FurnitureItem[];
  floorColor: string;
  floorPattern?: string;
  wallPattern?: string;
  wallColors?: Record<string, string>;
  floorPlanImage?: string;
  floorPlanOpacity?: number;
  floorPlanFitMode?: FloorPlanFitMode;
}

function isLegacySingleFloorLayout(value: unknown): value is LegacySingleFloorLayout {
  if (!isPlainObject(value)) return false;
  const v = value;
  return (
    typeof v.name === 'string' &&
    isOptionalString(v.id) &&
    isRoomDimension(v.width) &&
    isRoomDimension(v.height) &&
    typeof v.floorColor === 'string' &&
    isItemList(v.items) &&
    (v.wallColors === undefined || isWallColors(v.wallColors)) &&
    !('floors' in v)
  );
}

function migrateLegacyLayout(legacy: LegacySingleFloorLayout): RoomLayout {
  const groundFloor: FloorLayout = {
    id: 'ground',
    name: 'Ground Floor',
    items: legacy.items,
    floorColor: legacy.floorColor,
    // Only carry patterns the current schema would accept: an unknown value
    // copied verbatim would fail `isRoomLayout` on the NEXT load, turning a
    // recoverable legacy save into an unreadable one (#208).
    ...(legacy.floorPattern && FLOOR_PATTERNS.includes(legacy.floorPattern as FloorPattern)
      ? { floorPattern: legacy.floorPattern as FloorPattern }
      : {}),
    ...(legacy.wallPattern && WALL_PATTERNS.includes(legacy.wallPattern as WallPattern)
      ? { wallPattern: legacy.wallPattern as WallPattern }
      : {}),
    ...(legacy.wallColors ? { wallColors: legacy.wallColors } : {}),
  };

  const layout: RoomLayout = {
    name: legacy.name,
    width: legacy.width,
    height: legacy.height,
    floors: [groundFloor],
  };
  if (legacy.id !== undefined) layout.id = legacy.id;
  // Non-destructive: keep migrating the rest of the layout even if the stored
  // floor plan isn't a safe inline data URL — just drop the image so we never
  // hand a network URL to the texture loader.
  if (isDataImageUrl(legacy.floorPlanImage)) layout.floorPlanImage = legacy.floorPlanImage;
  // Same non-destructive rule for the other floor-plan fields: the legacy
  // shape check doesn't validate them, and a value `isRoomLayout` rejects
  // would brick the migrated save on its second load (#208). Clamp opacity
  // into the accepted [0,1]; drop anything else invalid.
  if (isFiniteNumber(legacy.floorPlanOpacity)) {
    layout.floorPlanOpacity = Math.min(1, Math.max(0, legacy.floorPlanOpacity));
  }
  if (
    legacy.floorPlanFitMode !== undefined &&
    FIT_MODES.includes(legacy.floorPlanFitMode as FloorPlanFitMode)
  ) {
    layout.floorPlanFitMode = legacy.floorPlanFitMode;
  }
  return layout;
}

/**
 * How many items, interior walls and zones a stored layout holds, read from
 * raw JSON in either the current or the legacy single-floor shape. Compared
 * before and after parsing, it tells whether the repair cut anything (#332).
 */
export function storedEntryCount(value: unknown): number {
  if (!isPlainObject(value)) return 0;
  const length = (list: unknown): number => (Array.isArray(list) ? list.length : 0);
  if (!Array.isArray(value.floors)) return length(value.items) + length(value.interiorWalls);
  let count = 0;
  for (const floor of value.floors as unknown[]) {
    if (!isPlainObject(floor)) continue;
    count += length(floor.items) + length(floor.interiorWalls) + length(floor.zones);
  }
  return count;
}
