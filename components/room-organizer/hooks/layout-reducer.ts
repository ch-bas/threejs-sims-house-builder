import { MAX_FLOORS } from '../lib/constants';
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

// ---------------------------------------------------------------------------
// Action union
// ---------------------------------------------------------------------------

export type LayoutAction =
  | { type: 'setName'; name: string }
  | { type: 'setWidth'; width: number }
  | { type: 'setHeight'; height: number }
  // floor-scoped finishes — target the active floor
  | { type: 'setFloorColor'; color: string }
  | { type: 'setFloorPattern'; pattern: FloorPattern }
  | { type: 'setWallPattern'; pattern: WallPattern }
  | { type: 'setWallColor'; wall: WallId; color: string | null }
  // floor-scoped items — target the active floor
  | { type: 'addCatalogItem'; catalogItem: CatalogItem; id: string; position?: { x: number; z: number } }
  | { type: 'removeItem'; id: string }
  | { type: 'updateItem'; id: string; patch: Partial<FurnitureItem> }
  | { type: 'duplicateItem'; sourceId: string; newId: string }
  | { type: 'rotateItem'; id: string }
  | { type: 'moveItem'; id: string; x: number; z: number }
  | { type: 'resizeItem'; id: string; dimension: 'width' | 'depth' | 'height'; value: number }
  | { type: 'setSofaShape'; id: string; shape: SofaShape }
  | { type: 'setSignalRange'; id: string; range: number }
  | { type: 'setColor'; id: string; color: string }
  | { type: 'setLocked'; id: string; locked: boolean }
  | { type: 'toggleMirror'; id: string }
  | { type: 'setRotation'; id: string; rotation: number }
  | { type: 'replaceItems'; items: FurnitureItem[] }
  | { type: 'addItems'; items: FurnitureItem[] }
  | { type: 'bulkSetPositions'; positions: ReadonlyMap<string, { x: number; z: number }> }
  | { type: 'addInteriorWall'; wall: InteriorWall }
  | { type: 'removeInteriorWall'; id: string }
  | { type: 'clearInteriorWalls' }
  | { type: 'rotateSelection'; ids: ReadonlySet<string>; radians: number }
  | { type: 'setLockAll'; locked: boolean }
  | { type: 'clearItems' }
  // floor / building operations
  | { type: 'setActiveFloorIndex'; index: number }
  | { type: 'addFloor'; floor: Omit<FloorLayout, 'name'> & { name?: string } }
  | { type: 'duplicateFloor'; sourceIndex: number; newId: string }
  | { type: 'removeFloor'; index: number }
  | { type: 'renameFloor'; index: number; name: string }
  | { type: 'reorderFloor'; from: number; to: number }
  | { type: 'setFloorPlan'; image: string | null }
  | { type: 'setFloorPlanOpacity'; opacity: number }
  | { type: 'setFloorPlanFitMode'; mode: FloorPlanFitMode }
  | { type: 'setRoofStyle'; style: RoofStyle }
  | { type: 'setRoofColor'; color: string }
  | { type: 'applyLayout'; layout: RoomLayout };

// ---------------------------------------------------------------------------
// State shape + defaults
// ---------------------------------------------------------------------------

export interface LayoutState {
  readonly layout: RoomLayout;
  readonly activeFloorIndex: number;
}

export const INITIAL_GROUND_FLOOR: FloorLayout = {
  id: 'ground',
  name: 'Ground Floor',
  floorColor: '#c9a57d',
  floorPattern: 'wood',
  items: [],
};

