import { WINDOW_SILL_HEIGHT } from './constants';
import { toCentimetre } from './dormers';
import { groundHeightAt } from './site';
import { floorElevation, storeyHeight } from './storeys';
import type { EntranceSpec, FloorLayout, FurnitureItem, TerrainSpec } from './types';

/**
 * The street face of the house (#204): per-window sill heights, a recessed
 * entrance porch, and pavement frontage. Pure, so the builders and the
 * reducer share one set of numbers.
 */

// ---------------------------------------------------------------------------
// Window sills
// ---------------------------------------------------------------------------

export const MIN_SILL_HEIGHT = 0;
export const MAX_SILL_HEIGHT = 2.5;

/**
 * A window's sill height above its floor: its own `sillHeight`, else the
 * shared datum (#212). The wall cuts and the window mesh all read this, so
 * hole and frame stay flush whatever the sill.
 */
export function windowSillHeight(item: Pick<FurnitureItem, 'sillHeight'>): number {
  return item.sillHeight ?? WINDOW_SILL_HEIGHT;
}

export function isSillHeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_SILL_HEIGHT && value <= MAX_SILL_HEIGHT;
}

// ---------------------------------------------------------------------------
// Recessed entrance
// ---------------------------------------------------------------------------

export const ENTRANCE_LIMITS = {
  width: [0.9, 4],
  depth: [0.3, 3],
  height: [2, 4],
  offset: [-50, 50],
} as const;
export const DEFAULT_ENTRANCE: EntranceSpec = { width: 1.4, depth: 1.2 };
const DEFAULT_ENTRANCE_HEIGHT = 2.4;
/** The recess keeps this much front wall either side, and this much house behind it. */
const MIN_PIER = 0.3;
const MIN_HOUSE_BEHIND = 1;
/** A porch lower than this isn't a doorway. */
const MIN_PORCH_HEIGHT = 1.8;
const STEP_RISE = 0.18;
const STEP_GOING = 0.28;
/**
 * A storey floor this close to the street hosts the porch even when it is
 * a little below it — a kerb or threshold step down — rather than sending
 * the entrance a whole storey up the steps (#274).
 */
export const STREET_TOLERANCE = 0.25;

/** The interior wall across the back of the recess, and the door on it. */
export const ENTRANCE_WALL_ID = 'entrance-back';
export const ENTRANCE_DOOR_ID = 'entrance-door';

export function isEntranceSpec(value: unknown): value is EntranceSpec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const within = (key: keyof typeof ENTRANCE_LIMITS, optional: boolean) => {
    const n = v[key];
    if (n === undefined) return optional;
    const [min, max] = ENTRANCE_LIMITS[key];
    return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  };
  if (v.door !== undefined && v.door !== false) return false;
  return within('width', false) && within('depth', false) && within('height', true) && within('offset', true);
}

export function clampEntrance(entrance: EntranceSpec): EntranceSpec {
  const clamp = (key: keyof typeof ENTRANCE_LIMITS, value: number, fallback: number) => {
    const [min, max] = ENTRANCE_LIMITS[key];
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  const next: EntranceSpec = {
    width: clamp('width', entrance.width, DEFAULT_ENTRANCE.width),
    depth: clamp('depth', entrance.depth, DEFAULT_ENTRANCE.depth),
  };
  if (entrance.offset !== undefined) next.offset = clamp('offset', entrance.offset, 0);
  if (entrance.height !== undefined) next.height = clamp('height', entrance.height, DEFAULT_ENTRANCE_HEIGHT);
  if (entrance.door === false) next.door = false;
  return next;
}

/** Field-by-field equality, so a re-typed value can keep state identity (#279). */
export function sameEntrance(a: EntranceSpec, b: EntranceSpec): boolean {
  return a.width === b.width && a.depth === b.depth && a.offset === b.offset && a.height === b.height && a.door === b.door;
}

/** Street level at the front wall: the terrain's front height, else 0. */
export function streetLevel(terrain: TerrainSpec | undefined, roomDepth: number): number {
  return groundHeightAt(terrain, -roomDepth / 2, roomDepth / 2);
}

/**
 * The storey the entrance opens onto: the one whose floor is within
 * STREET_TOLERANCE of the street, else the lowest whose floor is above it
 * (on a hill the porch skips a basement below the road and climbs steps).
 * Null when every floor is below the street — the house is buried at the
 * front and no storey can host a porch (#274).
 */
export function entranceFloorIndex(floors: readonly Pick<FloorLayout, 'height'>[], streetY: number): number | null {
  let nearest: number | null = null;
  let nearestGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < floors.length; i++) {
    const gap = Math.abs(floorElevation(floors, i) - streetY);
    if (gap < nearestGap) {
      nearest = i;
      nearestGap = gap;
    }
  }
  if (nearest !== null && nearestGap <= STREET_TOLERANCE) return nearest;
  for (let i = 0; i < floors.length; i++) {
    if (floorElevation(floors, i) > streetY) return i;
  }
  return null;
}

export interface EntranceGeometry {
  floorIndex: number;
  /** World x of the recess sides, z of the front wall and the recess back. */
  x0: number;
  x1: number;
  frontZ: number;
  backZ: number;
  /** World Y of the porch floor, the soffit, and the street. */
  bottomY: number;
  topY: number;
  streetY: number;
}

export interface EntranceContext {
  width: number;
  /** Room depth (layout.height). */
  depth: number;
  floors: readonly Pick<FloorLayout, 'height'>[];
  terrain?: TerrainSpec;
}

/** Why a recess can't be built; the Site panel shows the label (#274, #281). */
export type EntranceProblem = 'facade-too-narrow' | 'house-too-shallow' | 'no-street-storey' | 'too-low';

