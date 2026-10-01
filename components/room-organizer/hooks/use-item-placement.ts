import { useCallback, useMemo } from 'react';
import { CURRENCY_SYMBOL, DEFAULT_BUDGET, GRID_SIZE_METERS } from '../lib/constants';
import {
  snapToGrid as snapValueToGrid,
  snapToNeighbors,
  snapToWall as snapPositionToWall,
} from '../lib/geometry';
import { isOpening, snapOpeningToWall, snapWallMountedItem, type WallGap } from '../lib/opening-snap';
import type { LayoutActions } from './use-layout-state';
import type { CatalogItem, FloorLayout, ViewSettings } from '../lib/types';

export interface UseItemPlacementParams {
  activeFloor: FloorLayout;
  /** World-space Y of the active floor — the drag plane. */
  activeFloorY: number;
  roomWidth: number;
  roomDepth: number;
  /** Current furniture value across the whole building, for the budget guard. */
  buildingCost: number;
  actions: LayoutActions;
  view: Pick<ViewSettings, 'snapToGrid' | 'snapToWall' | 'snapToItems'>;
  /**
   * The multi-selection. A drag on one of its items moves its unlocked
   * members together, so snap-to-items must not target their stale
   * pre-drag positions (#380).
   */
  allSelectedIds?: ReadonlySet<string>;
  /**
   * The span the recessed entrance cuts out of the active storey's north
   * wall (`entrancePlanOutline`): openings snap onto the piers beside it (#394).
   */
  frontGap?: WallGap | null;
}

export interface UseItemPlacementResult {
  /** Adjust a candidate drop position before it's applied (snap-to-grid/-wall/-items). */
  snapPosition(itemId: string, x: number, z: number): { x: number; z: number };
  getDragPlaneY(): number;
  /** Wall-aware catalog placement (snaps doors/windows/cameras to walls). */
  placeCatalogItem(catalogItem: CatalogItem, position?: { x: number; z: number }): string;
}

