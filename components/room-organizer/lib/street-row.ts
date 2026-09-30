import { ROOF_STYLE_DEFAULT_COLORS } from './constants';
import { PAVEMENT_DEPTH, groundHeightAt, outdoorGroundSize, roadEdges } from './site';
import type { Frontage, NeighbourSpec, RoofStyle, TerrainSpec } from './types';

/**
 * The street of neighbours (#310): a deterministic, seeded row of houses
 * along both sides of ours and, optionally, a facing row across the road.
 *
 * Everything here is pure layout — where each house stands and what it is
 * made of. three/neighbours.ts turns the specs into meshes. The same seed
 * and site always give the same list, so a design shows the same street
 * after a reload or through a share link; "Shuffle street" re-rolls the seed.
 */

export type StreetFinish = 'brick' | 'render' | 'plain';
export type StreetRow = 'ours' | 'across';
export type StreetRoofStyle = Exclude<RoofStyle, 'none'>;

export interface StreetHouseSpec {
  /** Stable per-street key, e.g. `w1` (first house west of ours), `a3` (across). */
  id: string;
  row: StreetRow;
  /** For the two party-wall neighbours only. */
  side?: 'west' | 'east';
  /** World x of the house centre. */
  x: number;
  /** World z of the street-facing wall plane. */
  frontZ: number;
  /** Direction the front faces along z: −1 looks north at the road like ours, +1 faces back at us. */
  facing: -1 | 1;
  width: number;
  depth: number;
  /** World y of each storey's floor, ground floor first. */
  floorYs: number[];
  /** Top of the highest storey, where the roof starts. */
  eavesY: number;
  /** Ground line against the front and back walls. */
  groundFrontY: number;
  groundBackY: number;
  roof: { style: RoofStyle; color: string; pitch: number };
  facade: { color: string; finish: StreetFinish };
  /** A bay window on the ground floor's street face. */
  bay: boolean;
  /** A small dormer on the street slope. */
  dormer: boolean;
  door: { color: string; offset: number };
  chimney: boolean;
  /** Party wall to the house between it and ours (a hair's gap), else a garden gap. */
  attached: boolean;
  /** Which side walls are free-standing and can take windows. */
  openSides: { west: boolean; east: boolean };
}

export interface StreetSite {
  width: number;
  depth: number;
  /** Our storeys' floor elevations and eaves (lib/storeys.ts). */
  floorYs: readonly number[];
  eavesY: number;
  roof?: { style: RoofStyle; color?: string };
  terrain?: TerrainSpec;
  frontage?: Frontage;
  neighbours?: NeighbourSpec;
}

/** Seed used when a layout has none: the street it always showed. */
export const DEFAULT_STREET_SEED = 1;

/** The row never runs further than this either side of our centre — inside the shadow camera's ±24 m (#282). */
export const STREET_MAX_HALF_LENGTH = 24;
/** Kept clear at each end so the last house isn't cut by the scenery's edge. */
const STREET_END_MARGIN = 2;
/** The facing row's own pavement-to-wall strip with a front garden; a pavement frontage mirrors ours. */
const FACING_FRONT_GARDEN = 1.2;

/** Clearance between attached houses (and off our wall plane) so party walls never z-fight. */
export const PARTY_WALL_GAP = 0.02;

/** Window sizing rules shared by the builder and its tests (#280). */
export const WINDOW_WIDTH = 1.1;
const WINDOW_MAX_HEIGHT = 1.4;
const WINDOW_MIN_HEIGHT = 0.7;
/** Sill above the storey floor, and the minimum above the ground line outside. */
const WINDOW_SILL = 0.9;
const WINDOW_SILL_ABOVE_GROUND = 0.45;
/** Head clearance below the storey above. */
const WINDOW_HEAD_GAP = 0.35;
/** A storey needs this much wall above ground to take a row at all. */
const MIN_WALL_FOR_ROW = 1.8;
/** Facade width thresholds: none below the first, one up to the second (#280). */
const MIN_FACADE_FOR_WINDOW = 1.4;
const MIN_FACADE_FOR_PAIR = 2.6;
const WINDOW_BAY_PITCH = 1.6;
export const MAX_WINDOWS_PER_FACE = 5;

const FACADE_PALETTES: Record<StreetFinish, readonly string[]> = {
  brick: ['#b5654a', '#a8553f', '#c48a62', '#9c5b47', '#c9a27e', '#b8735a', '#8f4f3d'],
  render: ['#e9e2d3', '#f1e8d8', '#dcd3c0', '#e6d7b8', '#d6dde0', '#f3efe6', '#e3c9a8'],
  plain: ['#c9a27e', '#b8735a', '#9aa5a8', '#d9c9b0', '#a7b8a3', '#c8b7a6'],
};
const ROOF_PALETTE: readonly string[] = ['#8d6e63', '#5d4037', '#546e7a', '#7b5e57', '#455a64', '#a1887f', '#6d4c41'];
const DOOR_PALETTE: readonly string[] = ['#1f3a5f', '#8b1e2d', '#2e5e3a', '#f2f2f2', '#2b2b2b', '#c9a227'];
const ROOF_STYLES: readonly StreetRoofStyle[] = ['gable', 'gable', 'hipped', 'hipped', 'flat'];

