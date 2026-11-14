import type { FurnitureItem } from './types';

/** Items whose centres are this close in depth (m) share a row of the reading order. */
const ROW_TOLERANCE_M = 0.25;

/**
 * The active floor's placed items in the order a keyboard walks them (#650):
 * as the plan reads, rows from the top (north) down, each from left to right.
 * Items without a place on the plan are left out.
 */
export function itemsInPlanOrder<T extends FurnitureItem>(items: readonly T[]): T[] {
  return items
    .filter((item) => item.position !== undefined)
    .sort((a, b) => {
      const dz = a.position!.z - b.position!.z;
      if (Math.abs(dz) > ROW_TOLERANCE_M) return dz;
      return a.position!.x - b.position!.x || dz;
    });
}

/**
 * The item after (`1`) or before (`-1`) `currentId` in plan order; with
 * nothing selected, the first or the last. Null past either end, so Tab can
 * leave the scene instead of trapping the keyboard in it.
 */
export function cycleItem<T extends FurnitureItem>(items: readonly T[], currentId: string | null, direction: 1 | -1): T | null {
  const ordered = itemsInPlanOrder(items);
  const index = currentId === null ? -1 : ordered.findIndex((item) => item.id === currentId);
  if (index === -1) return (direction === 1 ? ordered[0] : ordered[ordered.length - 1]) ?? null;
  return ordered[index + direction] ?? null;
}

/** What the status region says when the keyboard selects an item. */
export function selectionAnnouncement(items: readonly FurnitureItem[], id: string): string {
  const ordered = itemsInPlanOrder(items);
  const index = ordered.findIndex((item) => item.id === id);
  const item = ordered[index];
  if (!item) return '';
  return `${item.name} selected, ${index + 1} of ${ordered.length}.${item.locked ? ' Locked.' : ''}`;
}