export function useItemPlacement({
  activeFloor,
  activeFloorY,
  roomWidth,
  roomDepth,
  buildingCost,
  actions,
  view,
  allSelectedIds,
  frontGap,
}: UseItemPlacementParams): UseItemPlacementResult {
  // Keyed on the numbers, so a fresh outline object each render doesn't
  // rebuild the callbacks.
  const gapX0 = frontGap?.x0;
  const gapX1 = frontGap?.x1;
  const gap = useMemo(
    () => (gapX0 !== undefined && gapX1 !== undefined ? { frontGap: { x0: gapX0, x1: gapX1 } } : {}),
    [gapX0, gapX1]
  );

  const snapPosition = useCallback(
    (itemId: string, x: number, z: number) => {
      let result = { x, z };
      const item = activeFloor.items.find((entry) => entry.id === itemId);

      // Doors and windows have to live on a wall — there's no such thing as
      // a "free-floating" opening. Force-snap them regardless of the toggle.
      if (item && isOpening(item.type)) {
        const snapped = snapOpeningToWall({
          position: result,
          itemWidth: item.width,
          roomWidth,
          roomDepth,
          interiorWalls: activeFloor.interiorWalls ?? [],
          ...gap,
        });
        return snapped.position;
      }

      // Security cameras follow the cursor freely while dragging (no per-frame
      // wall-snap — that made them teleport/flip between walls). They snap onto
      // the nearest wall and orient into the room on release, in handleDragEnd.

      if (view.snapToGrid) {
        result = {
          x: snapValueToGrid(result.x, GRID_SIZE_METERS),
          z: snapValueToGrid(result.z, GRID_SIZE_METERS),
        };
      }
      if (view.snapToItems && item) {
        // Same membership as use-item-drag's session: locked co-selected
        // items stay put, so they remain valid targets.
        const group =
          allSelectedIds && allSelectedIds.size > 1 && allSelectedIds.has(itemId)
            ? new Set(
                activeFloor.items
                  .filter((entry) => allSelectedIds.has(entry.id) && !entry.locked)
                  .map((entry) => entry.id)
              )
            : undefined;
        result = snapToNeighbors({
          position: result,
          movingItem: item,
          otherItems: activeFloor.items,
          ...(group ? { excludeIds: group } : {}),
        });
      }
      if (view.snapToWall && item) {
        result = snapPositionToWall({
          position: result,
          item,
          roomWidth,
          roomDepth,
        });
      }
      return result;
    },
    [
      view.snapToGrid,
      view.snapToWall,
      view.snapToItems,
      activeFloor.items,
      activeFloor.interiorWalls,
      allSelectedIds,
      gap,
      roomWidth,
      roomDepth,
    ]
  );

  const getDragPlaneY = useCallback(() => activeFloorY, [activeFloorY]);

  /**
   * Add an item from the catalog. For doors and windows, the requested
   * position is force-snapped to the nearest wall (exterior or interior)
   * and a default rotation aligned with that wall is applied — these
   * openings only make sense embedded in a wall.
   */
  const placeCatalogItem = useCallback(
    (catalogItem: CatalogItem, position?: { x: number; z: number }) => {
      // Budget guard (#136): the budget used to be pure decoration — nothing
      // in the buy flow consulted it. Going over now asks instead of
      // silently proceeding (and instead of hard-blocking: it's a sandbox).
      const price = catalogItem.price ?? 0;
      if (price > 0 && buildingCost + price > DEFAULT_BUDGET && typeof window !== 'undefined') {
        const proceed = window.confirm(
          `This ${CURRENCY_SYMBOL}${price.toLocaleString()} purchase puts you over the ` +
            `${CURRENCY_SYMBOL}${DEFAULT_BUDGET.toLocaleString()} budget. Place it anyway?`
        );
        if (!proceed) return '';
      }
      if (isOpening(catalogItem.type)) {
        const snapped = snapOpeningToWall({
          position: position ?? { x: 0, z: 0 },
          itemWidth: catalogItem.width,
          roomWidth,
          roomDepth,
          interiorWalls: activeFloor.interiorWalls ?? [],
          ...gap,
        });
        const id = actions.addCatalogItem(catalogItem, snapped.position);
        // updateItem, not setRotation: catalog items are born locked (#11)
        // and the reducer refuses setRotation on locked items (#209).
        actions.updateItem(id, { rotation: snapped.rotation });
        return id;
      }
      if (catalogItem.type === 'security-camera') {
        const snapped = snapWallMountedItem({
          position: position ?? { x: 0, z: 0 },
          itemWidth: catalogItem.width,
          itemDepth: catalogItem.depth,
          roomWidth,
          roomDepth,
          interiorWalls: activeFloor.interiorWalls ?? [],
          ...gap,
        });
        const id = actions.addCatalogItem(catalogItem, snapped.position);
        actions.updateItem(id, { rotation: snapped.rotation, wallRotation: snapped.rotation });
        return id;
      }
      // Outdoor items belong outside the building on the ground. `addCatalogItem`
      // targets the ACTIVE floor, so placing one while an upper floor is active
      // lands it on that floor's ring hovering mid-air past the wall (#73c).
      // The drag-plane Y is 0 only on the ground floor, so a non-zero Y means an
      // upper floor is active — block the placement rather than float the item.
      // (Re-homing it onto the ground floor would need a reducer change, which a
      // sibling branch owns, so we no-op instead.)
      if (catalogItem.category === 'outdoor' && activeFloorY > 0) {
        return '';
      }
      // Outdoor items belong outside the building — default them just past
      // the south wall instead of the room centre when no position is given.
      if (catalogItem.category === 'outdoor' && !position) {
        const outsidePos = { x: 0, z: roomDepth / 2 + catalogItem.depth / 2 + 0.5 };
        return actions.addCatalogItem(catalogItem, outsidePos);
      }
      return actions.addCatalogItem(catalogItem, position);
    },
    [actions, activeFloor.interiorWalls, activeFloorY, roomWidth, roomDepth, buildingCost, gap]
  );

  return { snapPosition, getDragPlaneY, placeCatalogItem };
}
