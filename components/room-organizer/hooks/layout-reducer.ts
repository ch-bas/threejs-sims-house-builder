import { DEFAULT_ROOF, FURNITURE_CATALOG, MAX_FLOORS, MAX_ITEM_DIMENSION, MAX_ROOM_DIMENSION } from '../lib/constants';
import { MAX_DORMERS, clampDormer } from '../lib/dormers';
import { rotatedHalfExtents } from '../lib/geometry';
import { settleWallMountedItem } from '../lib/opening-snap';
import { clampTerrainY } from '../lib/site';
import { MAX_STAIRS_LEAD_IN } from '../lib/stairs';
import { clampStoreyHeight, storeyHeight } from '../lib/storeys';
import {
  ENTRANCE_DOOR_ID,
  ENTRANCE_LIMITS,
  ENTRANCE_WALL_ID,
  MAX_SILL_HEIGHT,
  MIN_SILL_HEIGHT,
  clampEntrance,
  entranceBackWall,
  entranceFloorIndex,
  entranceGeometry,
  sameEntrance,
  streetLevel,
} from '../lib/street';
import type {
  CatalogItem,
  DormerSpec,
  EntranceSpec,
  FloorLayout,
  FloorPattern,
  FloorPlanFitMode,
  Frontage,
  FurnitureItem,
  InteriorWall,
  NeighbourSide,
  RoofStyle,
  RoomLayout,
  SofaShape,
  StairsShape,
  TerrainSpec,
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
  | { type: 'setStoreyHeight'; height: number | null }
  | { type: 'setWallColor'; wall: WallId; color: string | null }
  | { type: 'setInteriorWallColor'; id: string; color: string }
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
  | { type: 'addInteriorWalls'; walls: readonly InteriorWall[] }
  | { type: 'removeInteriorWall'; id: string }
  | { type: 'toggleExteriorWall'; wallId: WallId }
  | { type: 'clearInteriorWalls' }
  | { type: 'rotateSelection'; ids: ReadonlySet<string>; radians: number }
  | { type: 'setLockAll'; locked: boolean }
  | { type: 'clearItems' }
  // floor / building operations
  | { type: 'setActiveFloorIndex'; index: number }
  | { type: 'addFloor'; floor: Omit<FloorLayout, 'name'> & { name?: string } }
  | { type: 'duplicateFloor'; sourceIndex: number; newId: string; idSuffix: string }
  | { type: 'removeFloor'; index: number }
  | { type: 'renameFloor'; index: number; name: string }
  | { type: 'reorderFloor'; from: number; to: number }
  | { type: 'setFloorPlan'; image: string | null }
  | { type: 'setFloorPlanOpacity'; opacity: number }
  | { type: 'setFloorPlanFitMode'; mode: FloorPlanFitMode }
  | { type: 'setRoofStyle'; style: RoofStyle }
  | { type: 'setRoofColor'; color: string }
  | { type: 'addDormer'; dormer: DormerSpec }
  | { type: 'updateDormer'; id: string; patch: Partial<Omit<DormerSpec, 'id'>> }
  | { type: 'removeDormer'; id: string }
  | { type: 'setTerrain'; terrain: TerrainSpec | null }
  | { type: 'setNeighbour'; side: NeighbourSide; present: boolean }
  | { type: 'setEntrance'; entrance: EntranceSpec | null }
  | { type: 'setFrontage'; frontage: Frontage }
  | { type: 'setSillHeight'; id: string; sillHeight: number | null }
  | { type: 'setStairsShape'; id: string; shape: StairsShape; leadIn?: number }
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
  roof: DEFAULT_ROOF,
  floorPlanOpacity: 0.5,
  floorPlanFitMode: 'stretch',
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Actions that move the street storey or the front wall. After any of them
 * the entrance's back wall and door are re-fitted (#204); applyLayout is
 * deliberately absent — undo/redo and loads must restore state verbatim.
 */
const ENTRANCE_RESYNC_ACTIONS: ReadonlySet<LayoutAction['type']> = new Set([
  'setWidth',
  'setHeight',
  'setTerrain',
  'setStoreyHeight',
  'addFloor',
  'duplicateFloor',
  'removeFloor',
  'reorderFloor',
]);

/**
 * Actions through which the user can delete the porch door. When one of
 * them takes the door away, that intent is recorded on the entrance, so a
 * later re-fit doesn't bring the door back; a re-fit that removes the door
 * itself (a momentarily unbuildable recess, a removed storey) leaves the
 * flag alone and re-creates the door once the recess is back (#273).
 */
const DOOR_REMOVAL_ACTIONS: ReadonlySet<LayoutAction['type']> = new Set(['removeItem', 'replaceItems', 'clearItems']);

export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  const next = reduceLayout(state, action);
  const entrance = next.layout.entrance;
  if (next === state || !entrance) return next;
  if (DOOR_REMOVAL_ACTIONS.has(action.type) && entrance.door === undefined) {
    if (findEntranceDoor(state.layout.floors) && !findEntranceDoor(next.layout.floors)) {
      return { ...next, layout: { ...next.layout, entrance: { ...entrance, door: false } } };
    }
    return next;
  }
  if (!ENTRANCE_RESYNC_ACTIONS.has(action.type)) return next;
  // The pre-action layout is the fallback for the door and the wall's
  // colour: removeFloor takes the street storey away with them on it.
  const layout = syncEntrance(next.layout, entrance, state.layout);
  return layout === next.layout ? next : { ...next, layout };
}

