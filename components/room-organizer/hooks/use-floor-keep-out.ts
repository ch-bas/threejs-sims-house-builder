import { useMemo } from 'react';
import { floorKeepOut } from '../lib/floor-keep-out';
import type { KeepOutRect } from '../lib/geometry';
import type { RoomLayout } from '../lib/types';

/**
 * One storey's `hasCollisions` keep-out — the recessed entrance's porch
 * (#285) and the stairwells cut by the floor below (#372) — memoised on the
 * fields they are fitted to, not the whole layout.
 */
export function useFloorKeepOut(layout: RoomLayout, floorIndex: number): readonly KeepOutRect[] {
  const { width, height, terrain, entrance, floors } = layout;
  return useMemo(
    () => floorKeepOut({ width, height, terrain, entrance, floors }, floorIndex),
    [width, height, terrain, entrance, floors, floorIndex]
  );
}
