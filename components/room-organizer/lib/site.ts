import type { Frontage, NeighbourFlag, NeighbourSide, NeighbourSpec, TerrainSpec } from './types';

/**
 * Sloped sites and party-wall neighbours (#202).
 *
 * The ground floor stays the datum at y = 0. `terrain` gives the ground
 * height at the street (front, north, where the road runs) and at the
 * garden (back, south). Ground is flat at those heights beyond the house
 * and slopes linearly along the house's depth, so a house can be cut into
 * a hill: `{ frontY: 2.5, backY: 0 }` puts a 2.5 m basement below the
 * street and at garden level behind.
 */
export const MIN_TERRAIN_Y = -3;
export const MAX_TERRAIN_Y = 6;

export const NEIGHBOUR_SIDES: readonly NeighbourSide[] = ['west', 'east'];

export function isTerrainY(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= MIN_TERRAIN_Y && value <= MAX_TERRAIN_Y
  );
}

export function clampTerrainY(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_TERRAIN_Y, Math.max(MIN_TERRAIN_Y, value));
}

/** Ground height at world z. `halfDepth` is half the house's depth. */
export function groundHeightAt(terrain: TerrainSpec | undefined, z: number, halfDepth: number): number {
  if (!terrain) return 0;
  if (halfDepth <= 0) return terrain.frontY;
  const t = Math.min(1, Math.max(0, (z + halfDepth) / (2 * halfDepth)));
  return terrain.frontY + (terrain.backY - terrain.frontY) * t;
}

/** Lowest ground anywhere around the house — how deep its plinth must reach. */
export function lowestGround(terrain: TerrainSpec | undefined): number {
  return terrain ? Math.min(0, terrain.frontY, terrain.backY) : 0;
}

export function neighbourSides(neighbours: NeighbourSpec | undefined): NeighbourSide[] {
  return NEIGHBOUR_SIDES.filter((side) => neighbours?.[side] === true);
}

export const NEIGHBOUR_FLAGS: readonly NeighbourFlag[] = ['west', 'east', 'street', 'across'];

/** Seeds are 31-bit non-negative integers: what the mulberry32 stream consumes whole (#310). */
export const MAX_STREET_SEED = 0x7fffffff;

export function isStreetSeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_STREET_SEED;
}

/** Whether anything at all stands along the street (#310). */
export function hasNeighbours(neighbours: NeighbourSpec | undefined): boolean {
  return NEIGHBOUR_FLAGS.some((flag) => neighbours?.[flag] === true);
}

/** A house stands on that side of ours — a party wall or the street row beyond it (#310). */
export function hasNeighbourOn(neighbours: NeighbourSpec | undefined, side: NeighbourSide): boolean {
  return neighbours?.[side] === true || neighbours?.street === true;
}

/**
 * The lot scenery's dimensions (three/outdoor.ts draws to these; the street
 * row in lib/street-row.ts must fit inside them, #310). All in metres.
 */
export const LOT_MARGIN = 6;
/** Grass between the lot edge and the pavement with a front garden. */
export const LOT_TO_PAVEMENT = 1.6;
export const PAVEMENT_DEPTH = 1.6;
export const ROAD_DEPTH = 4.5;

/** Side of the square ground plane around a house of this footprint. */
export function outdoorGroundSize(width: number, depth: number): number {
  return Math.max(width, depth) * 6 + LOT_MARGIN * 2;
}

/**
 * Where the road runs, as |z| north of the house: the pavement's near edge
 * (at the front wall with a pavement frontage, past the lot otherwise) and
 * the road's far edge.
 */
export function roadEdges(halfDepth: number, frontage: Frontage | undefined): { near: number; far: number } {
  const near = frontage === 'pavement' ? halfDepth : halfDepth + LOT_MARGIN + LOT_TO_PAVEMENT;
  return { near, far: near + PAVEMENT_DEPTH + ROAD_DEPTH };
}
