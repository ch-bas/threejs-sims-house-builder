import { useMemo } from 'react';
import { entranceKeepOut } from '../lib/street';
import type { KeepOutRect } from '../lib/geometry';
import type { RoomLayout } from '../lib/types';

/**
 * The recessed entrance's porch as `hasCollisions` keep-out for one storey
 * (#285), memoised on the fields the recess is fitted to — not the whole
 * layout, which changes identity on every item edit.
 */
export function useEntranceKeepOut(layout: RoomLayout, floorIndex: number): readonly KeepOutRect[] {
  const { width, height, terrain, entrance, floors } = layout;
  return useMemo(
    () => entranceKeepOut({ width, height, terrain, entrance, floors }, floorIndex),
    [width, height, terrain, entrance, floors, floorIndex]
  );
}