export const ENTRANCE_PROBLEM_LABELS: Record<EntranceProblem, string> = {
  'facade-too-narrow': "The recess doesn't fit on this front wall — widen the house.",
  'house-too-shallow': "The recess doesn't fit in this house — deepen the house.",
  'no-street-storey': 'No storey at street level — lower the street or add a floor above it.',
  'too-low': 'The storey at street level is too low for a porch.',
};

/** The recess width the front wall can take: the spec's, trimmed to leave a pier either side. */
function fittedWidth(entrance: Pick<EntranceSpec, 'width'>, roomWidth: number): number {
  return Math.min(entrance.width, roomWidth - MIN_PIER * 2);
}

/** How far off-centre the (fitted) recess can go before it eats a pier. */
function maxEntranceCenter(entrance: Pick<EntranceSpec, 'width'>, roomWidth: number): number {
  return Math.max(0, roomWidth / 2 - MIN_PIER - fittedWidth(entrance, roomWidth) / 2);
}

/**
 * The offsets the recess can actually take on this front wall, given its
 * (fitted) width. The Site panel clamps its Offset field to this so the
 * value shown is the value built (#281).
 */
export function entranceOffsetRange(entrance: Pick<EntranceSpec, 'width'>, roomWidth: number): [number, number] {
  const maxCenter = toCentimetre(maxEntranceCenter(entrance, roomWidth));
  return [-maxCenter, maxCenter];
}

function fitEntrance(
  entrance: EntranceSpec,
  ctx: EntranceContext
): { geometry: EntranceGeometry; problem: null } | { geometry: null; problem: EntranceProblem } {
  const width = fittedWidth(entrance, ctx.width);
  const depth = Math.min(entrance.depth, ctx.depth - MIN_HOUSE_BEHIND);
  if (width < ENTRANCE_LIMITS.width[0] - 1e-9) return { geometry: null, problem: 'facade-too-narrow' };
  if (depth < ENTRANCE_LIMITS.depth[0] - 1e-9) return { geometry: null, problem: 'house-too-shallow' };
  const maxCenter = maxEntranceCenter(entrance, ctx.width);
  const center = Math.max(-maxCenter, Math.min(maxCenter, entrance.offset ?? 0));

  const streetY = streetLevel(ctx.terrain, ctx.depth);
  const floorIndex = entranceFloorIndex(ctx.floors, streetY);
  if (floorIndex === null) return { geometry: null, problem: 'no-street-storey' };
  const bottomY = floorElevation(ctx.floors, floorIndex);
  const eaves = floorElevation(ctx.floors, ctx.floors.length);
  const topY = Math.min(bottomY + (entrance.height ?? DEFAULT_ENTRANCE_HEIGHT), eaves - 0.05);
  if (topY - bottomY < MIN_PORCH_HEIGHT) return { geometry: null, problem: 'too-low' };

  const frontZ = -ctx.depth / 2;
  return {
    geometry: { floorIndex, x0: center - width / 2, x1: center + width / 2, frontZ, backZ: frontZ + depth, bottomY, topY, streetY },
    problem: null,
  };
}

/**
 * Where the recess actually goes, fitted into the footprint: it keeps a pier
 * of front wall either side and a metre of house behind it, and its soffit
 * never rises above the building. Null when it can't be built; see
 * `entranceProblem` for why.
 */
export function entranceGeometry(entrance: EntranceSpec, ctx: EntranceContext): EntranceGeometry | null {
  return fitEntrance(entrance, ctx).geometry;
}

/** Why `entranceGeometry` is null for this spec, or null when it builds. */
export function entranceProblem(entrance: EntranceSpec, ctx: EntranceContext): EntranceProblem | null {
  return fitEntrance(entrance, ctx).problem;
}

/**
 * The hole the recess cuts in one storey's front (north) wall, in that wall's
 * local frame (north wall local +x is world +x) — or null when the recess
 * doesn't cross the storey. A tall porch cuts every storey it spans.
 */
export function entranceWallCut(
  geometry: EntranceGeometry,
  floors: readonly Pick<FloorLayout, 'height'>[],
  floorIndex: number
): { centerAlongWall: number; bottomFromFloor: number; width: number; height: number } | null {
  const floorY = floorElevation(floors, floorIndex);
  const top = floorY + storeyHeight(floors[floorIndex]);
  const cutBottom = Math.max(floorY, geometry.bottomY);
  // A cut through a whole storey would split its wall shape in two (bad for
  // earcut); keep a hairline of wall at the top so it stays one piece.
  const cutTop = Math.min(top - 0.01, geometry.topY);
  if (cutTop - cutBottom < 0.05) return null;
  return {
    centerAlongWall: (geometry.x0 + geometry.x1) / 2,
    bottomFromFloor: cutBottom - floorY,
    width: geometry.x1 - geometry.x0,
    height: cutTop - cutBottom,
  };
}

/**
 * Steps from the street up to the porch floor: count, rise and going. None
 * when the porch is level with the street, or a kerb below it (#274).
 */
export function entranceSteps(geometry: EntranceGeometry): { count: number; rise: number; going: number } {
  const total = geometry.bottomY - geometry.streetY;
  if (total < 0.1) return { count: 0, rise: 0, going: STEP_GOING };
  const count = Math.ceil(total / STEP_RISE);
  return { count, rise: total / count, going: STEP_GOING };
}

/** The interior wall closing the back of the recess; the door goes on it. */
export function entranceBackWall(geometry: EntranceGeometry): { x1: number; z1: number; x2: number; z2: number } {
  return { x1: geometry.x0, z1: geometry.backZ, x2: geometry.x1, z2: geometry.backZ };
}
