import type { NeighbourSide, NeighbourSpec, TerrainSpec } from './types';

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
