import { useCallback } from 'react';
import { GRID_SIZE_METERS } from '../lib/constants';
import {
  snapToGrid as snapValueToGrid,
  snapToNeighbors,
  snapToWall as snapPositionToWall,
} from '../lib/geometry';
import { isOpening, snapOpeningToWall, snapWallMountedItem } from '../lib/opening-snap';
import type { LayoutActions } from './use-layout-state';
import type { CatalogItem, FloorLayout, ViewSettings } from '../lib/types';

export interface UseItemPlacementParams {
  activeFloor: FloorLayout;
  /** World-space Y of the active floor — the drag plane. */
  activeFloorY: number;
  roomWidth: number;
  roomDepth: number;
  actions: LayoutActions;
  view: Pick<ViewSettings, 'snapToGrid' | 'snapToWall' | 'snapToItems'>;
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
  actions,
  view,
}: UseItemPlacementParams): UseItemPlacementResult {
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
        result = snapToNeighbors({
          position: result,
          movingItem: item,
          otherItems: activeFloor.items,
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
      if (isOpening(catalogItem.type)) {
        const snapped = snapOpeningToWall({
          position: position ?? { x: 0, z: 0 },
          itemWidth: catalogItem.width,
          roomWidth,
          roomDepth,
          interiorWalls: activeFloor.interiorWalls ?? [],
        });
        const id = actions.addCatalogItem(catalogItem, snapped.position);
        actions.setRotation(id, snapped.rotation);
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
        });
        const id = actions.addCatalogItem(catalogItem, snapped.position);
        actions.setRotation(id, snapped.rotation);
        actions.updateItem(id, { wallRotation: snapped.rotation });
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
    [actions, activeFloor.interiorWalls, activeFloorY, roomWidth, roomDepth]
  );

  return { snapPosition, getDragPlaneY, placeCatalogItem };
}