/** Mulberry32 — the same small PRNG three/outdoor.ts scatters the lot with. */
export function makeStreetRng(seed: number): () => number {
  let state = (seed | 0) || 1;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for "Shuffle street". */
export function randomStreetSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/** How far the row may run either side of x = 0 for this footprint. */
export function streetHalfLength(width: number, depth: number): number {
  return Math.min(STREET_MAX_HALF_LENGTH, outdoorGroundSize(width, depth) / 2 - STREET_END_MARGIN);
}

/**
 * How many windows a facade of this width takes (#280): none where a frame
 * wouldn't fit, one on a narrow terrace, then one per 1.6 m or so.
 */
export function windowCount(facadeWidth: number): number {
  if (facadeWidth < MIN_FACADE_FOR_WINDOW) return 0;
  if (facadeWidth < MIN_FACADE_FOR_PAIR) return 1;
  return Math.min(MAX_WINDOWS_PER_FACE, Math.max(1, Math.floor((facadeWidth - 0.4) / WINDOW_BAY_PITCH)));
}

/**
 * A storey's window row on one face, or null when the ground outside buries
 * it (#280). The sill is lifted clear of the ground line, and the row is
 * dropped if what is left between sill and head is too small to read as a
 * window.
 */
export function windowRow(
  floorY: number,
  storeyTopY: number,
  groundY: number
): { sillY: number; height: number } | null {
  if (storeyTopY - Math.max(floorY, groundY) < MIN_WALL_FOR_ROW) return null;
  const sillY = Math.max(floorY + WINDOW_SILL, groundY + WINDOW_SILL_ABOVE_GROUND);
  const height = Math.min(WINDOW_MAX_HEIGHT, storeyTopY - WINDOW_HEAD_GAP - sillY);
  if (height < WINDOW_MIN_HEIGHT) return null;
  return { sillY, height };
}

const pick = <T>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;
const between = (rng: () => number, lo: number, hi: number): number => lo + rng() * (hi - lo);

/**
 * Lay the street out. Returns nothing when no neighbour flag is set, and the
 * two matched party-wall houses alone when only `west` / `east` are, so
 * layouts from before #310 look exactly as they did.
 */
export function generateStreet(site: StreetSite): StreetHouseSpec[] {
  const { neighbours } = site;
  if (!neighbours) return [];
  const rng = makeStreetRng(neighbours.seed ?? DEFAULT_STREET_SEED);
  const halfLength = streetHalfLength(site.width, site.depth);
  const halfW = site.width / 2;
  const halfD = site.depth / 2;
  const ourStoreys = Math.max(1, site.floorYs.length);
  const frontZ = -halfD;
  const groundAt = (z: number) => groundHeightAt(site.terrain, z, halfD);

  const houses: StreetHouseSpec[] = [];

  // Our row: out from each party wall in turn. The RNG stream is shared in
  // a fixed order (west row, east row, facing row), so every house depends
  // on the seed alone.
  for (const side of ['west', 'east'] as const) {
    const sign = side === 'east' ? 1 : -1;
    const partyWall = neighbours[side] === true;
    if (!partyWall && neighbours.street !== true) continue;
    let cursor = halfW;
    for (let index = 0; ; index += 1) {
      const immediate = index === 0;
      // Terrace rhythm next to us: matched eaves, storeys, and depth.
      const width = immediate
        ? Math.min(14, Math.max(3, site.width * between(rng, 0.75, 1.05)))
        : between(rng, 4, 7.5);
      const attached = immediate ? partyWall : rng() < 0.8 - index * 0.15;
      const gap = attached ? PARTY_WALL_GAP : between(rng, 1.2, 3);
      const near = cursor + gap;
      if (!immediate && near + width > halfLength) break;
      const x = sign * (near + width / 2);
      const depth = immediate ? site.depth : Math.min(12, Math.max(4, site.depth * between(rng, 0.85, 1.15)));
      const house = houseSpec(rng, {
        id: `${side[0]}${index}`,
        row: 'ours',
        x,
        frontZ,
        facing: -1,
        width,
        depth,
        ourStoreys,
        groundFrontY: groundAt(frontZ),
        groundBackY: groundAt(frontZ + depth),
        floorY: 0,
        attached,
        matched: immediate ? { floorYs: [...site.floorYs], eavesY: site.eavesY, roof: site.roof } : null,
      });
      if (immediate && partyWall) house.side = side;
      // The wall nearer ours is open when this house stands off the last;
      // the last one's outer wall is closed once this one is built against it.
      const inner = side === 'east' ? 'west' : 'east';
      house.openSides[inner] = !attached;
      if (attached && !immediate) houses[houses.length - 1]!.openSides[side] = false;
      houses.push(house);
      cursor = near + width;
      if (neighbours.street !== true) break;
    }
  }

  // The facing row: mirrored over the road, fronts on a pavement of their own.
  if (neighbours.across === true) {
    const road = roadEdges(halfD, site.frontage);
    const facingFrontZ = -(road.far + PAVEMENT_DEPTH + (site.frontage === 'pavement' ? 0 : FACING_FRONT_GARDEN));
    const facingGroundY = groundAt(frontZ);
    let cursor = -halfLength + between(rng, 0, 3);
    let previous: StreetHouseSpec | null = null;
    for (let index = 0; ; index += 1) {
      const width = between(rng, 4, 8);
      const attached = index > 0 && rng() < 0.5;
      const gap = attached ? PARTY_WALL_GAP : between(rng, 1.5, 4);
      const near = cursor + gap;
      if (near + width > halfLength) break;
      const depth = Math.min(8, Math.max(4, Math.min(site.depth, 8) * between(rng, 0.8, 1)));
      const house = houseSpec(rng, {
        id: `a${index}`,
        row: 'across',
        x: near + width / 2,
        frontZ: facingFrontZ,
        facing: 1,
        width,
        depth,
        ourStoreys,
        groundFrontY: facingGroundY,
        groundBackY: facingGroundY,
        floorY: facingGroundY,
        attached,
        matched: null,
      });
      house.openSides.west = !attached;
      if (attached && previous) previous.openSides.east = false;
      houses.push(house);
      previous = house;
      cursor = near + width;
    }
  }

  return houses;
}

interface HouseSeed {
  id: string;
  row: StreetRow;
  x: number;
  frontZ: number;
  facing: -1 | 1;
  width: number;
  depth: number;
  ourStoreys: number;
  groundFrontY: number;
  groundBackY: number;
  /** Ground-floor datum. */
  floorY: number;
  attached: boolean;
  /** Set for the party-wall neighbours: they copy our storeys and roof line. */
  matched: { floorYs: number[]; eavesY: number; roof: StreetSite['roof'] } | null;
}

function houseSpec(rng: () => number, seed: HouseSeed): StreetHouseSpec {
  // Every draw happens unconditionally so a house's look depends only on its
  // place in the stream, never on which options an earlier branch took.
  const storeyDelta = pick(rng, [-1, 0, 0, 1]);
  const storeyHeight = between(rng, 2.7, 3.2);
  const roofStyle = pick(rng, ROOF_STYLES);
  const roofColor = pick(rng, ROOF_PALETTE);
  const pitch = between(rng, 0.75, 1.3);
  const finish = pick<StreetFinish>(rng, ['brick', 'brick', 'render', 'plain']);
  const facadeColor = pick(rng, FACADE_PALETTES[finish]);
  const bayRoll = rng();
  const dormerRoll = rng();
  const doorColor = pick(rng, DOOR_PALETTE);
  const doorSide = pick(rng, [-1, 0, 1]);
  const chimney = rng() < 0.6;

  const storeys = Math.max(1, seed.ourStoreys + storeyDelta);
  const floorYs = seed.matched
    ? seed.matched.floorYs
    : Array.from({ length: storeys }, (_, i) => seed.floorY + i * storeyHeight);
  const eavesY = seed.matched ? seed.matched.eavesY : seed.floorY + storeys * storeyHeight;
  const roof = seed.matched
    ? {
        style: seed.matched.roof?.style ?? 'none',
        color: seed.matched.roof?.color ?? ROOF_STYLE_DEFAULT_COLORS[seed.matched.roof?.style ?? 'none'],
        pitch: 1,
      }
    : { style: roofStyle, color: roofColor, pitch: roofStyle === 'flat' ? 1 : pitch };

  return {
    id: seed.id,
    row: seed.row,
    x: seed.x,
    frontZ: seed.frontZ,
    facing: seed.facing,
    width: seed.width,
    depth: seed.depth,
    floorYs,
    eavesY,
    groundFrontY: seed.groundFrontY,
    groundBackY: seed.groundBackY,
    roof,
    facade: { color: facadeColor, finish },
    bay: seed.width >= 5 && bayRoll < 0.45,
    dormer: roof.style !== 'flat' && roof.style !== 'none' && seed.width >= 4.5 && dormerRoll < 0.4,
    door: { color: doorColor, offset: doorSide * Math.max(0, seed.width / 2 - 1.1) },
    chimney: roof.style !== 'none' && chimney,
    attached: seed.attached,
    openSides: { west: true, east: true },
  };
}
