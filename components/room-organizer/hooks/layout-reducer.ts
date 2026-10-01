import { DEFAULT_ROOF, FURNITURE_CATALOG, MAX_FLOORS, MAX_ITEM_DIMENSION, MAX_ROOM_DIMENSION } from '../lib/constants';
import { MAX_DORMERS, clampDormer, type DormerInput, type DormerPatch } from '../lib/dormers';
import { rotatedHalfExtents } from '../lib/geometry';
import { remapGroupIds } from '../lib/groups';
import { INITIAL_GROUND_FLOOR, INITIAL_LAYOUT } from '../lib/initial-layout';
import { isWallMounted, settleWallMountedItem, snapOpeningToWall, type WallGap } from '../lib/opening-snap';
import {
  MAX_INTERIOR_WALLS_PER_FLOOR,
  MAX_ITEMS_PER_FLOOR,
  MAX_NAME_LENGTH,
  capText,
  clampCoordinate,
} from '../lib/schema';
import { clampTerrainY, isStreetSeed } from '../lib/site';
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
  entrancePlanOutline,
  sameEntrance,
  streetLevel,
} from '../lib/street';
import { MAX_ZONES, clampZoneRect, sameZone } from '../lib/zones';
import type {
  CatalogItem,
  EntranceSpec,
  FloorLayout,
  FloorPattern,
  FloorPlanFitMode,
  Frontage,
  FurnitureItem,
  InteriorWall,
  NeighbourFlag,
  RoofStyle,
  RoomLayout,
  RoomZone,
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
  | { type: 'addDormer'; dormer: DormerInput }
  | { type: 'updateDormer'; id: string; patch: DormerPatch }
  | { type: 'removeDormer'; id: string }
  | { type: 'setTerrain'; terrain: TerrainSpec | null }
  | { type: 'setNeighbour'; side: NeighbourFlag; present: boolean }
  | { type: 'shuffleStreet'; seed: number }
  | { type: 'setEntrance'; entrance: EntranceSpec | null }
  | { type: 'setFrontage'; frontage: Frontage }
  | { type: 'setSillHeight'; id: string; sillHeight: number | null }
  | { type: 'setStairsShape'; id: string; shape: StairsShape; leadIn?: number }
  | { type: 'applyLayout'; layout: RoomLayout }
  // persistent groups (#154) — target the active floor
  | { type: 'setGroup'; ids: ReadonlySet<string>; groupId: string }
  | { type: 'clearGroup'; ids: ReadonlySet<string> }
  // room zones (#155) — target the active floor
  | { type: 'addZone'; zone: RoomZone }
  | { type: 'updateZone'; id: string; patch: Partial<Omit<RoomZone, 'id'>> }
  | { type: 'removeZone'; id: string };

// ---------------------------------------------------------------------------
// State shape + defaults
// ---------------------------------------------------------------------------

export interface LayoutState {
  readonly layout: RoomLayout;
  readonly activeFloorIndex: number;
}

export { INITIAL_GROUND_FLOOR, INITIAL_LAYOUT };

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
      return withLayout(state, (layout) => {
        const name = capName(action.name);
        return layout.name === name ? layout : { ...layout, name };
      });
    // Width/height must be clamped here, not only in normaliseLayout: an
    // out-of-range dimension that reaches localStorage fails schema validation
    // on the next load, and the fallback layout then autosaves over the
    // user's house (#113). Openings and zones follow the new footprint (#431).
    case 'setWidth':
      return withLayout(state, (layout) => {
        const width = clampRoomDimension(action.width);
        return width === layout.width ? layout : refitFootprint(layout, width, layout.height);
      });
    case 'setHeight':
      return withLayout(state, (layout) => {
        const height = clampRoomDimension(action.height);
        return height === layout.height ? layout : refitFootprint(layout, layout.width, height);
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

    // Party walls and street rows (#202, #310). The field is dropped once
    // nothing is left in it; a seed on its own is kept so the street comes
    // back as it was when a flag is switched on again.
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
    // The seed is rolled by the caller (lib/street-row.ts `randomStreetSeed`)
    // so the reducer stays pure; the same seed again is a no-op (#310).
    case 'shuffleStreet':
      return withLayout(state, (layout) => {
        if (!isStreetSeed(action.seed) || layout.neighbours?.seed === action.seed) return layout;
        return { ...layout, neighbours: { ...layout.neighbours, seed: action.seed } };
      });

    // -- floor-scoped finishes ----------------------------------------------
    // Re-picking the active swatch keeps identity: no undo entry (#416).
    case 'setFloorColor':
      return withActiveFloor(state, (floor) =>
        floor.floorColor === action.color ? floor : { ...floor, floorColor: action.color }
      );
    case 'setFloorPattern':
      return withActiveFloor(state, (floor) =>
        floor.floorPattern === action.pattern ? floor : { ...floor, floorPattern: action.pattern }
      );
    case 'setWallPattern':
      return withActiveFloor(state, (floor) =>
        floor.wallPattern === action.pattern ? floor : { ...floor, wallPattern: action.pattern }
      );
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
        if ((action.color ?? undefined) === floor.wallColors?.[action.wall]) return floor;
        const next = { ...(floor.wallColors ?? {}) };
        if (action.color === null) delete next[action.wall];
        else next[action.wall] = action.color;
        return { ...floor, wallColors: next };
      });
    case 'setInteriorWallColor':
      return withActiveFloor(state, (floor) => {
        const walls = floor.interiorWalls;
        if (!walls?.some((wall) => wall.id === action.id && wall.color !== action.color)) return floor;
        return {
          ...floor,
          interiorWalls: walls.map((wall) => (wall.id === action.id ? { ...wall, color: action.color } : wall)),
        };
      });

    // -- floor plan ---------------------------------------------------------
    case 'setFloorPlan': {
      const { image } = action;
      if (image === null) {
        return withLayout(state, (layout) => {
          if (layout.floorPlanImage === undefined) return layout;
          const next = { ...layout };
          delete next.floorPlanImage;
          return next;
        });
      }
      return withLayout(state, (layout) =>
        layout.floorPlanImage === image ? layout : { ...layout, floorPlanImage: image }
      );
    }
    // Clamped like every other channel the schema bounds (#418).
    case 'setFloorPlanOpacity':
      return withLayout(state, (layout) => {
        if (!Number.isFinite(action.opacity)) return layout;
        const opacity = Math.min(1, Math.max(0, action.opacity));
        return layout.floorPlanOpacity === opacity ? layout : { ...layout, floorPlanOpacity: opacity };
      });
    case 'setFloorPlanFitMode':
      return withLayout(state, (layout) =>
        layout.floorPlanFitMode === action.mode ? layout : { ...layout, floorPlanFitMode: action.mode }
      );

    // -- roof ---------------------------------------------------------------
    // A roof-less house (a migrated legacy save) renders as style 'none', so
    // both actions start from that: picking a colour must not add a roof (#428).
    case 'setRoofStyle':
      return withLayout(state, (layout) => {
        if ((layout.roof?.style ?? 'none') === action.style) return layout;
        return { ...layout, roof: { ...(layout.roof ?? { style: 'none' }), style: action.style } };
      });
    case 'setRoofColor':
      return withLayout(state, (layout) => {
        if (layout.roof?.color === action.color) return layout;
        return { ...layout, roof: { ...(layout.roof ?? { style: 'none' }), color: action.color } };
      });

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
        position: clampPosition(action.position ?? { x: 0, z: 0 }),
        rotation: 0,
        ...(action.catalogItem.type === 'sofa' ? { sofaShape: 'standard' as const } : {}),
      };
      return withActiveFloor(state, (floor) =>
        hasRoomFor(floor.items, 1, MAX_ITEMS_PER_FLOOR, ENTRANCE_DOOR_ID)
          ? { ...floor, items: [...floor.items, newItem] }
          : floor
      );
    }

    // Locks protect geometry, not existence: every item is locked after
    // placement and after a drag, so removal ignores the lock.
    case 'removeItem':
      return withActiveFloor(state, (floor) => {
        if (!floor.items.some((item) => item.id === action.id)) return floor;
        return { ...floor, items: floor.items.filter((item) => item.id !== action.id) };
      });

    case 'updateItem':
      return patchItem(state, action.id, () => action.patch);

    case 'duplicateItem':
      return withActiveFloor(state, (floor) => {
        const source = floor.items.find((item) => item.id === action.sourceId);
        if (!source || !hasRoomFor(floor.items, 1, MAX_ITEMS_PER_FLOOR, ENTRANCE_DOOR_ID)) return floor;
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
          floor.interiorWalls ?? [],
          activeFrontGap(state)
        );
        const copy: FurnitureItem = settled
          ? { ...source, id: action.newId, ...settled }
          : {
              ...source,
              id: action.newId,
              position:
                source.category === 'outdoor'
                  ? clampPosition(offset)
                  : clampToFootprint(source, offset, state.layout.width, state.layout.height),
            };
        // A duplicate is a loose copy: it must not join the source's group
        // (#154). Paste remaps groups instead — see lib/clipboard.ts. It is
        // about to be moved, so it starts unlocked, as a pasted copy does (#353).
        delete copy.groupId;
        delete copy.locked;
        return { ...floor, items: [...floor.items, copy] };
      });

    // Geometry mutations enforce the lock IN the reducer (same strategy as
    // bulkSetPositions' #115 guard) and re-run the wall settle rule, so no
    // panel or future caller can move a locked item or strand a door,
    // window, or camera off its wall (#209, #210). `updateItem` stays
    // lock-unguarded on purpose — it is the internal channel for derived
    // placement (drag settles, camera reseats) — but like every patch it is
    // range-checked and can't move the entrance door (see patchItem).
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
              activeInteriorWalls(state),
              activeFrontGap(state)
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
          activeInteriorWalls(state),
          activeFrontGap(state)
        );
        return settled ?? { position };
      });

    case 'resizeItem':
      return patchItem(state, action.id, (item) => {
        // Clamp like the room dimensions (#113): a non-finite or oversized
        // value that reached localStorage would fail schema validation on
        // the next load and cost the whole save.
        if (item.locked || !Number.isFinite(action.value)) return null;
        const value = clampItemDimension(action.value);
        const resized = { ...item, [action.dimension]: value };
        // A deeper flush camera or a wider door re-seats on its wall like
        // any other geometry change (#408); height never moves the footprint.
        const settled =
          action.dimension !== 'height' && item.position
            ? settleWallMountedItem(
                resized,
                item.position,
                state.layout.width,
                state.layout.height,
                activeInteriorWalls(state),
                activeFrontGap(state)
              )
            : null;
        return { [action.dimension]: value, ...settled };
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

    // Mirroring a winder moves its stairwell hole — geometry, so locked
    // items refuse it (#408).
    case 'toggleMirror':
      return patchItem(state, action.id, (item) => (item.locked ? null : { mirrored: !item.mirrored }));

    case 'setRotation':
      // Raw on purpose apart from the lock: this is the channel the camera
      // handlers use to set an exact facing before reseating.
      return patchItem(state, action.id, (item) =>
        item.locked ? null : { rotation: action.rotation }
      );

    // -- bulk item operations -----------------------------------------------
    case 'replaceItems':
      if (!hasRoomFor(action.items, 0, MAX_ITEMS_PER_FLOOR, ENTRANCE_DOOR_ID)) return state;
      return withActiveFloor(state, (floor) => ({ ...floor, items: action.items.map(boundItem) }));

    case 'addItems':
      return withActiveFloor(state, (floor) =>
        hasRoomFor(floor.items, action.items.length, MAX_ITEMS_PER_FLOOR, ENTRANCE_DOOR_ID)
          ? { ...floor, items: [...floor.items, ...action.items.map(boundItem)] }
          : floor
      );

    case 'bulkSetPositions':
      return withActiveFloor(state, (floor) => {
        let changed = false;
        const items = floor.items.map((item) => {
          // Locked items are immune to bulk moves (group drag, align,
          // distribute) — enforced here so no caller can shove them (#115);
          // the entrance door belongs to the porch whatever its lock (#357).
          if (item.locked || item.id === ENTRANCE_DOOR_ID) return item;
          const next = action.positions.get(item.id);
          if (!next || !Number.isFinite(next.x) || !Number.isFinite(next.z)) return item;
          const position = clampPosition({ x: next.x, z: next.z });
          // Align/distribute previously parked doors and windows mid-room;
          // the settle rule applies to bulk commits like any other (#210).
          // The drag path settles before dispatching — re-settling an
          // on-wall placement is a no-op.
          const settled = settleWallMountedItem(
            item,
            position,
            state.layout.width,
            state.layout.height,
            floor.interiorWalls ?? [],
            activeFrontGap(state)
          );
          const moved = { ...item, ...(settled ?? { position }) };
          if (sameItem(item, moved)) return item;
          changed = true;
          return moved;
        });
        return changed ? { ...floor, items } : floor;
      });

    case 'rotateSelection':
      if (!Number.isFinite(action.radians)) return state;
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
        let changed = false;
        const items = floor.items.map((item) => {
          // Locked items neither spin nor orbit — callers filter, but the
          // reducer is the guarantee (#115/#209); nor does the porch's
          // door, which belongs to the recess (#357).
          if (!action.ids.has(item.id) || item.locked || item.id === ENTRANCE_DOOR_ID) return item;
          changed = true;
          const nextRotation = ((item.rotation ?? 0) + theta) % (Math.PI * 2);
          if (!item.position) {
            return { ...item, rotation: nextRotation };
          }
          const dx = item.position.x - cx;
          const dz = item.position.z - cz;
          const position = clampPosition({
            x: cx + dx * cos + dz * sin,
            z: cz - dx * sin + dz * cos,
          });
          // A wall-mounted item swept to an interior point re-snaps to the
          // nearest wall instead of floating where the orbit dropped it
          // (#210) — the same rule every other commit path follows.
          const settled = settleWallMountedItem(
            { ...item, rotation: nextRotation },
            position,
            state.layout.width,
            state.layout.height,
            floor.interiorWalls ?? [],
            activeFrontGap(state)
          );
          return { ...item, rotation: nextRotation, ...(settled ?? { position }) };
        });
        return changed ? { ...floor, items } : floor;
      });

    case 'setLockAll':
      return withActiveFloor(state, (floor) => {
        if (floor.items.every((item) => (item.locked === true) === action.locked)) return floor;
        return {
          ...floor,
          items: floor.items.map((item) =>
            (item.locked === true) === action.locked ? item : { ...item, locked: action.locked }
          ),
        };
      });

    case 'clearItems':
      // "Clear floor" is about furniture. The entrance door is part of the
      // recess, so it stays — otherwise clearing a floor would read as the
      // user deleting the door and the porch would keep a blank back wall
      // for good (#273).
      return withActiveFloor(state, (floor) => {
        const items = floor.items.filter((item) => item.id === ENTRANCE_DOOR_ID);
        return items.length === floor.items.length ? floor : { ...floor, items };
      });

    // -- interior walls -----------------------------------------------------
    // Endpoints must be finite, or the save fails validation on reload (#418).
    case 'addInteriorWall': {
      if (!isFiniteWall(action.wall)) return state;
      const wall = clampWall(action.wall);
      if (!wall) return state;
      return withActiveFloor(state, (floor) =>
        hasRoomFor(floor.interiorWalls, 1, MAX_INTERIOR_WALLS_PER_FLOOR, ENTRANCE_WALL_ID)
          ? { ...floor, interiorWalls: [...(floor.interiorWalls ?? []), wall] }
          : floor
      );
    }

    // Batch insert — a room-shape stamp adds every segment in one dispatch so
    // the whole stamp is a single history/undo entry rather than N of them.
    case 'addInteriorWalls': {
      if (action.walls.length === 0 || !action.walls.every(isFiniteWall)) return state;
      const walls = action.walls.map(clampWall).filter((wall): wall is InteriorWall => wall !== null);
      if (walls.length === 0) return state;
      return withActiveFloor(state, (floor) =>
        hasRoomFor(floor.interiorWalls, walls.length, MAX_INTERIOR_WALLS_PER_FLOOR, ENTRANCE_WALL_ID)
          ? { ...floor, interiorWalls: [...(floor.interiorWalls ?? []), ...walls] }
          : floor
      );
    }

    // The porch's back wall belongs to the recess: it goes when the entrance
    // does, never on its own (#357).
    case 'removeInteriorWall':
      return withActiveFloor(state, (floor) => {
        const walls = floor.interiorWalls;
        if (action.id === ENTRANCE_WALL_ID || !walls?.some((wall) => wall.id === action.id)) return floor;
        return { ...floor, interiorWalls: walls.filter((wall) => wall.id !== action.id) };
      });

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
      return withActiveFloor(state, (floor) => {
        const walls = floor.interiorWalls ?? [];
        const kept = walls.filter((wall) => wall.id === ENTRANCE_WALL_ID);
        return kept.length === walls.length ? floor : { ...floor, interiorWalls: kept };
      });

    // -- floor / building operations ----------------------------------------
    case 'setActiveFloorIndex': {
      const activeFloorIndex = clampActiveIndex(action.index, state.layout.floors.length);
      return activeFloorIndex === state.activeFloorIndex ? state : { ...state, activeFloorIndex };
    }

    case 'addFloor': {
      if (state.layout.floors.length >= MAX_FLOORS) return state;
      const name = capName(action.floor.name ?? defaultFloorName(state.layout.floors));
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
      // cloned under fresh ids they would outlive every re-fit (#273). The
      // garden stays on the ground: a cloned tree would float in the sky,
      // where placement refuses outdoor items anyway (#345).
      const clonedItems: FurnitureItem[] = remapGroupIds(
        source.items
          .filter((item) => item.id !== ENTRANCE_DOOR_ID && item.category !== 'outdoor')
          .map((item, idx) => ({ ...item, id: `${item.type}-${action.idSuffix}-${idx}` })),
        action.idSuffix
      );
      const clonedWalls: InteriorWall[] | undefined = source.interiorWalls
        ?.filter((wall) => wall.id !== ENTRANCE_WALL_ID)
        .map((wall, idx) => ({ ...wall, id: `wall-${action.idSuffix}-${idx}` }));
      // Zone and group ids are fresh too, so nothing aliases across storeys (#422).
      const clonedZones: RoomZone[] | undefined = source.zones?.map((zone, idx) => ({
        ...zone,
        id: `zone-${action.idSuffix}-${idx}`,
      }));
      const floor: FloorLayout = {
        ...source,
        id: action.newId,
        name: capName(`${source.name} copy`),
        items: clonedItems,
        ...(clonedWalls ? { interiorWalls: clonedWalls } : {}),
        ...(clonedZones ? { zones: clonedZones } : {}),
      };
      const floors = [...state.layout.floors, floor];
      return { layout: { ...state.layout, floors }, activeFloorIndex: floors.length - 1 };
    }

    case 'removeFloor': {
      if (state.layout.floors.length <= 1 || !state.layout.floors[action.index]) return state;
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
      // An unedited rename commits on both Enter and blur (#416).
      const target = state.layout.floors[action.index];
      const name = capName(action.name);
      if (!target || target.name === name) return state;
      const floors = state.layout.floors.map((floor, index) => (index === action.index ? { ...floor, name } : floor));
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

    // -- persistent groups (#154) -------------------------------------------
    // Grouping is metadata, not geometry: locked members join and leave
    // groups freely, and stay put during a group move as they do today.
    case 'setGroup':
      return withActiveFloor(state, (floor) => {
        if (action.groupId === '') return floor;
        // A group needs company — a lone member would select as itself
        // anyway (lib/groups.ts) and only add bytes to the save.
        if (floor.items.filter((item) => action.ids.has(item.id)).length < 2) return floor;
        let changed = false;
        const items = floor.items.map((item) => {
          if (!action.ids.has(item.id) || item.groupId === action.groupId) return item;
          changed = true;
          return { ...item, groupId: action.groupId };
        });
        return changed ? { ...floor, items } : floor;
      });

    case 'clearGroup':
      return withActiveFloor(state, (floor) => {
        let changed = false;
        const items = floor.items.map((item) => {
          if (!action.ids.has(item.id) || item.groupId === undefined) return item;
          changed = true;
          // Dropped, not set to undefined: an absent key keeps the saved
          // JSON and share URL identical to a layout that never grouped.
          const { groupId: _cleared, ...rest } = item;
          return rest;
        });
        return changed ? { ...floor, items } : floor;
      });

    // -- room zones (#155) --------------------------------------------------
    // The rectangle is normalised on the way in (rounded, clamped to the
    // footprint) so a stored zone always fits its floor and passes schema
    // validation on reload (#113); one that clamps to nothing is refused.
    case 'addZone':
      return withActiveFloor(state, (floor) => {
        const zones = floor.zones ?? [];
        if (zones.length >= MAX_ZONES || zones.some((zone) => zone.id === action.zone.id)) return floor;
        const rect = clampZoneRect(action.zone, state.layout.width, state.layout.height);
        if (!rect) return floor;
        return { ...floor, zones: [...zones, { ...action.zone, ...rect, name: capName(action.zone.name) }] };
      });

    case 'updateZone':
      return withActiveFloor(state, (floor) => {
        const current = floor.zones?.find((zone) => zone.id === action.id);
        if (!current || !floor.zones) return floor;
        const merged: RoomZone = { ...current, ...action.patch, id: current.id };
        merged.name = capName(merged.name);
        const rect = clampZoneRect(merged, state.layout.width, state.layout.height);
        if (!rect) return floor;
        const next: RoomZone = { ...merged, ...rect };
        // Re-typing a name or re-picking a colour keeps identity: no undo
        // entry, no autosave.
        if (sameZone(current, next)) return floor;
        return { ...floor, zones: floor.zones.map((zone) => (zone.id === action.id ? next : zone)) };
      });

    case 'removeZone':
      return withActiveFloor(state, (floor) => {
        if (!floor.zones?.some((zone) => zone.id === action.id)) return floor;
        const zones = floor.zones.filter((zone) => zone.id !== action.id);
        if (zones.length > 0) return { ...floor, zones };
        const { zones: _none, ...rest } = floor;
        return rest;
      });

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

/** Fields of an item to change; an explicit `undefined` clears an optional one. */
type ItemPatch = { [K in keyof FurnitureItem]?: FurnitureItem[K] | undefined };

/**
 * Patch one item on the active floor. A `null` patch means "refused" (e.g.
 * the item is locked): the state is returned with its identity intact, so a
 * refused mutation never registers as an edit in undo history or autosave.
 * So does a patch that changes nothing (#416). Every patch is range-checked
 * against the schema first (#418).
 */
function patchItem(
  state: LayoutState,
  id: string,
  patch: (item: FurnitureItem) => ItemPatch | null
): LayoutState {
  return withActiveFloor(state, (floor) => {
    let changed = false;
    const items = floor.items.map((item) => {
      if (item.id !== id) return item;
      const fields = sanitizeItemPatch(item, patch(item));
      if (fields === null || !changesItem(item, fields)) return item;
      changed = true;
      // A cleared field stays as an `undefined` key, which every reader treats as absent.
      return { ...item, ...fields } as FurnitureItem;
    });
    return changed ? { ...floor, items } : floor;
  });
}

const MIN_ITEM_DIMENSION = 0.1;

function clampItemDimension(value: number): number {
  return Math.min(MAX_ITEM_DIMENSION, Math.max(MIN_ITEM_DIMENSION, value));
}

/**
 * Bring a patch within what `lib/schema.ts` accepts, or refuse it (`null`):
 * a NaN, a zero size or a negative range reaching the autosave makes it
 * unreadable on the next load (#418). Sizes are clamped; non-finite numbers
 * and non-positive ranges are refused. The entrance door's placement is the
 * porch's to decide, whatever its lock, so position and rotation are
 * dropped from its patches (#357).
 */
function sanitizeItemPatch(item: FurnitureItem, fields: ItemPatch | null): ItemPatch | null {
  if (fields === null) return null;
  const next: ItemPatch = { ...fields };
  if (item.id === ENTRANCE_DOOR_ID) {
    delete next.position;
    delete next.rotation;
    delete next.wallRotation;
  }
  for (const key of ['width', 'depth', 'height'] as const) {
    const value = next[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value)) return null;
    next[key] = clampItemDimension(value);
  }
  for (const key of ['rotation', 'wallRotation', 'price'] as const) {
    const value = next[key];
    if (value !== undefined && !Number.isFinite(value)) return null;
  }
  if (next.price !== undefined && next.price < 0) next.price = 0;
  if (next.name !== undefined) next.name = capName(next.name);
  for (const key of ['signalRange', 'visionRange'] as const) {
    const value = next[key];
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) return null;
  }
  if (next.visionFov !== undefined) {
    if (!(Number.isFinite(next.visionFov) && next.visionFov > 0)) return null;
    next.visionFov = Math.min(360, next.visionFov);
  }
  if (next.position) {
    if (!(Number.isFinite(next.position.x) && Number.isFinite(next.position.z))) return null;
    next.position = clampPosition(next.position);
  }
  return next;
}

