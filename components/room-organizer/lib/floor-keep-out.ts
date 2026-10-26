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
 * as keep-out (#372): one rect per leg of the hole, so a winder's L keeps
 * furniture out of exactly the floor it removes (#572).
 */
export function stairwellKeepOut(floors: readonly FloorLayout[], floorIndex: number): KeepOutRect[] {
  if (floorIndex < 1) return [];
  return computeFloorOpenings(floors[floorIndex - 1]).flatMap((opening) =>
    (opening.parts ?? [opening]).map((part) => ({
      x0: part.centerX - part.width / 2,
      x1: part.centerX + part.width / 2,
      z0: part.centerZ - part.depth / 2,
      z1: part.centerZ + part.depth / 2,
      ...(opening.rotation ? { rotation: opening.rotation } : {}),
      hole: true,
    }))
  );
}

/** Everything `hasCollisions` keeps furniture out of on one storey: the porch and the stairwells. */
export function floorKeepOut(building: KeepOutBuilding, floorIndex: number): KeepOutRect[] {
  return [...entranceKeepOut(building, floorIndex), ...stairwellKeepOut(building.floors, floorIndex)];
}