function reduceLayout(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    // -- building-level properties ------------------------------------------
    case 'setName':
      return withLayout(state, (layout) => ({ ...layout, name: action.name }));
    // Width/height must be clamped here, not only in normaliseLayout: an
    // out-of-range dimension that reaches localStorage fails schema validation
    // on the next load, and the fallback layout then autosaves over the
    // user's house (#113).
    case 'setWidth':
      return withLayout(state, (layout) => {
        const width = clampRoomDimension(action.width);
        return width === layout.width ? layout : { ...layout, width };
      });
    case 'setHeight':
      return withLayout(state, (layout) => {
        const height = clampRoomDimension(action.height);
        return height === layout.height ? layout : { ...layout, height };
      });

    // -- site (#202) -------------------------------------------------------
    // Clamped here too, so an out-of-range slope can't reach the save and
    // fail validation on the next load (#113). `null` returns to flat ground.
    case 'setTerrain':
      return withLayout(state, (layout) => {
        if (action.terrain === null) {
          if (layout.terrain === undefined) return layout;
          const { terrain: _flat, ...rest } = layout;
          return rest;
        }
        const terrain = clampTerrain(action.terrain);
        // A re-typed value keeps identity: no undo entry, no autosave (#279).
        if (layout.terrain?.frontY === terrain.frontY && layout.terrain.backY === terrain.backY) return layout;
        return { ...layout, terrain };
      });
    // A recessed entrance (#204) owns an interior wall across the back of the
    // recess and, when first added, an ordinary door on it. Both follow the
    // recess as it's resized or moved, onto whichever storey meets the street.
    case 'setEntrance':
      return withLayout(state, (layout) => syncEntrance(layout, action.entrance));
    case 'setFrontage':
      return withLayout(state, (layout) => {
        if ((layout.frontage ?? 'garden') === action.frontage) return layout;
        if (action.frontage === 'pavement') return { ...layout, frontage: 'pavement' };
        const { frontage: _garden, ...rest } = layout;
        return rest;
      });

    case 'setNeighbour':
      return withLayout(state, (layout) => {
        if ((layout.neighbours?.[action.side] === true) === action.present) return layout;
        const neighbours = { ...layout.neighbours };
        if (action.present) neighbours[action.side] = true;
        else delete neighbours[action.side];
        if (Object.keys(neighbours).length > 0) return { ...layout, neighbours };
        const { neighbours: _none, ...rest } = layout;
        return rest;
      });

    // -- floor-scoped finishes ----------------------------------------------
    case 'setFloorColor':
      return withActiveFloor(state, (floor) => ({ ...floor, floorColor: action.color }));
    case 'setFloorPattern':
      return withActiveFloor(state, (floor) => ({ ...floor, floorPattern: action.pattern }));
    case 'setWallPattern':
      return withActiveFloor(state, (floor) => ({ ...floor, wallPattern: action.pattern }));
    // Clamped like the room dimensions: an out-of-range height reaching
    // localStorage would fail validation on the next load (#113, #202).
    // `null` restores the default storey by dropping the field.
    case 'setStoreyHeight':
      return withActiveFloor(state, (floor) => {
        if (action.height === null) {
          if (floor.height === undefined) return floor;
          const { height: _dropped, ...rest } = floor;
          return rest;
        }
        const height = clampStoreyHeight(action.height);
        // Re-typing the height a floor already has — explicit or the 3 m
        // default — is a no-op: storing an explicit default would add a
        // Reset button and change the stair rise for nothing (#279).
        return storeyHeight(floor) === height ? floor : { ...floor, height };
      });
    case 'setWallColor':
      return withActiveFloor(state, (floor) => {
        const next = { ...(floor.wallColors ?? {}) };
        if (action.color === null) delete next[action.wall];
        else next[action.wall] = action.color;
        return { ...floor, wallColors: next };
      });
    case 'setInteriorWallColor':
      return withActiveFloor(state, (floor) => ({
        ...floor,
        interiorWalls: (floor.interiorWalls ?? []).map((wall) =>
          wall.id === action.id ? { ...wall, color: action.color } : wall
        ),
      }));

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

    // -- dormers (#203) -----------------------------------------------------
    // Clamped on the way in so a stray value can't fail validation on reload.
    case 'addDormer':
      return withLayout(state, (layout) => {
        const dormers = layout.roof?.dormers ?? [];
        if (dormers.length >= MAX_DORMERS) return layout;
        const roof = layout.roof ?? DEFAULT_ROOF;
        return { ...layout, roof: { ...roof, dormers: [...dormers, clampDormer(action.dormer)] } };
      });
    case 'updateDormer':
      return withLayout(state, (layout) => {
        const dormers = layout.roof?.dormers;
        if (!layout.roof || !dormers?.some((d) => d.id === action.id)) return layout;
        const next = dormers.map((d) => (d.id === action.id ? clampDormer({ ...d, ...action.patch, id: d.id }) : d));
        return { ...layout, roof: { ...layout.roof, dormers: next } };
      });
    case 'removeDormer':
      return withLayout(state, (layout) => {
        const dormers = layout.roof?.dormers;
        if (!layout.roof || !dormers?.some((d) => d.id === action.id)) return layout;
        const next = dormers.filter((d) => d.id !== action.id);
        if (next.length > 0) return { ...layout, roof: { ...layout.roof, dormers: next } };
        const { dormers: _none, ...roof } = layout.roof;
        return { ...layout, roof };
      });

    // -- item CRUD ----------------------------------------------------------
    case 'addCatalogItem': {
      const newItem: FurnitureItem = {
        ...action.catalogItem,
        id: action.id,
        locked: true,
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
        const offset = { x: position.x + 0.5, z: position.z + 0.5 };
        // The raw +0.5/+0.5 offset stranded duplicated doors/windows/cameras
        // off their wall and pushed copies near the +x/+z walls outside the
        // room (#116): wall-mounted copies re-snap onto the wall (shifted
        // along it) and indoor items clamp to the footprint. Outdoor items
        // belong outside and keep the raw offset.
        const settled = settleWallMountedItem(
          source,
          offset,
          state.layout.width,
          state.layout.height,
          floor.interiorWalls ?? []
        );
        const copy: FurnitureItem = settled
          ? { ...source, id: action.newId, ...settled }
          : {
              ...source,
              id: action.newId,
              position:
                source.category === 'outdoor'
                  ? offset
                  : clampToFootprint(source, offset, state.layout.width, state.layout.height),
            };
        return { ...floor, items: [...floor.items, copy] };
      });

    // Geometry mutations enforce the lock IN the reducer (same strategy as
    // bulkSetPositions' #115 guard) and re-run the wall settle rule, so no
    // panel or future caller can move a locked item or strand a door,
    // window, or camera off its wall (#209, #210). `updateItem` stays
    // unguarded on purpose — it is the internal channel for derived
    // placement (drag settles, camera reseats).
    case 'rotateItem':
      return patchItem(state, action.id, (item) => {
        if (item.locked) return null;
        // Flush cameras only face in or out along their wall's normal —
        // step π; everything else quarter-turns (same rule as the viewport
        // rotate handler).
        const step =
          item.type === 'security-camera' && !item.cameraBracket ? Math.PI : Math.PI / 2;
        const rotation = ((item.rotation ?? 0) + step) % (Math.PI * 2);
        const settled = item.position
          ? settleWallMountedItem(
              { ...item, rotation },
              item.position,
              state.layout.width,
              state.layout.height,
              activeInteriorWalls(state)
            )
          : null;
        return { rotation, ...settled };
      });

    case 'moveItem':
      return patchItem(state, action.id, (item) => {
        if (item.locked) return null;
        const position = { x: action.x, z: action.z };
        const settled = settleWallMountedItem(
          item,
          position,
          state.layout.width,
          state.layout.height,
          activeInteriorWalls(state)
        );
        return settled ?? { position };
      });

    case 'resizeItem':
      return patchItem(state, action.id, (item) => {
        // Clamp like the room dimensions (#113): a non-finite or oversized
        // value that reached localStorage would fail schema validation on
        // the next load and cost the whole save.
        if (item.locked || !Number.isFinite(action.value)) return null;
        return {
          [action.dimension]: Math.min(MAX_ITEM_DIMENSION, Math.max(0.1, action.value)),
        };
      });

    case 'setSofaShape':
      return patchItem(state, action.id, () => ({ sofaShape: action.shape }));

    case 'setSillHeight':
      return patchItem(state, action.id, (item) => {
        // Geometry like a resize: refused while locked (#209), clamped (#113).
        if (item.locked || item.type !== 'window') return null;
        if (action.sillHeight === null) return item.sillHeight === undefined ? null : { sillHeight: undefined };
        if (!Number.isFinite(action.sillHeight)) return null;
        return { sillHeight: Math.min(MAX_SILL_HEIGHT, Math.max(MIN_SILL_HEIGHT, action.sillHeight)) };
      });

    // Stair shape changes the flight and the hole above it — geometry, so
    // refused while locked (#209); the lead-in is clamped to the step count.
    case 'setStairsShape':
      return patchItem(state, action.id, (item) => {
        if (item.locked || item.type !== 'stairs') return null;
        if (action.shape === 'straight') {
          if ((item.stairsShape ?? 'straight') === 'straight' && item.stairsLeadIn === undefined) return null;
          return { stairsShape: undefined, stairsLeadIn: undefined };
        }
        const leadIn = action.leadIn ?? item.stairsLeadIn ?? 0;
        const clamped = Number.isFinite(leadIn) ? Math.max(0, Math.min(MAX_STAIRS_LEAD_IN, Math.round(leadIn))) : 0;
        if (item.stairsShape === 'winder' && (item.stairsLeadIn ?? 0) === clamped) return null;
        return { stairsShape: 'winder', stairsLeadIn: clamped === 0 ? undefined : clamped };
      });

    case 'setSignalRange':
      return patchItem(state, action.id, () => ({ signalRange: action.range }));

    case 'setColor':
      return patchItem(state, action.id, () => ({ color: action.color }));

    case 'setLocked':
      return patchItem(state, action.id, () => ({ locked: action.locked }));

    case 'toggleMirror':
      return patchItem(state, action.id, (item) => ({ mirrored: !item.mirrored }));

    case 'setRotation':
      // Raw on purpose apart from the lock: this is the channel the camera
      // handlers use to set an exact facing before reseating.
      return patchItem(state, action.id, (item) =>
        item.locked ? null : { rotation: action.rotation }
      );

    // -- bulk item operations -----------------------------------------------
    case 'replaceItems':
      return withActiveFloor(state, (floor) => ({ ...floor, items: action.items }));

    case 'addItems':
      return withActiveFloor(state, (floor) => ({ ...floor, items: [...floor.items, ...action.items] }));

    case 'bulkSetPositions':
      return withActiveFloor(state, (floor) => ({
        ...floor,
        items: floor.items.map((item) => {
          // Locked items are immune to bulk moves (group drag, align,
          // distribute) — enforced here so no caller can shove them (#115).
          if (item.locked) return item;
          const next = action.positions.get(item.id);
          if (!next) return item;
          const position = { x: next.x, z: next.z };
          // Align/distribute previously parked doors and windows mid-room;
          // the settle rule applies to bulk commits like any other (#210).
          // The drag path settles before dispatching — re-settling an
          // on-wall placement is a no-op.
          const settled = settleWallMountedItem(
            item,
            position,
            state.layout.width,
            state.layout.height,
            floor.interiorWalls ?? []
          );
          return { ...item, ...(settled ?? { position }) };
        }),
      }));

    case 'rotateSelection':
      return withActiveFloor(state, (floor) => {
        // Rotate the whole group about its centroid: each selected item both
        // spins in place (its own rotation) AND orbits the centroid, so the
        // arrangement is preserved instead of every piece twisting individually.
        const selected = floor.items.filter(
          (item) => action.ids.has(item.id) && item.position
        );
        if (selected.length === 0) return floor;
        let cx = 0;
        let cz = 0;
        for (const item of selected) {
          cx += item.position!.x;
          cz += item.position!.z;
        }
        cx /= selected.length;
        cz /= selected.length;
        // `group.rotation.y = rotation` (Three RY) maps a local offset (dx, dz)
        // to world (dx·cosθ + dz·sinθ, −dx·sinθ + dz·cosθ). Use that same matrix
        // for the orbit so the position sweep matches the rendered spin.
        const theta = action.radians;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        return {
          ...floor,
          items: floor.items.map((item) => {
            // Locked items neither spin nor orbit — callers filter, but the
            // reducer is the guarantee (#115/#209).
            if (!action.ids.has(item.id) || item.locked) return item;
            const nextRotation = ((item.rotation ?? 0) + theta) % (Math.PI * 2);
            if (!item.position) {
              return { ...item, rotation: nextRotation };
            }
            const dx = item.position.x - cx;
            const dz = item.position.z - cz;
            const position = {
              x: cx + dx * cos + dz * sin,
              z: cz - dx * sin + dz * cos,
            };
            // A wall-mounted item swept to an interior point re-snaps to the
            // nearest wall instead of floating where the orbit dropped it
            // (#210) — the same rule every other commit path follows.
            const settled = settleWallMountedItem(
              { ...item, rotation: nextRotation },
              position,
              state.layout.width,
              state.layout.height,
              floor.interiorWalls ?? []
            );
            return { ...item, rotation: nextRotation, ...(settled ?? { position }) };
          }),
        };
      });

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

    // Batch insert — a room-shape stamp adds every segment in one dispatch so
    // the whole stamp is a single history/undo entry rather than N of them.
    case 'addInteriorWalls': {
      if (action.walls.length === 0) return state;
      return withActiveFloor(state, (floor) => ({
        ...floor,
        interiorWalls: [...(floor.interiorWalls ?? []), ...action.walls],
      }));
    }

    case 'removeInteriorWall':
      return withActiveFloor(state, (floor) => ({
        ...floor,
        interiorWalls: (floor.interiorWalls ?? []).filter((wall) => wall.id !== action.id),
      }));

    case 'toggleExteriorWall':
      return withActiveFloor(state, (floor) => {
        const hidden = floor.hiddenWalls ?? [];
        const isHidden = hidden.includes(action.wallId);
        return {
          ...floor,
          hiddenWalls: isHidden
            ? hidden.filter((w) => w !== action.wallId)
            : [...hidden, action.wallId],
        };
    });

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
      // `action.idSuffix` is a per-duplication random tag generated OUTSIDE the
      // reducer (see use-layout-store.ts): it alone makes the cloned ids
      // unique, keeping the reducer fully deterministic in its inputs — the
      // Date.now() stamp it used to mix in broke that purity for no extra
      // collision protection (#122).
      // The porch's back wall and door belong to the street storey only;
      // cloned under fresh ids they would outlive every re-fit (#273).
      const clonedItems: FurnitureItem[] = source.items
        .filter((item) => item.id !== ENTRANCE_DOOR_ID)
        .map((item, idx) => ({ ...item, id: `${item.type}-${action.idSuffix}-${idx}` }));
      const clonedWalls: InteriorWall[] | undefined = source.interiorWalls
        ?.filter((wall) => wall.id !== ENTRANCE_WALL_ID)
        .map((wall, idx) => ({ ...wall, id: `wall-${action.idSuffix}-${idx}` }));
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
      // Removing a floor below the active one shifts the active floor down a
      // slot; without the adjustment the editor silently switches floors.
      const nextActive =
        action.index < state.activeFloorIndex ? state.activeFloorIndex - 1 : state.activeFloorIndex;
      return {
        layout: { ...state.layout, floors },
        activeFloorIndex: clampActiveIndex(nextActive, floors.length),
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
      // The same floor stays active through the move — reordering a different
      // floor must not jump the editor to it.
      let active = state.activeFloorIndex;
      if (from === active) {
        active = to;
      } else {
        if (from < active) active -= 1;
        if (to <= active) active += 1;
      }
      return {
        layout: { ...state.layout, floors },
        activeFloorIndex: clampActiveIndex(active, floors.length),
      };
    }

    case 'applyLayout': {
      const layout = normaliseLayout(action.layout);
      // Clamp instead of resetting to 0 so undo/redo of an edit made on an
      // upper floor doesn't jump the view back to the ground floor.
      return {
        layout,
        activeFloorIndex: clampActiveIndex(state.activeFloorIndex, layout.floors.length),
      };
    }

    default:
      return assertNever(action);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withLayout(state: LayoutState, update: (layout: RoomLayout) => RoomLayout): LayoutState {
  const next = update(state.layout);
  // A no-op keeps state identity, so it never registers in undo history.
  return next === state.layout ? state : { ...state, layout: next };
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

/**
 * Patch one item on the active floor. A `null` patch means "refused" (e.g.
 * the item is locked): the state is returned with its identity intact, so a
 * refused mutation never registers as an edit in undo history or autosave.
 */
function patchItem(
  state: LayoutState,
  id: string,
  patch: (item: FurnitureItem) => Partial<FurnitureItem> | null
): LayoutState {
  return withActiveFloor(state, (floor) => {
    let changed = false;
    const items = floor.items.map((item) => {
      if (item.id !== id) return item;
      const fields = patch(item);
      if (fields === null) return item;
      changed = true;
      return { ...item, ...fields };
    });
    return changed ? { ...floor, items } : floor;
  });
}

/** Interior walls of the active floor — what wall-mounted items settle against. */
function activeInteriorWalls(state: LayoutState): readonly InteriorWall[] {
  return state.layout.floors[state.activeFloorIndex]?.interiorWalls ?? [];
}

function clampRoomDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(value, MAX_ROOM_DIMENSION);
}

/** Clamp a position so the item's rotated footprint stays inside the room. */
function clampToFootprint(
  item: Pick<FurnitureItem, 'width' | 'depth' | 'rotation'>,
  position: { x: number; z: number },
  roomWidth: number,
  roomDepth: number
): { x: number; z: number } {
  const { halfW, halfD } = rotatedHalfExtents(item);
  const maxX = Math.max(0, roomWidth / 2 - halfW);
  const maxZ = Math.max(0, roomDepth / 2 - halfD);
  return {
    x: Math.min(maxX, Math.max(-maxX, position.x)),
    z: Math.min(maxZ, Math.max(-maxZ, position.z)),
  };
}

function normaliseLayout(layout: RoomLayout): RoomLayout {
  // Defense in depth: even after schema validation, clamp dimensions and floor
  // count here so any layout reaching the reducer stays within safe bounds.
  const width = clampRoomDimension(layout.width);
  const height = clampRoomDimension(layout.height);
  const floors =
    layout.floors.length === 0
      ? [INITIAL_GROUND_FLOOR]
      : layout.floors.slice(0, MAX_FLOORS).map((floor) => ({
          ...floor,
          floorColor: floor.floorColor || '#c9a57d',
          ...(floor.height !== undefined ? { height: clampStoreyHeight(floor.height) } : {}),
        }));
  return {
    ...layout,
    width,
    height,
    floors,
    ...(layout.terrain !== undefined ? { terrain: clampTerrain(layout.terrain) } : {}),
  };
}

function findEntranceDoor(floors: readonly FloorLayout[]): FurnitureItem | undefined {
  for (const floor of floors) {
    const door = floor.items.find((item) => item.id === ENTRANCE_DOOR_ID);
    if (door) return door;
  }
  return undefined;
}

function catalogEntranceDoor(): FurnitureItem | undefined {
  const catalogDoor = FURNITURE_CATALOG.find((item) => item.type === 'door');
  return catalogDoor && { ...catalogDoor, id: ENTRANCE_DOOR_ID, locked: true };
}

function findEntranceWall(floors: readonly FloorLayout[]): InteriorWall | undefined {
  for (const floor of floors) {
    const wall = floor.interiorWalls?.find((wall) => wall.id === ENTRANCE_WALL_ID);
    if (wall) return wall;
  }
  return undefined;
}

function sameWall(a: InteriorWall, b: InteriorWall): boolean {
  return a.id === b.id && a.x1 === b.x1 && a.z1 === b.z1 && a.x2 === b.x2 && a.z2 === b.z2 && a.color === b.color;
}

function sameItem(a: FurnitureItem, b: FurnitureItem): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof FurnitureItem>;
  for (const key of keys) {
    if (key === 'position') {
      if (a.position?.x !== b.position?.x || a.position?.z !== b.position?.z) return false;
    } else if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Put the entrance's wall and door on one floor (or take them off it),
 * keeping the floor's identity when it already holds exactly that (#279).
 */
function syncEntranceFloor(floor: FloorLayout, wall: InteriorWall | null, door: FurnitureItem | null): FloorLayout {
  let next = floor;
  const currentWall = floor.interiorWalls?.find((w) => w.id === ENTRANCE_WALL_ID);
  if (wall ? !currentWall || !sameWall(currentWall, wall) : currentWall) {
    const others = (floor.interiorWalls ?? []).filter((w) => w.id !== ENTRANCE_WALL_ID);
    next = { ...next, interiorWalls: wall ? [...others, wall] : others };
  }
  const currentDoor = floor.items.find((item) => item.id === ENTRANCE_DOOR_ID);
  if (door ? !currentDoor || !sameItem(currentDoor, door) : currentDoor) {
    const others = floor.items.filter((item) => item.id !== ENTRANCE_DOOR_ID);
    next = { ...next, items: door ? [...others, door] : others };
  }
  return next;
}

/**
 * Apply an entrance change and keep its back wall and door in step: the wall
 * always spans the recess on the street storey, keeping its painted colour;
 * the door is created whenever the recess can be built and the user hasn't
 * deleted it (`entrance.door === false`), otherwise only re-centred. Both
 * are looked up in `previous` too, so a storey removed from under them
 * doesn't lose them (#273). Removing the entrance removes both. A sync that
 * changes nothing returns `layout` itself, floors included (#279).
 */
function syncEntrance(layout: RoomLayout, requested: EntranceSpec | null, previous: RoomLayout = layout): RoomLayout {
  if (requested === null) {
    if (layout.entrance === undefined) return layout;
    const { entrance: _old, ...rest } = layout;
    return { ...rest, floors: layout.floors.map((floor) => syncEntranceFloor(floor, null, null)) };
  }
  const entrance = clampEntrance(requested);
  // The deleted-door flag is the reducer's own record: a panel re-sending
  // the spec without it must not resurrect the door.
  if (layout.entrance?.door === false) entrance.door = false;
  const streetIndex = entranceFloorIndex(layout.floors, streetLevel(layout.terrain, layout.height));
  // The back wall exists on the street storey only, so a porch must not
  // reach into the storey above it (#275) — the spec is clamped, not just
  // the geometry, so the value survives saves and share links.
  if (entrance.height !== undefined && streetIndex !== null) {
    const storey = storeyHeight(layout.floors[streetIndex]);
    entrance.height = Math.max(ENTRANCE_LIMITS.height[0], Math.min(entrance.height, storey));
  }

  const geometry = entranceGeometry(entrance, {
    width: layout.width,
    depth: layout.height,
    floors: layout.floors,
    terrain: layout.terrain,
  });
  let wall: InteriorWall | null = null;
  let door: FurnitureItem | null = null;
  if (geometry) {
    const existingWall = findEntranceWall(layout.floors) ?? findEntranceWall(previous.floors);
    wall = { id: ENTRANCE_WALL_ID, ...entranceBackWall(geometry) };
    if (existingWall?.color !== undefined) wall.color = existingWall.color;
    if (entrance.door !== false) {
      const existing = findEntranceDoor(layout.floors) ?? findEntranceDoor(previous.floors) ?? catalogEntranceDoor();
      if (existing) door = { ...existing, position: { x: (geometry.x0 + geometry.x1) / 2, z: geometry.backZ }, rotation: 0 };
    }
  }

  let changed = false;
  const floors = layout.floors.map((floor, index) => {
    const onStreet = geometry !== null && index === geometry.floorIndex;
    const next = syncEntranceFloor(floor, onStreet ? wall : null, onStreet ? door : null);
    if (next !== floor) changed = true;
    return next;
  });
  if (!changed && layout.entrance !== undefined && sameEntrance(layout.entrance, entrance)) return layout;
  return { ...layout, entrance, floors: changed ? floors : layout.floors };
}

function clampTerrain(terrain: TerrainSpec): TerrainSpec {
  return { frontY: clampTerrainY(terrain.frontY), backY: clampTerrainY(terrain.backY) };
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