/** Whether applying `fields` to `item` would change anything. */
function changesItem(item: FurnitureItem, fields: ItemPatch): boolean {
  for (const key of Object.keys(fields) as (keyof FurnitureItem)[]) {
    if (key === 'position') {
      if (item.position?.x !== fields.position?.x || item.position?.z !== fields.position?.z) return true;
    } else if (item[key] !== fields[key]) {
      return true;
    }
  }
  return false;
}

function isFiniteWall(wall: InteriorWall): boolean {
  return [wall.x1, wall.z1, wall.x2, wall.z2].every(Number.isFinite);
}

/*
 * The schema's caps, applied on the way in so the reducer's output always
 * parses back unchanged: a refused or repaired main save would cost the
 * user their house or their edit on the next load.
 */
function capName(name: string): string {
  return capText(name, MAX_NAME_LENGTH);
}

/** A drag ray can land anywhere on its infinite plane; the save can't. */
function clampPosition(position: { x: number; z: number }): { x: number; z: number } {
  const x = clampCoordinate(position.x);
  const z = clampCoordinate(position.z);
  return x === position.x && z === position.z ? position : { x, z };
}

/** Ends clamped like positions; null when that leaves no wall at all. */
function clampWall(wall: InteriorWall): InteriorWall | null {
  const x1 = clampCoordinate(wall.x1);
  const z1 = clampCoordinate(wall.z1);
  const x2 = clampCoordinate(wall.x2);
  const z2 = clampCoordinate(wall.z2);
  if (x1 === x2 && z1 === z2) return null;
  const same = x1 === wall.x1 && z1 === wall.z1 && x2 === wall.x2 && z2 === wall.z2;
  return same ? wall : { ...wall, x1, z1, x2, z2 };
}

