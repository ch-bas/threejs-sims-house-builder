'use client';

import {
  INITIAL_GROUND_FLOOR,
  INITIAL_LAYOUT,
  type LayoutAction,
  type LayoutState,
} from './layout-reducer';
import {
  useActiveFloorIndex,
  useLayout,
  useLayoutActions,
} from './use-layout-store';
import type {
  CatalogItem,
  FloorLayout,
  FloorPattern,
  FloorPlanFitMode,
  FurnitureItem,
  InteriorWall,
  RoofStyle,
  RoomLayout,
  SofaShape,
  WallId,
  WallPattern,
} from '../lib/types';

export type { LayoutAction, LayoutState };
export { INITIAL_LAYOUT };

// ---------------------------------------------------------------------------
// Action facade
// ---------------------------------------------------------------------------

export interface LayoutActions {
  setName(name: string): void;
  setWidth(width: number): void;
  setHeight(height: number): void;
  setFloorColor(color: string): void;
  setFloorPattern(pattern: FloorPattern): void;
  setWallPattern(pattern: WallPattern): void;
  setWallColor(wall: WallId, color: string | null): void;
  setFloorPlan(image: string | null): void;
  setFloorPlanOpacity(opacity: number): void;
  setFloorPlanFitMode(mode: FloorPlanFitMode): void;
  setRoofStyle(style: RoofStyle): void;
  setRoofColor(color: string): void;
  addCatalogItem(catalogItem: CatalogItem, position?: { x: number; z: number }): string;
  removeItem(id: string): void;
  duplicateItem(id: string): string;
  rotateItem(id: string): void;
  moveItem(id: string, x: number, z: number): void;
  resizeItem(id: string, dimension: 'width' | 'depth' | 'height', value: number): void;
  updateItem(id: string, patch: Partial<FurnitureItem>): void;
  setSofaShape(id: string, shape: SofaShape): void;
  setSignalRange(id: string, range: number): void;
  setColor(id: string, color: string): void;
  setLocked(id: string, locked: boolean): void;
  toggleMirror(id: string): void;
  setRotation(id: string, rotation: number): void;
  replaceItems(items: FurnitureItem[]): void;
  addItems(items: FurnitureItem[]): void;
  bulkSetPositions(positions: ReadonlyMap<string, { x: number; z: number }>): void;
  addInteriorWall(wall: InteriorWall): void;
  addInteriorWalls(walls: readonly InteriorWall[]): void;
  removeInteriorWall(id: string): void;
  clearInteriorWalls(): void;
  toggleExteriorWall(wallId: WallId): void;
  rotateSelection(ids: ReadonlySet<string>, radians: number): void;
  setLockAll(locked: boolean): void;
  clearItems(): void;
  setActiveFloorIndex(index: number): void;
  addFloor(): string;
  duplicateFloor(sourceIndex: number): string;
  removeFloor(index: number): void;
  renameFloor(index: number, name: string): void;
  reorderFloor(from: number, to: number): void;
  applyLayout(layout: RoomLayout): void;
}

export interface UseLayoutStateResult {
  layout: RoomLayout;
  activeFloorIndex: number;
  activeFloor: FloorLayout;
  actions: LayoutActions;
}

// ---------------------------------------------------------------------------
// Hook — thin adapter over the Zustand store (POC for issue #3)
// ---------------------------------------------------------------------------
//
// State now lives in `use-layout-store.ts`. This hook subscribes to the store
// via selectors and returns the SAME `UseLayoutStateResult` shape it always
// has, so `room-organizer.tsx` and every panel that reads through
// `useRoomEditor()` keep working with zero edits. Panels migrated to subscribe
// to the store directly bypass this adapter (and the context) entirely.
//
// The `initial` parameter is kept for signature compatibility; the store owns
// the initial state (`INITIAL_LAYOUT`), so it is unused.

export function useLayoutState(_initial: RoomLayout = INITIAL_LAYOUT): UseLayoutStateResult {
  const layout = useLayout();
  const activeFloorIndex = useActiveFloorIndex();
  const actions = useLayoutActions();

  const activeFloor = layout.floors[activeFloorIndex] ?? layout.floors[0] ?? INITIAL_GROUND_FLOOR;

  return { layout, activeFloorIndex, activeFloor, actions };
}
