import { computeFloorOpenings } from './stairs';
import { type EntranceBuilding, entranceKeepOut } from './street';
import type { KeepOutRect } from './geometry';
import type { FloorLayout } from './types';

/** What the keep-out of a storey depends on: the porch fit and the floor below's stairs. */
export interface KeepOutBuilding extends Omit<EntranceBuilding, 'floors'> {
  floors: readonly FloorLayout[];
}

/**
 * The stairwell holes the stairs on the floor below cut into this storey,
 * as keep-out (#372). A winder's L is approximated by its bounding box in
 * the stair's frame.
 */
export function stairwellKeepOut(floors: readonly FloorLayout[], floorIndex: number): KeepOutRect[] {
  if (floorIndex < 1) return [];
  return computeFloorOpenings(floors[floorIndex - 1]).map((opening) => ({
    x0: opening.centerX - opening.width / 2,
    x1: opening.centerX + opening.width / 2,
    z0: opening.centerZ - opening.depth / 2,
    z1: opening.centerZ + opening.depth / 2,
    ...(opening.rotation ? { rotation: opening.rotation } : {}),
    hole: true,
  }));
}

/** Everything `hasCollisions` keeps furniture out of on one storey: the porch and the stairwells. */
export function floorKeepOut(building: KeepOutBuilding, floorIndex: number): KeepOutRect[] {
  return [...entranceKeepOut(building, floorIndex), ...stairwellKeepOut(building.floors, floorIndex)];
}