/** An incoming item (paste, set, Surprise) with its position and name within the caps. */
function boundItem(item: FurnitureItem): FurnitureItem {
  const name = capName(item.name);
  const position = item.position && clampPosition(item.position);
  if (name === item.name && position === item.position) return item;
  return { ...item, name, ...(position ? { position } : {}) };
}

/**
 * Whether a floor holding `list` can take `count` more entries. One slot
 * under the cap stays free for the porch's door or back wall (`porchId`),
 * which the entrance re-fit adds on its own.
 */
function hasRoomFor(list: readonly { id: string }[] | undefined, count: number, max: number, porchId: string): boolean {
  const own = (list ?? []).filter((entry) => entry.id !== porchId).length;
  return own + count <= max - 1;
}

/**
 * Resize the footprint and re-fit what hangs on it (#431): every
 * wall-mounted item rides along with the exterior wall it was on (or
 * re-seats on its interior wall), clamped along the new wall; every zone is
 * clamped to the new footprint and dropped when nothing is left of it. The
 * entrance door is the porch's re-fit to make (#204). Floors that need no
 * change keep their identity.
 */
function refitFootprint(layout: RoomLayout, width: number, depth: number): RoomLayout {
  const from = { width: layout.width, depth: layout.height };
  const to = { width, depth };
  let changed = false;
  const floors = layout.floors.map((floor) => {
    const next = refitFloor(floor, from, to);
    if (next !== floor) changed = true;
    return next;
  });
  return { ...layout, width, height: depth, floors: changed ? floors : layout.floors };
}

