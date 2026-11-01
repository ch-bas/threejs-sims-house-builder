import { cutoutRect } from './footprint';
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

/** How far past the walls the cut's keep-out runs, so an outdoor item astride the old outline stands wholly in it. */
const CUTOUT_REACH = 50;

/**
 * The corner cut out of the building (#727): outside, like the porch, so
 * indoor items stay out and outdoor ones stand on it. It runs on past the
 * rectangle's two outer edges, where it is open ground all the way.
 */
export function cutoutKeepOut(building: Omit<KeepOutBuilding, 'floors'>): KeepOutRect[] {
  const notch = cutoutRect(building);
  const corner = building.cutout?.corner;
  if (!notch || !corner) return [];
  const east = corner.endsWith('e');
  const north = corner.startsWith('n');
  return [
    {
      x0: east ? notch.x0 : notch.x0 - CUTOUT_REACH,
      x1: east ? notch.x1 + CUTOUT_REACH : notch.x1,
      z0: north ? notch.z0 - CUTOUT_REACH : notch.z0,
      z1: north ? notch.z1 : notch.z1 + CUTOUT_REACH,
      cutout: building.cutout!,
    },
  ];
}

/** Everything `hasCollisions` keeps furniture out of on one storey: the porch, the cut corner and the stairwells. */
export function floorKeepOut(building: KeepOutBuilding, floorIndex: number): KeepOutRect[] {
  return [...entranceKeepOut(building, floorIndex), ...cutoutKeepOut(building), ...stairwellKeepOut(building.floors, floorIndex)];
}
