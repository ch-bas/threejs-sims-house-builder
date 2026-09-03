'use client';

// ---------------------------------------------------------------------------
// POC — Zustand layout store (target pattern for issue #3)
// ---------------------------------------------------------------------------
//
// This is the SINGLE SOURCE OF TRUTH for layout state and the pattern the
// maintainer is evaluating before migrating all ~35 panels off React Context.
//
// Key ideas demonstrated here:
//   • The store REUSES the existing `layoutReducer` verbatim — no reducer logic
//     is reimplemented, so behavior is identical and the 153-test reducer suite
//     still fully covers state transitions.
//   • Panels subscribe via ATOMIC selectors (e.g. `useLayoutStore((s) => s.layout.name)`)
//     and therefore re-render ONLY when their own slice changes, not on every
//     unrelated layout mutation (moving furniture no longer re-renders the
//     lot-badge, floor switcher, etc.).
//   • React Context is retained as a passthrough: `use-layout-state.ts` is now a
//     thin adapter that reads from this store, so the ~30 not-yet-migrated panels
//     keep working UNCHANGED. Migration can proceed panel-by-panel.
// ---------------------------------------------------------------------------

import { createStore, useStore } from 'zustand';
import { randomId, randomSuffix } from '../lib/ids';
import {
  layoutReducer,
  INITIAL_GROUND_FLOOR,
  INITIAL_LAYOUT,
  type LayoutAction,
  type LayoutState,
} from './layout-reducer';
import type { LayoutActions } from './use-layout-state';
import type {
  CatalogItem,
  FloorLayout,
  FurnitureItem,
  FloorPattern,
  FloorPlanFitMode,
  InteriorWall,
  RoofStyle,
  RoomLayout,
  SofaShape,
  WallId,
  WallPattern,
} from '../lib/types';

const nextId = randomId;

interface LayoutStoreState extends LayoutState {
  readonly actions: LayoutActions;
}

// A store (not a hook) so state lives outside the React tree and can be read by
// atomic selectors from any component. The actions facade is created ONCE inside
// the initializer, so `useLayoutActions()` returns a stable reference forever.
export const layoutStore = createStore<LayoutStoreState>()((set) => {
  // Internal dispatch: delegate to the existing reducer, never reimplement it.
  const dispatch = (action: LayoutAction): void => {
    set((state) => layoutReducer(state, action));
  };

  const actions: LayoutActions = {
    setName: (name) => dispatch({ type: 'setName', name }),
    setWidth: (width) => dispatch({ type: 'setWidth', width }),
    setHeight: (height) => dispatch({ type: 'setHeight', height }),
    setFloorColor: (color) => dispatch({ type: 'setFloorColor', color }),
    setFloorPattern: (pattern: FloorPattern) => dispatch({ type: 'setFloorPattern', pattern }),
    setWallPattern: (pattern: WallPattern) => dispatch({ type: 'setWallPattern', pattern }),
    setWallColor: (wall: WallId, color: string | null) => dispatch({ type: 'setWallColor', wall, color }),
    setInteriorWallColor: (id: string, color: string) => dispatch({ type: 'setInteriorWallColor', id, color }),
    setFloorPlan: (image) => dispatch({ type: 'setFloorPlan', image }),
    setFloorPlanOpacity: (opacity) => dispatch({ type: 'setFloorPlanOpacity', opacity }),
    setFloorPlanFitMode: (mode: FloorPlanFitMode) => dispatch({ type: 'setFloorPlanFitMode', mode }),
    setRoofStyle: (style: RoofStyle) => dispatch({ type: 'setRoofStyle', style }),
    setRoofColor: (color) => dispatch({ type: 'setRoofColor', color }),
    addCatalogItem: (catalogItem: CatalogItem, position) => {
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
    updateItem: (id, patch: Partial<FurnitureItem>) => dispatch({ type: 'updateItem', id, patch }),
    setSofaShape: (id, shape: SofaShape) => dispatch({ type: 'setSofaShape', id, shape }),
    setSignalRange: (id, range) => dispatch({ type: 'setSignalRange', id, range }),
    setColor: (id, color) => dispatch({ type: 'setColor', id, color }),
    setLocked: (id, locked) => dispatch({ type: 'setLocked', id, locked }),
    toggleMirror: (id) => dispatch({ type: 'toggleMirror', id }),
    setRotation: (id, rotation) => dispatch({ type: 'setRotation', id, rotation }),
    replaceItems: (items: FurnitureItem[]) => dispatch({ type: 'replaceItems', items }),
    addItems: (items: FurnitureItem[]) => dispatch({ type: 'addItems', items }),
    bulkSetPositions: (positions) => dispatch({ type: 'bulkSetPositions', positions }),
    addInteriorWall: (wall: InteriorWall) => dispatch({ type: 'addInteriorWall', wall }),
    addInteriorWalls: (walls: readonly InteriorWall[]) => dispatch({ type: 'addInteriorWalls', walls }),
    removeInteriorWall: (id) => dispatch({ type: 'removeInteriorWall', id }),
    clearInteriorWalls: () => dispatch({ type: 'clearInteriorWalls' }),
    toggleExteriorWall: (wallId: WallId) => dispatch({ type: 'toggleExteriorWall', wallId }),
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
      // Randomness lives here, not in the reducer: the reducer must stay pure
      // (StrictMode double-invokes updaters), so the per-duplication suffix
      // that de-collides cloned item/wall ids is passed in via the action.
      dispatch({ type: 'duplicateFloor', sourceIndex, newId, idSuffix: randomSuffix() });
      return newId;
    },
    removeFloor: (index) => dispatch({ type: 'removeFloor', index }),
    renameFloor: (index, name) => dispatch({ type: 'renameFloor', index, name }),
    reorderFloor: (from, to) => dispatch({ type: 'reorderFloor', from, to }),

    applyLayout: (next: RoomLayout) => dispatch({ type: 'applyLayout', layout: next }),
  };

  return {
    layout: INITIAL_LAYOUT,
    activeFloorIndex: 0,
    actions,
  };
});

// Raw hook for arbitrary atomic selectors:
//   const name = useLayoutStore((s) => s.layout.name);
export function useLayoutStore<T>(selector: (state: LayoutStoreState) => T): T {
  return useStore(layoutStore, selector);
}

// Convenience selector hooks -------------------------------------------------

export function useLayout(): RoomLayout {
  return useStore(layoutStore, (s) => s.layout);
}

export function useActiveFloorIndex(): number {
  return useStore(layoutStore, (s) => s.activeFloorIndex);
}

export function useActiveFloor(): FloorLayout {
  return useStore(layoutStore, (s) => {
    const { layout, activeFloorIndex } = s;
    return layout.floors[activeFloorIndex] ?? layout.floors[0] ?? INITIAL_GROUND_FLOOR;
  });
}

// Actions are created once and never change identity, so this hook never causes
// a re-render on its own.
export function useLayoutActions(): LayoutActions {
  return useStore(layoutStore, (s) => s.actions);
}