interface Footprint {
  readonly width: number;
  readonly depth: number;
}

function refitFloor(floor: FloorLayout, from: Footprint, to: Footprint): FloorLayout {
  const walls = floor.interiorWalls ?? [];
  let itemsChanged = false;
  const items = floor.items.map((item) => {
    if (item.id === ENTRANCE_DOOR_ID || !item.position || !isWallMounted(item.type)) return item;
    const position = followExteriorWall(item, item.position, from, to, walls);
    const settled = settleWallMountedItem(item, position, to.width, to.depth, walls);
    if (!settled) return item;
    const next = { ...item, ...settled };
    if (sameItem(item, next)) return item;
    itemsChanged = true;
    return next;
  });

  let zonesChanged = false;
  const zones = floor.zones?.flatMap((zone) => {
    const rect = clampZoneRect(zone, to.width, to.depth);
    if (!rect) {
      zonesChanged = true;
      return [];
    }
    const next = { ...zone, ...rect };
    if (sameZone(zone, next)) return [zone];
    zonesChanged = true;
    return [next];
  });

  if (!itemsChanged && !zonesChanged) return floor;
  let next: FloorLayout = itemsChanged ? { ...floor, items } : floor;
  if (zonesChanged) {
    if (zones && zones.length > 0) {
      next = { ...next, zones };
    } else {
      const { zones: _none, ...rest } = next;
      next = rest;
    }
  }
  return next;
}

