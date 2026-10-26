import type { FloorLayout, RoomLayout } from './types';

// Which storey the editor shows after undo or redo swaps `current` for
// `restored` (#578). History stores the house only, so the floor is worked out
// from what the swap changes:
//  - the floors were added, removed or reordered: stay on the same floor (by
//    id), so undoing a removal or a reorder does not jump storeys;
//  - exactly one floor's contents change and it is not the one on screen:
//    switch to it, so the undo is visible instead of happening off-screen;
//  - otherwise stay on the same floor.
// When the floor on screen is gone from `restored` (undoing the floor's own
// addition), the old index is kept, clamped, as before.

/**
 * The same storey: one object, or a copy with every field equal. A restore
 * passes through the reducer's normalisation, which copies each floor while
 * keeping its fields, so identity alone would see every storey as changed on
 * the next undo.
 */
function sameFloor(a: FloorLayout, b: FloorLayout): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof FloorLayout)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.is(a[key], b[key]));
}

export function floorIndexAfterRestore(current: RoomLayout, activeFloorIndex: number, restored: RoomLayout): number {
  const count = restored.floors.length;
  const clamped = Math.max(0, Math.min(activeFloorIndex, count - 1));
  const activeId = current.floors[activeFloorIndex]?.id;
  if (activeId === undefined) return clamped;
  const activeIndex = restored.floors.findIndex((floor) => floor.id === activeId);
  const stay = activeIndex >= 0 ? activeIndex : clamped;

  const sameOrder =
    current.floors.length === count && current.floors.every((floor, index) => floor.id === restored.floors[index]?.id);
  if (!sameOrder) return stay;

  const changed = restored.floors.flatMap((floor, index) => {
    const before = current.floors[index];
    return before && sameFloor(before, floor) ? [] : [index];
  });
  const [only] = changed;
  return changed.length === 1 && only !== undefined && only !== activeIndex ? only : stay;
}