export const INITIAL_LAYOUT: RoomLayout = {
  name: 'My Home',
  width: 8,
  height: 8,
  floors: [INITIAL_GROUND_FLOOR],
  roof: { style: 'gable', color: '#5d3a23' },
  floorPlanOpacity: 0.5,
  floorPlanFitMode: 'stretch',
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    // -- building-level properties ------------------------------------------
    case 'setName':
      return withLayout(state, (layout) => ({ ...layout, name: action.name }));
    case 'setWidth':
      return withLayout(state, (layout) => ({ ...layout, width: action.width }));
    case 'setHeight':
      return withLayout(state, (layout) => ({ ...layout, height: action.height }));

    // -- floor-scoped finishes ----------------------------------------------
    case 'setFloorColor':
      return withActiveFloor(state, (floor) => ({ ...floor, floorColor: action.color }));
    case 'setFloorPattern':
      return withActiveFloor(state, (floor) => ({ ...floor, floorPattern: action.pattern }));
    case 'setWallPattern':
      return withActiveFloor(state, (floor) => ({ ...floor, wallPattern: action.pattern }));
    case 'setWallColor':
      return withActiveFloor(state, (floor) => {
        const next = { ...(floor.wallColors ?? {}) };
        if (action.color === null) delete next[action.wall];
        else next[action.wall] = action.color;
        return { ...floor, wallColors: next };
      });

    // -- floor plan ---------------------------------------------------------
    case 'setFloorPlan': {
      if (action.image === null) {
        return withLayout(state, (layout) => {
          const next = { ...layout };
          delete next.floorPlanImage;
          return next;
        });
      }
      return withLayout(state, (layout) => ({ ...layout, floorPlanImage: action.image! }));
    }
    case 'setFloorPlanOpacity':
      return withLayout(state, (layout) => ({ ...layout, floorPlanOpacity: action.opacity }));
    case 'setFloorPlanFitMode':
      return withLayout(state, (layout) => ({ ...layout, floorPlanFitMode: action.mode }));

    // -- roof ---------------------------------------------------------------
    case 'setRoofStyle':
      return withLayout(state, (layout) => ({
        ...layout,
        roof: { ...(layout.roof ?? { style: 'none' }), style: action.style },
      }));
    case 'setRoofColor':
      return withLayout(state, (layout) => ({
        ...layout,
        roof: { ...(layout.roof ?? { style: 'flat' }), color: action.color },
      }));

    // -- item CRUD ----------------------------------------------------------
    case 'addCatalogItem': {
      const newItem: FurnitureItem = {
        ...action.catalogItem,
        id: action.id,
        position: action.position ?? { x: 0, z: 0 },
        rotation: 0,
        ...(action.catalogItem.type === 'sofa' ? { sofaShape: 'standard' as const } : {}),
      };
      return withActiveFloor(state, (floor) => ({ ...floor, items: [...floor.items, newItem] }));
    }

    case 'removeItem':
      return withActiveFloor(state, (floor) => ({
        ...floor,
        items: floor.items.filter((item) => item.id !== action.id),
      }));

    case 'updateItem':
      return withActiveFloor(state, (floor) => ({
        ...floor,
        items: floor.items.map((item) =>
          item.id === action.id ? { ...item, ...action.patch } : item
        ),
      }));

    case 'duplicateItem':
      return withActiveFloor(state, (floor) => {
        const source = floor.items.find((item) => item.id === action.sourceId);
        if (!source) return floor;
        const position = source.position ?? { x: 0, z: 0 };
        const copy: FurnitureItem = {
          ...source,
          id: action.newId,
          position: { x: position.x + 0.5, z: position.z + 0.5 },
        };
        return { ...floor, items: [...floor.items, copy] };
      });

    case 'rotateItem':
      return patchItem(state, action.id, (item) => ({
        rotation: ((item.rotation ?? 0) + Math.PI / 2) % (Math.PI * 2),
      }));

    case 'moveItem':
      return patchItem(state, action.id, () => ({
        position: { x: action.x, z: action.z },
      }));

    case 'resizeItem':
      return patchItem(state, action.id, () => ({
        [action.dimension]: Math.max(0.1, action.value),
      }));

    case 'setSofaShape':
      return patchItem(state, action.id, () => ({ sofaShape: action.shape }));

    case 'setSignalRange':
      return patchItem(state, action.id, () => ({ signalRange: action.range }));

    case 'setColor':
      return patchItem(state, action.id, () => ({ color: action.color }));

    case 'setLocked':
      return patchItem(state, action.id, () => ({ locked: action.locked }));

    case 'toggleMirror':
      return patchItem(state, action.id, (item) => ({ mirrored: !item.mirrored }));

    case 'setRotation':
      return patchItem(state, action.id, () => ({ rotation: action.rotation }));

    // -- bulk item operations -----------------------------------------------
    case 'replaceItems':
      return withActiveFloor(state, (floor) => ({ ...floor, items: action.items }));

    case 'addItems':
      return withActiveFloor(state, (floor) => ({ ...floor, items: [...floor.items, ...action.items] }));

    case 'bulkSetPositions':
      return withActiveFloor(state, (floor) => ({
        ...floor,
        items: floor.items.map((item) => {
          const next = action.positions.get(item.id);
          return next ? { ...item, position: { x: next.x, z: next.z } } : item;
        }),
      }));

    case 'rotateSelection':
      return withActiveFloor(state, (floor) => ({
        ...floor,
        items: floor.items.map((item) =>
          action.ids.has(item.id)
            ? { ...item, rotation: ((item.rotation ?? 0) + action.radians) % (Math.PI * 2) }
            : item
        ),
      }));

    case 'setLockAll':
      return withActiveFloor(state, (floor) => ({
        ...floor,
        items: floor.items.map((item) => ({ ...item, locked: action.locked })),
      }));

    case 'clearItems':
      return withActiveFloor(state, (floor) => ({ ...floor, items: [] }));

    // -- interior walls -----------------------------------------------------
    case 'addInteriorWall':
      return withActiveFloor(state, (floor) => ({
        ...floor,
        interiorWalls: [...(floor.interiorWalls ?? []), action.wall],
      }));

    case 'removeInteriorWall':
      return withActiveFloor(state, (floor) => ({
        ...floor,
        interiorWalls: (floor.interiorWalls ?? []).filter((wall) => wall.id !== action.id),
      }));

    case 'clearInteriorWalls':
      return withActiveFloor(state, (floor) => ({ ...floor, interiorWalls: [] }));

    // -- floor / building operations ----------------------------------------
    case 'setActiveFloorIndex':
      return { ...state, activeFloorIndex: clampActiveIndex(action.index, state.layout.floors.length) };

    case 'addFloor': {
      if (state.layout.floors.length >= MAX_FLOORS) return state;
      const name = action.floor.name ?? defaultFloorName(state.layout.floors);
      const floor: FloorLayout = { ...action.floor, name };
      const floors = [...state.layout.floors, floor];
      return {
        layout: { ...state.layout, floors },
        activeFloorIndex: floors.length - 1,
      };
    }

    case 'duplicateFloor': {
      if (state.layout.floors.length >= MAX_FLOORS) return state;
      const source = state.layout.floors[action.sourceIndex];
      if (!source) return state;
      const stamp = Date.now();
      const clonedItems: FurnitureItem[] = source.items.map((item, idx) => ({
        ...item,
        id: `${item.type}-${stamp}-${idx}`,
      }));
      const clonedWalls: InteriorWall[] | undefined = source.interiorWalls?.map((wall, idx) => ({
        ...wall,
        id: `wall-${stamp}-${idx}`,
      }));
      const floor: FloorLayout = {
        ...source,
        id: action.newId,
        name: `${source.name} copy`,
        items: clonedItems,
        ...(clonedWalls ? { interiorWalls: clonedWalls } : {}),
      };
      const floors = [...state.layout.floors, floor];
      return { layout: { ...state.layout, floors }, activeFloorIndex: floors.length - 1 };
    }

    case 'removeFloor': {
      if (state.layout.floors.length <= 1) return state;
      const floors = state.layout.floors.filter((_, index) => index !== action.index);
      return {
        layout: { ...state.layout, floors },
        activeFloorIndex: clampActiveIndex(state.activeFloorIndex, floors.length),
      };
    }

    case 'renameFloor': {
      const floors = state.layout.floors.map((floor, index) =>
        index === action.index ? { ...floor, name: action.name } : floor
      );
      return { ...state, layout: { ...state.layout, floors } };
    }

    case 'reorderFloor': {
      const { from, to } = action;
      if (from === to || from < 0 || to < 0) return state;
      if (from >= state.layout.floors.length || to >= state.layout.floors.length) return state;
      const floors = [...state.layout.floors];
      const [moved] = floors.splice(from, 1);
      if (moved !== undefined) floors.splice(to, 0, moved);
      return {
        layout: { ...state.layout, floors },
        activeFloorIndex: clampActiveIndex(to, floors.length),
      };
    }

    case 'applyLayout': {
      const layout = normaliseLayout(action.layout);
      return { layout, activeFloorIndex: 0 };
    }

    default:
      return assertNever(action);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withLayout(state: LayoutState, update: (layout: RoomLayout) => RoomLayout): LayoutState {
  return { ...state, layout: update(state.layout) };
}

function withActiveFloor(state: LayoutState, update: (floor: FloorLayout) => FloorLayout): LayoutState {
  const floors = state.layout.floors;
  const current = floors[state.activeFloorIndex];
  if (!current) return state;
  const next = update(current);
  if (next === current) return state;
  const nextFloors = floors.map((floor, index) => (index === state.activeFloorIndex ? next : floor));
  return { ...state, layout: { ...state.layout, floors: nextFloors } };
}

function patchItem(
  state: LayoutState,
  id: string,
  patch: (item: FurnitureItem) => Partial<FurnitureItem>
): LayoutState {
  return withActiveFloor(state, (floor) => ({
    ...floor,
    items: floor.items.map((item) =>
      item.id === id ? { ...item, ...patch(item) } : item
    ),
  }));
}

function normaliseLayout(layout: RoomLayout): RoomLayout {
  if (layout.floors.length === 0) {
    return { ...layout, floors: [INITIAL_GROUND_FLOOR] };
  }
  return {
    ...layout,
    floors: layout.floors.map((floor) => ({
      ...floor,
      floorColor: floor.floorColor || '#c9a57d',
    })),
  };
}

function clampActiveIndex(index: number, floorCount: number): number {
  if (floorCount <= 0) return 0;
  return Math.max(0, Math.min(floorCount - 1, index));
}

function assertNever(value: never): never {
  throw new Error(`Unexpected action: ${JSON.stringify(value)}`);
}

const FLOOR_NAMES = ['First Floor', 'Second Floor', 'Third Floor', 'Fourth Floor'] as const;

function defaultFloorName(existing: ReadonlyArray<FloorLayout>): string {
  if (existing.length === 0) return 'Ground Floor';
  const fallback = FLOOR_NAMES[existing.length - 1];
  return fallback ?? `Floor ${existing.length + 1}`;
}