/**
 * Where a wall-mounted item lands when the footprint changes: one on an
 * exterior wall moves with that wall (a door on the south wall stays on the
 * south wall, not on whichever wall is now nearest); anything else stays put.
 */
function followExteriorWall(
  item: FurnitureItem,
  position: { x: number; z: number },
  from: Footprint,
  to: Footprint,
  interiorWalls: readonly InteriorWall[]
): { x: number; z: number } {
  const snap = snapOpeningToWall({
    position,
    itemWidth: item.width,
    roomWidth: from.width,
    roomDepth: from.depth,
    interiorWalls,
  });
  if (snap.wallKind !== 'exterior') return position;
  const dx = (to.width - from.width) / 2;
  const dz = (to.depth - from.depth) / 2;
  // snapOpeningToWall's exterior candidates: north 0, south π, east −π/2, west π/2.
  if (snap.rotation === 0) return { x: position.x, z: position.z - dz };
  if (snap.rotation === Math.PI) return { x: position.x, z: position.z + dz };
  if (snap.rotation === -Math.PI / 2) return { x: position.x + dx, z: position.z };
  return { x: position.x - dx, z: position.z };
}

/** Interior walls of the active floor — what wall-mounted items settle against. */
function activeInteriorWalls(state: LayoutState): readonly InteriorWall[] {
  return state.layout.floors[state.activeFloorIndex]?.interiorWalls ?? [];
}

/** The recessed entrance's span of the front wall on the active storey: openings settle on its piers (#394). */
function activeFrontGap(state: LayoutState): WallGap | null {
  return entrancePlanOutline(state.layout, state.activeFloorIndex);
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
  // Structure, not furniture: it adds nothing to the furniture bill (#382).
  return catalogDoor && { ...catalogDoor, id: ENTRANCE_DOOR_ID, locked: true, price: 0 };
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
    ...(layout.terrain ? { terrain: layout.terrain } : {}),
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
