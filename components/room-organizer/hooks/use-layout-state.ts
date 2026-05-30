import { useMemo, useReducer } from 'react';
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
import {
  layoutReducer,
  INITIAL_GROUND_FLOOR,
  INITIAL_LAYOUT,
  type LayoutAction,
  type LayoutState,
} from './layout-reducer';

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
  removeInteriorWall(id: string): void;
  clearInteriorWalls(): void;
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
// Hook
// ---------------------------------------------------------------------------

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function useLayoutState(initial: RoomLayout = INITIAL_LAYOUT): UseLayoutStateResult {
  const [state, dispatch] = useReducer(layoutReducer, { layout: initial, activeFloorIndex: 0 } satisfies LayoutState);
  const { layout, activeFloorIndex } = state;

  const actions = useMemo<LayoutActions>(
    () => ({
      setName: (name) => dispatch({ type: 'setName', name }),
      setWidth: (width) => dispatch({ type: 'setWidth', width }),
      setHeight: (height) => dispatch({ type: 'setHeight', height }),
      setFloorColor: (color) => dispatch({ type: 'setFloorColor', color }),
      setFloorPattern: (pattern) => dispatch({ type: 'setFloorPattern', pattern }),
      setWallPattern: (pattern) => dispatch({ type: 'setWallPattern', pattern }),
      setWallColor: (wall, color) => dispatch({ type: 'setWallColor', wall, color }),
      setFloorPlan: (image) => dispatch({ type: 'setFloorPlan', image }),
      setFloorPlanOpacity: (opacity) => dispatch({ type: 'setFloorPlanOpacity', opacity }),
      setFloorPlanFitMode: (mode) => dispatch({ type: 'setFloorPlanFitMode', mode }),
      setRoofStyle: (style) => dispatch({ type: 'setRoofStyle', style }),
      setRoofColor: (color) => dispatch({ type: 'setRoofColor', color }),
      addCatalogItem: (catalogItem, position) => {
        const id = nextId(catalogItem.type);
        dispatch({ type: 'addCatalogItem', catalogItem, id, ...(position ? { position } : {}) });
        return id;
      },
      removeItem: (id) => dispatch({ type: 'removeItem', id }),
      duplicateItem: (id) => {
        const newId = nextId('copy');
        dispatch({ type: 'duplicateItem', sourceId: id, newId });
        return newId;
      },
      rotateItem: (id) => dispatch({ type: 'rotateItem', id }),
      moveItem: (id, x, z) => dispatch({ type: 'moveItem', id, x, z }),
      resizeItem: (id, dimension, value) => dispatch({ type: 'resizeItem', id, dimension, value }),
      setSofaShape: (id, shape) => dispatch({ type: 'setSofaShape', id, shape }),
      setSignalRange: (id, range) => dispatch({ type: 'setSignalRange', id, range }),
      setColor: (id, color) => dispatch({ type: 'setColor', id, color }),
      setLocked: (id, locked) => dispatch({ type: 'setLocked', id, locked }),
      toggleMirror: (id) => dispatch({ type: 'toggleMirror', id }),
      setRotation: (id, rotation) => dispatch({ type: 'setRotation', id, rotation }),
      replaceItems: (items) => dispatch({ type: 'replaceItems', items }),
      addItems: (items) => dispatch({ type: 'addItems', items }),
      bulkSetPositions: (positions) => dispatch({ type: 'bulkSetPositions', positions }),
      addInteriorWall: (wall) => dispatch({ type: 'addInteriorWall', wall }),
      removeInteriorWall: (id) => dispatch({ type: 'removeInteriorWall', id }),
      clearInteriorWalls: () => dispatch({ type: 'clearInteriorWalls' }),
      rotateSelection: (ids, radians) => dispatch({ type: 'rotateSelection', ids, radians }),
      setLockAll: (locked) => dispatch({ type: 'setLockAll', locked }),
      clearItems: () => dispatch({ type: 'clearItems' }),

      setActiveFloorIndex: (index) => dispatch({ type: 'setActiveFloorIndex', index }),
      addFloor: () => {
        const id = nextId('floor');
        dispatch({
          type: 'addFloor',
          floor: { id, items: [], floorColor: '#c9a57d', floorPattern: 'wood' },
        });
        return id;
      },
      duplicateFloor: (sourceIndex) => {
        const newId = nextId('floor');
        dispatch({ type: 'duplicateFloor', sourceIndex, newId });
        return newId;
      },
      removeFloor: (index) => dispatch({ type: 'removeFloor', index }),
      renameFloor: (index, name) => dispatch({ type: 'renameFloor', index, name }),
      reorderFloor: (from, to) => dispatch({ type: 'reorderFloor', from, to }),

      applyLayout: (next) => dispatch({ type: 'applyLayout', layout: next }),
    }),
    []
  );

  const activeFloor = layout.floors[activeFloorIndex] ?? layout.floors[0] ?? INITIAL_GROUND_FLOOR;

  return { layout, activeFloorIndex, activeFloor, actions };
}
