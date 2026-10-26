import { useEffect, useMemo, useRef, type RefObject, type MutableRefObject } from 'react';
import { addFloorPlanRepaintHandler, render2DTopDown } from '../canvas-2d/render';
import { DEFAULT_FLOOR_PLAN_OPACITY } from '../lib/constants';
import { floorKeepOut, type KeepOutBuilding } from '../lib/floor-keep-out';
import {
  diffFurniture,
  furnitureBuildKey,
  furnitureCollisionKey,
  furnitureItemsKey,
  furnitureMeshKey,
  planFurniture,
} from '../lib/furniture-scene';
import { hasCollisions } from '../lib/geometry';
import { mountBand } from '../lib/mount-band';
import { LAMP_POOL_SIZE, collectLampLights, planLampPool, type LampLight } from '../lib/night-lights';
import { itemLabelsKey, signalOverlaysKey } from '../lib/overlay-keys';
import { boundsSize, planViewFit } from '../lib/plan-view-fit';
import { hasNeighbours, lowestGround } from '../lib/site';
import { buildingHeight, floorElevation, interiorWallHeight, itemForStorey, storeyHeight } from '../lib/storeys';
import { ENTRANCE_WALL_ID, entranceGeometry, entranceWallCut } from '../lib/street';
import { generateStreet } from '../lib/street-row';
import { shadowCasterBounds, type ShadowBox } from '../lib/sun-shadow';
import { sceneWallDisplay, walkthroughCeiling, walkthroughPit } from '../lib/walkthrough-view';
import { disposeObject, removeAndDispose } from '../three/builder-utils';
import { addVisionCones, visionConesOccludable } from '../three/camera-vision';
import { buildCeiling, removeCeiling } from '../three/ceiling';
import { applyCollisionTint, fadeGroup } from '../three/collision-tint';
import { FURNITURE_REVISION_KEY } from '../three/drag-handlers';
import { buildEntrance } from '../three/entrance';
import { createFurnitureModel } from '../three/furniture-builders';
import {
  clearInteriorWalls,
  clearPreview as clearWallPreview,
  renderInteriorWalls,
  renderInteriorWallPreview,
} from '../three/interior-walls';
import { clearItemLabels, renderItemLabels } from '../three/item-labels';
import { applyLampPool, applyTimeOfDay, computeSkyProfile, isLampPrewarmHour, prewarmLampPool } from '../three/lighting';
import { clearMeasurement, renderMeasurement } from '../three/measurement';
import { buildNeighbours, removeNeighbours } from '../three/neighbours';
import { setOutdoorVisible } from '../three/outdoor';
import { buildAtticCeiling, buildRoof, removeAtticCeiling, removeRoof, setRoofOnStorey, setRoofShellHidden } from '../three/roof';
import { OFF_STOREY_KEY, ROOM_OBJECT_TAGS, applyWallDisplay, buildRoom, clearFloorPlanImageCache, removeTagged } from '../three/room-builder';
import { addSignalOverlays } from '../three/signal-overlay';
import { computeFloorOpenings, computeWallOpenings } from '../three/wall-openings';
import { observeSceneOccluders, planFit } from './scene-occluders';
import type { FloorLayout, FurnitureItem, RoomLayout, ViewSettings } from '../lib/types';
import type * as ThreeNS from 'three';

/**
 * Opacity for another storey's shell and interior walls in "show all floors",
 * or undefined to draw it solid. Other storeys are ghosted so the active one
 * stays readable — except with every wall up, where the point is to see the
 * house as a solid building from outside (#201).
 */
export function otherFloorGhostOpacity(
  showAllFloors: boolean,
  wallDisplay: ViewSettings['wallDisplay'],
  isActive: boolean
): number | undefined {
  return showAllFloors && !isActive && wallDisplay !== 'up' ? 0.25 : undefined;
}

/** scene.userData-style key on a top-level object: the storey it was built for (#446). */
const STOREY_KEY = 'storey';

/** Tag every scene child from `first` on as built for `storey`. */
function tagStorey(scene: ThreeNS.Scene, first: number, storey: number): void {
  for (let i = first; i < scene.children.length; i++) scene.children[i]!.userData[STOREY_KEY] = storey;
}

/**
 * Hide the storeys outside `range` (-1 / -1: none hidden). Floors and
 * furniture are shown or hidden here; walls and partitions are flagged
 * `OFF_STOREY_KEY` for applyWallDisplay, which owns their visibility.
 */
function applyStoreyRange(scene: ThreeNS.Scene, range: { from: number; to: number }): void {
  const all = range.from === -1 && range.to === -1;
  for (const obj of scene.children) {
    const storey: unknown =
      obj.userData.type === ROOM_OBJECT_TAGS.Furniture ? obj.userData.floorIndex : obj.userData[STOREY_KEY];
    if (typeof storey !== 'number') continue;
    const off = !all && (storey < range.from || storey > range.to);
    if (obj.userData[OFF_STOREY_KEY] === off) continue;
    obj.userData[OFF_STOREY_KEY] = off;
    const tag = obj.userData.type;
    if (tag !== ROOM_OBJECT_TAGS.Wall && tag !== 'interior-wall') obj.visible = !off;
  }
}

function ghostifyGroup(group: import('three').Object3D, opacity = 0.3): void {
  fadeGroup(group, opacity);
}

/** scene.userData: the roof inputs the built roof was made from (#283). */
const ROOF_BUILD_KEY = 'roofBuildKey';

/** One furniture group the furniture effect is about to place (#404). */
interface PlannedFurniture {
  item: FurnitureItem;
  /** `item` fitted to its storey, as the builder sees it. */
  fitted: FurnitureItem;
  collision: boolean;
  floorIndex: number;
  floorY: number;
  storeyH: number;
  isActive: boolean;
}

/** How far the viewer moves before the lamp pool goes to the lamps nearest them (#393). */
const LAMP_REASSIGN_DISTANCE = 1;

export interface UseSceneEffectsParams {
  isReady: boolean;
  /** Flips once people.glb loads, so placed people rebuild as rigged figures. */
  peopleModelReady?: boolean;
  /** Request a render on the next animation frame (render-on-demand). */
  invalidate: () => void;
  /** Recompute the static shadow map — call after a shadow caster/sun change. */
  requestShadowUpdate: () => void;
  threeModuleRef: MutableRefObject<typeof import('../three/three-runtime') | null>;
  sceneRef: MutableRefObject<ThreeNS.Scene | null>;
  rendererRef: MutableRefObject<ThreeNS.WebGLRenderer | null>;
  cameraRef: MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  controlsRef: MutableRefObject<import('three/examples/jsm/controls/OrbitControls.js').OrbitControls | null>;
  canvas2DRef: RefObject<HTMLCanvasElement | null>;
  layout: RoomLayout;
  activeFloor: FloorLayout;
  activeFloorIndex: number;
  view: ViewSettings;
  selectedItemId: string | null;
  extraSelectedIds: ReadonlySet<string>;
  highlightedIds: ReadonlySet<string>;
  selectedWall: { id: string; kind: 'exterior' | 'interior' } | null;
  wallDraft: { x: number; z: number } | null;
  wallSnapResult: { point: { x: number; z: number }; kind: string } | null;
  measurementPoints: ReadonlyArray<{ x: number; z: number }>;
  /**
   * The walker is indoors (#446): of the storeys every one of which the
   * walkthrough builds, show only its own and the ones directly above and
   * below. Outside, the whole house shows.
   */
  walkIndoors?: boolean;
  /**
   * Indoors, the walker is on a flight or near a stairwell: the storeys
   * directly above and below show too. Elsewhere the ceiling and the floor
   * hide them, so only the walker's own storey is drawn.
   */
  walkNearStairs?: boolean;
  /** The storey whose lamps light the walker (`walkLampStorey`, lib/walk-world). */
  walkLampStorey?: number;
}

export function useSceneEffects({
  isReady,
  peopleModelReady = false,
  invalidate,
  requestShadowUpdate,
  threeModuleRef,
  sceneRef,
  rendererRef,
  cameraRef,
  controlsRef,
  canvas2DRef,
  layout,
  activeFloor,
  activeFloorIndex,
  view,
  selectedItemId,
  extraSelectedIds,
  highlightedIds,
  selectedWall,
  wallDraft,
  wallSnapResult,
  measurementPoints,
  walkIndoors = false,
  walkNearStairs = false,
  walkLampStorey,
}: UseSceneEffectsParams): void {
  const activeFloorY = floorElevation(layout.floors, activeFloorIndex);
  // The furniture groups in the scene by furnitureMeshKey, with the build
  // key each was built from (#404).
  const furnitureMeshesRef = useRef(new Map<string, { group: ThreeNS.Group; buildKey: string }>());

  // Storey heights stack every floor's Y, the wall heights, and the roof
  // base (#202). The structural effects are keyed on narrow signatures, not
  // `layout.floors` identity, so they need this one too.
  const storeyHeightsKey = layout.floors.map((floor) => floor.height ?? '').join(',');
  // Same gate as room-organizer's walkthroughActive. While walking every wall
  // and the roof stay up, whatever the orbit mode (#359).
  const walkthroughActive = view.walkthroughMode && !view.view2D;
  const wallDisplay = sceneWallDisplay(view.wallDisplay, walkthroughActive);
  // Whether "show all floors" ghosts the other storeys: all the shell,
  // interior-wall and furniture rebuilds read from the wall display. They key
  // on this rather than on wallDisplay, so a cutaway flip or entering
  // walkthrough rebuilds them only when the ghosting actually changes (#359).
  // Every storey is built while walking (#446): the walker climbs the stairs
  // and steps outside, so a lone storey left a lined shaft on the flight, no
  // stairs below a landing and a roofless box from the garden. Walls are up,
  // so nothing is ghosted. Leaving restores the user's own choice.
  const allFloors = view.showAllFloors || walkthroughActive;
  const ghostOtherFloors = otherFloorGhostOpacity(allFloors, wallDisplay, false) !== undefined;
  // Every storey is built while walking, but indoors only the walker's is
  // drawn, with its neighbours while it is on or near the stairs: a tall
  // house would otherwise draw every room of every floor each frame. Hidden,
  // not rebuilt, so walking about flips visibility only. -1 / -1 shows all.
  const walkSpan = walkNearStairs ? 1 : 0;
  const shownFrom = walkthroughActive && walkIndoors ? activeFloorIndex - walkSpan : -1;
  const shownTo = walkthroughActive && walkIndoors ? activeFloorIndex + walkSpan : -1;
  const storeyRangeRef = useRef({ from: shownFrom, to: shownTo });
  storeyRangeRef.current = { from: shownFrom, to: shownTo };
  // What the shell and partitions depend on of the active floor: only which
  // storey is drawn and which is ghosted. With every storey drawn solid a
  // floor switch (the walker reaching a landing) changes neither.
  const shellActiveKey = allFloors && !ghostOtherFloors ? -1 : activeFloorIndex;
  // What the porch keep-out is fitted to (#285) — the effects key on this
  // rather than the whole layout.
  const entranceBuilding = useMemo<KeepOutBuilding>(
    () => ({ width: layout.width, height: layout.height, terrain: layout.terrain, entrance: layout.entrance, floors: layout.floors }),
    [layout.width, layout.height, layout.terrain, layout.entrance, layout.floors]
  );

  // Serialized signatures of exactly the item-derived inputs the structural
  // effects consume. `layout.floors` gets a new identity on every item action,
  // so keying the effects on it rebuilt walls, floors, procedural textures,
  // and lights each time a chair moved; these keys only change when something
  // the structure actually depends on changes.
  const wallOpeningsKey = useMemo(
    () =>
      JSON.stringify(
        layout.floors.map((floor) =>
          floor.items
            .filter((item) => item.type === 'door' || item.type === 'window' || item.type === 'stairs')
            .map((item) => [
              item.type,
              item.position?.x,
              item.position?.z,
              item.width,
              item.height,
              item.depth,
              item.rotation,
              // Stair shape + mirroring move the headroom hole above (#205);
              // a window's own sill moves its hole (#204).
              item.stairsShape,
              item.stairsLeadIn,
              item.mirrored,
              item.sillHeight,
            ])
        )
      ),
    [layout.floors]
  );

  const shellFinishesKey = useMemo(
    () =>
      JSON.stringify(
        layout.floors.map((floor) => [
          floor.floorColor,
          floor.floorPattern,
          floor.wallPattern,
          floor.wallColors,
          floor.hiddenWalls,
        ])
      ),
    [layout.floors]
  );

  const interiorWallsKey = useMemo(
    () => JSON.stringify(layout.floors.map((floor) => floor.interiorWalls ?? [])),
    [layout.floors]
  );

  // What the furniture meshes are built from, and its two signatures (#214).
  const furniturePlan = useMemo(
    () => planFurniture(entranceBuilding, allFloors, activeFloorIndex),
    [entranceBuilding, allFloors, activeFloorIndex]
  );
  const itemsKey = useMemo(() => furnitureItemsKey(furniturePlan), [furniturePlan]);
  const collisionKey = useMemo(() => furnitureCollisionKey(furniturePlan), [furniturePlan]);
  // What the overlays read, so a sofa's colour or a chair nudge doesn't
  // rebuild every ring, cone and label sprite (#409).
  const overlaysKey = useMemo(() => signalOverlaysKey(furniturePlan), [furniturePlan]);
  const labelsKey = useMemo(() => itemLabelsKey(activeFloor.items), [activeFloor.items]);

  // Every night light on a rendered storey, bulb in world space (#215). The
  // string is the lamp effect's key, so a non-lamp item edit doesn't touch the
  // lights, while a floor switch or Show All Floors does.
  // While walking only the walker's storey is lit, though every storey is
  // drawn: point lights cast no shadow, so an upstairs lamp would light the
  // room below through its ceiling (#446). The active floor follows the
  // walker, so the pool only ever holds lamps on the walker's storey.
  // The walker's lamps switch storey a step before the landing, at the
  // top tread, rather than once it is on the floor plate.
  const litAllFloors = view.showAllFloors && !walkthroughActive;
  const litStorey = walkthroughActive && walkLampStorey !== undefined ? walkLampStorey : activeFloorIndex;
  const lampsKey = useMemo(
    () => JSON.stringify(collectLampLights(layout.floors, { activeFloorIndex: litStorey, showAllFloors: litAllFloors })),
    [layout.floors, litStorey, litAllFloors]
  );

  // Wall preview during draw mode
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    if (!view.drawWallMode || !wallDraft || !wallSnapResult) {
      clearWallPreview(scene);
      return;
    }
    renderInteriorWallPreview(
      THREE, scene, wallDraft, wallSnapResult.point, activeFloorY, interiorWallHeight(activeFloor)
    );
    // activeFloor is read for its storey height only; storeyHeightsKey covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, threeModuleRef, sceneRef, view.drawWallMode, wallDraft, wallSnapResult, activeFloorY, storeyHeightsKey]);

  // Build floor + walls
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    removeTagged(scene, ROOM_OBJECT_TAGS.Floor, ROOM_OBJECT_TAGS.Wall);

    // The building no longer has a floor plan: release the decoded multi-MB
    // image. (Only here — see clearFloorPlanImageCache for why buildRoom must
    // not drop it per image-less call.)
    if (!layout.floorPlanImage) clearFloorPlanImageCache();

    const floorsToRender = allFloors
      ? layout.floors.map((floor, index) => ({ floor, index }))
      : [{ floor: activeFloor, index: activeFloorIndex }];

    // The recessed entrance (#204) cuts the front wall of every storey it crosses.
    const entrance = layout.entrance
      ? entranceGeometry(layout.entrance, {
          width: layout.width,
          depth: layout.height,
          floors: layout.floors,
          ...(layout.terrain ? { terrain: layout.terrain } : {}),
        })
      : null;

    for (const { floor, index } of floorsToRender) {
      const firstChild = scene.children.length;
      const isActive = index === activeFloorIndex;
      const wallOpenings = computeWallOpenings(
        floor.items,
        layout.width,
        layout.height,
        storeyHeight(floor),
        floor.interiorWalls ?? []
      );
      const entranceCut = entrance ? entranceWallCut(entrance, layout.floors, index) : null;
      if (entranceCut) {
        wallOpenings.set('north', [...(wallOpenings.get('north') ?? []), { id: 'entrance', ...entranceCut }]);
      }
      // Stairs on the floor below create openings in this floor's plane.
      const floorBelow = index > 0 ? layout.floors[index - 1] : undefined;
      const floorOpenings = computeFloorOpenings(floorBelow);
      const ghostOpacity = otherFloorGhostOpacity(allFloors, wallDisplay, isActive);
      buildRoom(THREE, {
        scene,
        width: layout.width,
        depth: layout.height,
        floorColor: floor.floorColor,
        ...(floor.floorPattern ? { floorPattern: floor.floorPattern } : {}),
        ...(floor.wallPattern ? { wallPattern: floor.wallPattern } : {}),
        ...(floor.wallColors ? { wallColors: floor.wallColors } : {}),
        wallOpenings,
        ...(floor.hiddenWalls ? { hiddenWalls: floor.hiddenWalls } : {}),
        floorOpenings,
        floorPlanImage: index === 0 ? layout.floorPlanImage ?? null : null,
        floorPlanOpacity: layout.floorPlanOpacity ?? DEFAULT_FLOOR_PLAN_OPACITY,
        floorPlanFitMode: layout.floorPlanFitMode ?? 'stretch',
        floorPlan3DEffect: view.floorPlan3DEffect,
        yOffset: floorElevation(layout.floors, index),
        wallHeight: storeyHeight(floor),
        groundY: lowestGround(layout.terrain),
        ...(ghostOpacity !== undefined ? { ghostOpacity } : {}),
        onTextureLoaded: invalidate,
      });
      // The reveals and soffit are part of the north wall, so they are built
      // exactly when that wall is: not on the traced ground floor (buildRoom
      // builds no walls there) and not when the north wall is hidden — the
      // plan dashes the recess then, like the rest of the wall (#392).
      const tracedGround = index === 0 && !!layout.floorPlanImage;
      if (entrance && index === entrance.floorIndex && !tracedGround) {
        const northHidden = floor.hiddenWalls?.includes('north') ?? false;
        for (const group of buildEntrance(THREE, {
          geometry: entrance,
          wallColor: floor.wallColors?.north ?? '#e8dcc4',
          wallTag: ROOM_OBJECT_TAGS.Wall,
          floorTag: ROOM_OBJECT_TAGS.Floor,
          ...(ghostOpacity !== undefined ? { ghostOpacity } : {}),
        })) {
          if (northHidden && group.userData.wallId === 'north') disposeObject(group);
          else scene.add(group);
        }
      }
      tagStorey(scene, firstChild, index);
    }

    applyStoreyRange(scene, storeyRangeRef.current);
    const camera = cameraRef.current;
    if (camera) {
      applyWallDisplay(scene, camera.position.x, camera.position.z, wallDisplay, layout.width, layout.height);
    }
    // Walls, floor and foundation are shadow casters/receivers — recompute the
    // static shadow map now that the shell geometry changed.
    requestShadowUpdate();
    // The shell reads layout.floors/activeFloor but depends on them only
    // through the finishes and openings keys — depending on their identity
    // would rebuild walls, floor meshes, and procedural textures on every
    // item edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, rendererRef, cameraRef,
    // interiorWallsKey: opening ownership is classified across exterior AND
    // interior walls (nearest wall wins), so the exterior hole set changes
    // when interior walls do — without this dep a door claimed by a new
    // interior wall stays double-cut into the exterior wall (#119).
    layout.width, layout.height, shellFinishesKey, wallOpeningsKey, interiorWallsKey, storeyHeightsKey, layout.terrain, layout.entrance,
    layout.floorPlanImage, layout.floorPlanOpacity, layout.floorPlanFitMode,
    view.floorPlan3DEffect, allFloors, ghostOtherFloors,
    shellActiveKey,
  ]);

  // Cutaway on orbit
  useEffect(() => {
    invalidate();
    if (!isReady) return undefined;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return undefined;

    // Mark dirty instead of rendering here — the change listener fires every
    // interaction frame, and the RAF loop renders that same frame anyway, so a
    // direct render would draw the full scene twice per frame while orbiting.
    const apply = () => {
      const changed = applyWallDisplay(scene, camera.position.x, camera.position.z, wallDisplay, layout.width, layout.height);
      // Walls cast shadows (#132) and the shadow map is static: refresh it
      // when a cutaway flip actually hid/showed a wall — which happens only
      // when the camera crosses a wall plane, not on every orbit frame.
      if (changed) requestShadowUpdate();
      invalidate();
    };
    apply();
    controls.addEventListener('change', apply);
    return () => controls.removeEventListener('change', apply);
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, rendererRef, cameraRef, controlsRef, wallDisplay, layout.width, layout.height]);

  // Walkthrough enclosure (#359): when only the active storey is built, the
  // walker gets the underside of the storey above, and the stairwells are
  // lined up to the storey above and down to the one below — otherwise the
  // view up or down the stairs runs out into the sky or the garden. The
  // walkthrough now builds every storey (#446): the plate stays (the floor
  // above is invisible from below without it); the shafts line the
  // stairwells while the storeys either side are hidden (the walker away
  // from the stairs), so a hole never shows the sky, and go when they show.
  const neighboursHidden = walkthroughActive && walkIndoors && !walkNearStairs;
  // Keyed on primitives so nothing is built, or rebuilt, outside walkthrough.
  const ceiling = walkthroughActive ? walkthroughCeiling(layout.floors, activeFloorIndex) : null;
  const pit = walkthroughActive ? walkthroughPit(layout.floors, activeFloorIndex) : null;
  const ceilingY = ceiling?.y;
  const ceilingCapY = ceiling?.capY;
  const pitY = pit?.y;
  const pitTopY = pit?.topY;
  const pitFloorColor = pit ? layout.floors[activeFloorIndex - 1]?.floorColor : undefined;
  useEffect(() => {
    invalidate();
    if (!isReady || (ceilingY === undefined && pitY === undefined)) return undefined;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return undefined;

    const group = buildCeiling(THREE, {
      scene,
      width: layout.width,
      depth: layout.height,
      // The storey above's floor plate faces up only, so the walker below
      // sees its underside here, every storey built or not (#446).
      above:
        ceilingY !== undefined && ceilingCapY !== undefined
          ? { y: ceilingY, capY: ceilingCapY, openings: computeFloorOpenings(activeFloor) }
          : null,
      below:
        pitY !== undefined && pitTopY !== undefined && pitFloorColor !== undefined
          ? { y: pitY, topY: pitTopY, openings: computeFloorOpenings(layout.floors[activeFloorIndex - 1]), floorColor: pitFloorColor }
          : null,
      // Open onto the real storeys when they are drawn.
      shafts: !allFloors || neighboursHidden,
    });
    if (!group) return undefined;
    requestShadowUpdate();
    return () => {
      removeCeiling(scene);
      requestShadowUpdate();
      invalidate();
    };
    // activeFloor and the storey below are read for their stairwells only;
    // wallOpeningsKey covers them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, ceilingY, ceilingCapY, pitY, pitTopY, pitFloorColor, activeFloorIndex, allFloors, neighboursHidden, layout.width, layout.height, wallOpeningsKey]);

  // Furniture meshes
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    // Per-item diff (#404): a group is rebuilt only when what it is built from
    // changed; a move, turn, mirror or lock re-places the existing group. A
    // group no longer in this scene (the scene was rebuilt) is forgotten, and
    // furniture this map doesn't know is dropped.
    const meshes = furnitureMeshesRef.current;
    for (const [key, entry] of meshes) if (entry.group.parent !== scene) meshes.delete(key);
    const tracked = new Set<ThreeNS.Object3D>([...meshes.values()].map((entry) => entry.group));
    let changed = false;
    for (const obj of [...scene.children]) {
      if (obj.userData.type === ROOM_OBJECT_TAGS.Furniture && !tracked.has(obj)) {
        removeAndDispose(scene, obj);
        changed = true;
      }
    }

    const planned = new Map<string, PlannedFurniture>();
    const nextBuildKeys = new Map<string, string>();
    for (const { index, items, collisions } of furniturePlan) {
      const floor = layout.floors[index];
      const isActive = index === activeFloorIndex;
      const floorY = floorElevation(layout.floors, index);
      const storeyH = storeyHeight(floor);
      items.forEach((item, i) => {
        const collision = collisions[i] === true;
        // Stairs climb to the floor above and openings are fitted into the
        // storey, so the mesh matches the hole cut for it (#202, #277).
        const fitted = itemForStorey(item, floor);
        const key = furnitureMeshKey(index, item.id);
        planned.set(key, { item, fitted, collision, floorIndex: index, floorY, storeyH, isActive });
        nextBuildKeys.set(
          key,
          furnitureBuildKey({ item: fitted, collision, storeyHeight: storeyH, ghosted: ghostOtherFloors && !isActive, peopleModelReady })
        );
      });
    }

    const diff = diffFurniture(new Map([...meshes].map(([key, entry]) => [key, entry.buildKey])), nextBuildKeys);
    for (const key of diff.removed) {
      const entry = meshes.get(key);
      if (entry) removeAndDispose(scene, entry.group);
      meshes.delete(key);
      changed = true;
    }
    for (const key of diff.built) {
      const spec = planned.get(key);
      const buildKey = nextBuildKeys.get(key);
      if (!spec || buildKey === undefined) continue;
      const stale = meshes.get(key);
      if (stale) removeAndDispose(scene, stale.group);
      const group = createFurnitureModel(THREE, spec.fitted, spec.collision, spec.storeyH);
      // Covers builder parts that bypass the shared material() helper (#167).
      if (spec.collision) applyCollisionTint(group);
      if (ghostOtherFloors && !spec.isActive) ghostifyGroup(group);
      group.userData.type = ROOM_OBJECT_TAGS.Furniture;
      group.userData.id = spec.item.id;
      scene.add(group);
      meshes.set(key, { group, buildKey });
      changed = true;
    }
    for (const [key, spec] of planned) {
      const group = meshes.get(key)?.group;
      const position = spec.item.position;
      if (!group || !position) continue;
      const rotation = spec.item.rotation ?? 0;
      const scaleX = spec.item.mirrored ? -1 : 1;
      if (
        group.position.x !== position.x || group.position.y !== spec.floorY || group.position.z !== position.z ||
        group.rotation.y !== rotation || group.scale.x !== scaleX
      ) {
        group.position.set(position.x, spec.floorY, position.z);
        group.rotation.y = rotation;
        group.scale.x = scaleX;
        changed = true;
      }
      group.userData.floorIndex = spec.floorIndex;
      group.userData.locked = spec.item.locked === true || !spec.isActive;
      // Inactive-floor groups are excluded from pointer raycasts entirely
      // (see drag-handlers' furnitureList, #122).
      group.userData.ghostFloor = !spec.isActive;
    }

    // Bump the revision so the drag/hover raycast pre-filter cache re-reads
    // the set and its ghostFloor flags, and a gesture begun before this
    // change aborts (drag-handlers). Recompute the static shadow map only
    // when a shadow caster was added, removed or moved.
    if (changed) applyStoreyRange(scene, storeyRangeRef.current);
    scene.userData[FURNITURE_REVISION_KEY] =
      ((scene.userData[FURNITURE_REVISION_KEY] as number | undefined) ?? 0) + 1;
    if (changed) requestShadowUpdate();
    // Keyed on the plan's signatures, not `layout.floors` identity: wall
    // paint, floor patterns and interior walls give the floors a new
    // identity without touching an item, and rebuilt every mesh plus the
    // shadow map per colour-input event (#214). storeyHeightsKey covers the
    // floor elevations and itemForStorey's fitting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef,
    itemsKey, collisionKey, storeyHeightsKey,
    activeFloorIndex, allFloors, ghostOtherFloors,
    // Not read in the body: createFurnitureModel picks the rigged person up
    // from the model cache, and this re-runs the build once it's filled.
    peopleModelReady,
  ]);

  // Selection / highlight outlines. Kept out of the furniture effect above so
  // a selection click only swaps the outline LineSegments instead of
  // touching the furniture meshes.
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    const outlineIds = new Set<string>([...extraSelectedIds, ...highlightedIds]);
    if (selectedItemId) outlineIds.add(selectedItemId);
    const activePlan = furniturePlan.find((floor) => floor.index === activeFloorIndex);
    const planIndexById = new Map(activePlan?.items.map((item, i) => [item.id, i]) ?? []);

    for (const group of scene.children) {
      if (group.userData.type !== ROOM_OBJECT_TAGS.Furniture) continue;
      const current = group.children.find((child) => child.userData.type === 'selection-outline');
      const id = group.userData.id as string;
      const planIndex = group.userData.floorIndex === activeFloorIndex && outlineIds.has(id) ? planIndexById.get(id) : undefined;
      const item = planIndex === undefined ? undefined : activePlan?.items[planIndex];

      let wanted: { accent: number; width: number; depth: number; band: { bottom: number; top: number }; signature: string } | null = null;
      if (item && planIndex !== undefined && activePlan) {
        const isSelected = selectedItemId === id || extraSelectedIds.has(id);
        const collision = activePlan.collisions[planIndex] === true;
        const accent = isSelected
          ? selectedItemId === id
            ? collision
              ? 0xff6666
              : 0x00ff00
            : 0x42a5f5
          : 0xfacc15;
        // Around the built mesh, not floor-to-height: a painting hangs at 0.8 m
        // and a window starts at its sill (#376).
        const band = mountBand(itemForStorey(item, activeFloor), storeyHeight(activeFloor));
        wanted = { accent, width: item.width, depth: item.depth, band, signature: `${accent}|${item.width}|${item.depth}|${band.bottom}|${band.top}` };
      }

      // An outline that already matches stays: the group carries it through a
      // move or turn, and disposing its material would release the line shader
      // program, recompiled on the next frame (#404).
      if (current && current.userData.signature === wanted?.signature) continue;
      if (current) {
        group.remove(current);
        disposeObject(current);
      }
      if (!wanted) continue;

      const { accent, width, depth, band } = wanted;
      const geometry = new THREE.BoxGeometry(width, band.top - band.bottom, depth);
      const edges = new THREE.EdgesGeometry(geometry);
      geometry.dispose();
      const outline = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: accent, linewidth: 2 })
      );
      outline.position.y = (band.bottom + band.top) / 2;
      outline.userData.type = 'selection-outline';
      outline.userData.signature = wanted.signature;
      // Decoration, not a pointer target: the furniture raycast is recursive
      // and a line's pick threshold would give the item a hit halo (#333).
      outline.raycast = () => {};
      group.add(outline);
    }
    // The furniture effect above destroys the outline children of every group
    // it rebuilds, so this effect also carries every one of its keys
    // that it doesn't read itself — otherwise a selected item loses its
    // outline after a Show-All-Floors or wall-display toggle, or once the
    // rigged person model loads (#335). It reads the same plan, so it is
    // keyed on the same signatures (#214).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady, invalidate, threeModuleRef, sceneRef,
    activeFloorIndex, selectedItemId, extraSelectedIds, highlightedIds,
    itemsKey, collisionKey, storeyHeightsKey, allFloors, ghostOtherFloors, peopleModelReady,
  ]);

  // The active storey while the others are ghosted, else -1: its cones stay
  // over the world (#552). One number, so the overlays key on nothing wider.
  const ghostedActiveStorey = ghostOtherFloors ? activeFloorIndex : -1;

  // Wi-Fi rings + camera vision cones. Independently tagged overlays, so
  // toggling them (or editing items) never touches the furniture meshes.
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    removeTagged(scene, ROOM_OBJECT_TAGS.Signal, ROOM_OBJECT_TAGS.CameraVision);
    if (!view.showWiFiSignals && !view.showCameraVision) return;

    // A cone with a storey drawn above it, or seen by the walker, is hidden
    // by floor plates and walls; the top storey's, and the active one's under
    // ghosted storeys, paint over the world (#552).
    const topStorey = furniturePlan.reduce((top, floor) => Math.max(top, floor.index), -1);
    for (const { index, items } of furniturePlan) {
      const firstChild = scene.children.length;
      const floorY = floorElevation(layout.floors, index);
      if (view.showWiFiSignals) {
        addSignalOverlays(THREE, scene, items, floorY);
      }
      if (view.showCameraVision) {
        addVisionCones(THREE, scene, items, floorY, index, storeyHeight(layout.floors[index]), {
          occludable: visionConesOccludable(index, topStorey, walkthroughActive, ghostedActiveStorey),
        });
      }
      // Hidden with their storey while walking (#552).
      tagStorey(scene, firstChild, index);
    }
    applyStoreyRange(scene, storeyRangeRef.current);
    // Keyed on what the overlays read, not `layout.floors` identity (#214)
    // nor every item edit (#409); the plan already follows the active floor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady, invalidate, threeModuleRef, sceneRef,
    overlaysKey, storeyHeightsKey,
    view.showWiFiSignals, view.showCameraVision, walkthroughActive, ghostedActiveStorey,
  ]);

  // Lighting. The sun's shadow camera is fitted to everything that casts a
  // shadow (#282); the box is a string so the effect keys on its value.
  const shadowBoxKey = JSON.stringify(
    shadowCasterBounds({
      width: layout.width,
      depth: layout.height,
      eavesY: buildingHeight(layout.floors),
      storeys: layout.floors.length,
      ...(layout.terrain ? { terrain: layout.terrain } : {}),
      ...(layout.frontage ? { frontage: layout.frontage } : {}),
      ...(layout.neighbours ? { neighbours: layout.neighbours } : {}),
    })
  );
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    // The weather overcasts the same profile and tints the lot's ground (#189).
    applyTimeOfDay(THREE, scene, view.timeOfDay, view.weather, JSON.parse(shadowBoxKey) as ShadowBox);
    // The sun's angle/position changed, so the (static) shadow map must be
    // recomputed or shadows would stay frozen at the previous time of day.
    requestShadowUpdate();
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, view.timeOfDay, view.weather, shadowBoxKey]);

  // Lamps (#393): a fixed pool of point lights given to the lamps nearest
  // where the viewer is — the orbit target, or the walker in walkthrough —
  // re-assigned on an hour step, a lamp edit, and, at night with more lamps
  // than lights, when that point has moved a metre: a cheap check every
  // 400 ms catches orbit gestures, presets, floor switches and walking alike,
  // never per frame. Point lights cast no shadow, so neither the sky nor the
  // shadow map is rebuilt here.
  const lampLevel = computeSkyProfile(view.timeOfDay).lamps;
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const scene = sceneRef.current;
    if (!scene) return;

    const lamps = JSON.parse(lampsKey) as LampLight[];
    const focusPoint = (): { x: number; y: number; z: number } => {
      const camera = cameraRef.current;
      const target = walkthroughActive ? camera?.position : controlsRef.current?.target;
      return target ? { x: target.x, y: target.y, z: target.z } : { x: 0, y: 0, z: 0 };
    };
    let last = focusPoint();
    const assign = (focus: { x: number; y: number; z: number }) => {
      last = focus;
      applyLampPool(scene, planLampPool(lamps, focus, lampLevel));
      invalidate();
    };
    assign(last);
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    // Before dusk, compile the lit-pool shaders so the lamps come on without
    // a stall; repeated each hour step, it only compiles what is new.
    if (lampLevel === 0 && lamps.length > 0 && isLampPrewarmHour(view.timeOfDay) && renderer && camera) {
      prewarmLampPool(renderer, scene, camera);
    }
    // With no more lamps than lights every lamp is lit wherever you look.
    if (lampLevel === 0 || lamps.length <= LAMP_POOL_SIZE) return;
    const timer = window.setInterval(() => {
      const focus = focusPoint();
      if (Math.hypot(focus.x - last.x, focus.y - last.y, focus.z - last.z) > LAMP_REASSIGN_DISTANCE) assign(focus);
    }, 400);
    return () => window.clearInterval(timer);
  }, [isReady, invalidate, sceneRef, controlsRef, rendererRef, cameraRef, lampsKey, lampLevel, view.timeOfDay, walkthroughActive]);

  // Outdoor
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    setOutdoorVisible(THREE, scene, view.showOutdoor, layout.width, layout.height, {
      ...(layout.terrain ? { terrain: layout.terrain } : {}),
      ...(layout.neighbours ? { neighbours: layout.neighbours } : {}),
      ...(layout.frontage ? { frontage: layout.frontage } : {}),
    });
    // Trees/shrubs are shadow casters; the shadow map is static (autoUpdate off)
    // so it must be told the caster set changed.
    requestShadowUpdate();
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, view.showOutdoor, layout.width, layout.height, layout.terrain, layout.neighbours, layout.frontage]);

  // The street of neighbours (#202, #310). Never touched by applyWallDisplay,
  // so they stay put in every wall-display mode (#201). Keyed on exactly what
  // the generator reads — the neighbour flags and seed, the roof's style and
  // colour, the two ground heights, the road line — not on the whole
  // `layout.roof` / `layout.terrain` objects, so a dormer drag or a colour
  // picker tick doesn't rebuild the street (#283).
  const neighboursKey = JSON.stringify(layout.neighbours ?? null);
  const roofStyle = layout.roof?.style;
  const roofColor = layout.roof?.color;
  const terrainFrontY = layout.terrain?.frontY;
  const terrainBackY = layout.terrain?.backY;
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    if (!hasNeighbours(layout.neighbours)) {
      removeNeighbours(scene);
    } else {
      const houses = generateStreet({
        width: layout.width,
        depth: layout.height,
        floorYs: layout.floors.map((_floor, index) => floorElevation(layout.floors, index)),
        eavesY: buildingHeight(layout.floors),
        ...(roofStyle ? { roof: { style: roofStyle, ...(roofColor ? { color: roofColor } : {}) } } : {}),
        ...(terrainFrontY !== undefined && terrainBackY !== undefined
          ? { terrain: { frontY: terrainFrontY, backY: terrainBackY } }
          : {}),
        ...(layout.frontage ? { frontage: layout.frontage } : {}),
        ...(layout.neighbours ? { neighbours: layout.neighbours } : {}),
      });
      buildNeighbours(THREE, scene, houses);
    }
    requestShadowUpdate();
    // layout.floors is read for storey heights only (storeyHeightsKey +
    // floor count), and layout.neighbours / roof / terrain through the
    // narrow keys above, so an item edit doesn't rebuild the neighbours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, layout.width, layout.height, layout.floors.length, storeyHeightsKey, neighboursKey, roofStyle, roofColor, terrainFrontY, terrainBackY, layout.frontage]);

  // Interior walls
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    clearInteriorWalls(scene);
    const floorsToRender = allFloors
      ? layout.floors.map((floor, index) => ({ floor, index }))
      : [{ floor: activeFloor, index: activeFloorIndex }];

    // The porch back wall is an ordinary partition, but partitions stop 0.4 m
    // short of the ceiling while the porch soffit sits at `topY`: on any
    // storey under 2.8 m that left an open slot from the street into the
    // house (#275). It gets its own height — at least the soffit, never
    // above its storey (the reducer keeps the recess on the street storey).
    const entrance = layout.entrance
      ? entranceGeometry(layout.entrance, {
          width: layout.width,
          depth: layout.height,
          floors: layout.floors,
          ...(layout.terrain ? { terrain: layout.terrain } : {}),
        })
      : null;

    for (const { floor, index } of floorsToRender) {
      const walls = floor.interiorWalls ?? [];
      if (walls.length === 0) continue;
      const firstChild = scene.children.length;
      const isActive = index === activeFloorIndex;
      const floorY = floorElevation(layout.floors, index);
      const wallHeight = interiorWallHeight(floor);
      const wallHeights =
        entrance && index === entrance.floorIndex
          ? new Map([[
              ENTRANCE_WALL_ID,
              Math.min(storeyHeight(floor) - 0.01, Math.max(wallHeight, entrance.topY - floorY)),
            ]])
          : undefined;
      renderInteriorWalls(
        THREE, scene, walls,
        floorY,
        otherFloorGhostOpacity(allFloors, wallDisplay, isActive),
        {
          openingCandidates: floor.items,
          roomWidth: layout.width,
          roomDepth: layout.height,
          wallHeight,
          ...(wallHeights ? { wallHeights } : {}),
          storeyHeight: storeyHeight(floor),
        }
      );
      tagStorey(scene, firstChild, index);
    }
    applyStoreyRange(scene, storeyRangeRef.current);
    // Walls come out visible and this runs after the cutaway effect: re-apply
    // the display so walls-down survives a rebuild, e.g. the ghosting flip on
    // leaving walkthrough with "show all floors" on (#359).
    const camera = cameraRef.current;
    if (camera) {
      applyWallDisplay(scene, camera.position.x, camera.position.z, wallDisplay, layout.width, layout.height);
    }
    // Interior walls cast shadows — recompute the static shadow map after any
    // add/remove/re-extrude so their cast shadows don't go stale.
    requestShadowUpdate();
    // layout.floors/activeFloor are read for the wall segments and the
    // door/window opening candidates only; the two keys cover exactly that,
    // so a furniture edit doesn't re-extrude every interior wall.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, cameraRef, interiorWallsKey, wallOpeningsKey, storeyHeightsKey, shellActiveKey, allFloors, ghostOtherFloors, layout.width, layout.height, layout.entrance, layout.terrain]);

  // Which storeys are drawn while walking indoors (#446). Declared after the
  // shell, partition and furniture effects, so a rebuild in the same commit
  // is covered; those effects apply the range to what they add as well.
  useEffect(() => {
    if (!isReady) return;
    const scene = sceneRef.current;
    if (!scene) return;
    applyStoreyRange(scene, { from: shownFrom, to: shownTo });
    const camera = cameraRef.current;
    if (camera) applyWallDisplay(scene, camera.position.x, camera.position.z, wallDisplay, layout.width, layout.height);
    requestShadowUpdate();
    invalidate();
    // wallDisplay and the footprint are read to re-apply the display only;
    // the cutaway effect owns changes to them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, sceneRef, cameraRef, shownFrom, shownTo]);

  // Cyan outline on selected wall. Declared AFTER the shell + interior-wall
  // rebuild effects and keyed on the same rebuild keys, so it always snapshots
  // the CURRENT wall mesh. If it ran before the rebuilds (or without those
  // keys) a hidden/moved/re-extruded wall would leave a stale floating outline.
  useEffect(() => {
    invalidate();
    if (!isReady) return undefined;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return undefined;

    for (const child of [...scene.children]) {
      if (child.userData.type === 'wall-selection') removeAndDispose(scene, child);
    }
    if (!selectedWall) return undefined;

    const tag = selectedWall.kind === 'interior' ? 'interior-wall' : 'wall';
    const wallMesh = scene.children.find(
      (obj) => obj.userData.type === tag && obj.userData.wallId === selectedWall.id
    ) as ThreeNS.Mesh | undefined;
    if (!wallMesh) return undefined;

    const edges = new THREE.EdgesGeometry(wallMesh.geometry);
    const material = new THREE.LineBasicMaterial({
      color: 0x7ff3ff,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const outline = new THREE.LineSegments(edges, material);
    outline.position.copy(wallMesh.position);
    outline.rotation.copy(wallMesh.rotation);
    outline.scale.copy(wallMesh.scale);
    outline.renderOrder = 999;
    outline.userData.type = 'wall-selection';
    // Owner reference + initial visibility: applyWallDisplay keeps the
    // outline in lockstep with its wall on every orbit, and a wall already
    // hidden by cutaway must not spawn a visible ghost outline (#133).
    outline.userData.ownerTag = tag;
    outline.userData.wallId = selectedWall.id;
    outline.visible = wallMesh.visible;
    scene.add(outline);
    invalidate();

    return () => {
      scene.remove(outline);
      edges.dispose();
      material.dispose();
    };
    // Keyed on the shell + interior-wall rebuild keys (not layout.floors
    // identity) so the outline re-snapshots the fresh mesh after any wall
    // rebuild, hide, or move — without rebuilding on unrelated furniture edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady, invalidate, threeModuleRef, sceneRef, rendererRef, cameraRef,
    selectedWall, activeFloorIndex,
    shellFinishesKey, wallOpeningsKey, interiorWallsKey, storeyHeightsKey,
    layout.width, layout.height, allFloors, ghostOtherFloors,
  ]);

  // Measurement markers
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    if (!view.measurementMode || measurementPoints.length === 0) {
      clearMeasurement(scene);
      return;
    }
    renderMeasurement(THREE, scene, measurementPoints, activeFloorY);
  }, [isReady, invalidate, threeModuleRef, sceneRef, view.measurementMode, measurementPoints, activeFloorY]);

  // Item labels
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    if (!view.showItemLabels) {
      clearItemLabels(scene);
      return;
    }
    renderItemLabels(THREE, scene, activeFloor.items, activeFloorY);
    // activeFloor.items is read through labelsKey only (#409).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, threeModuleRef, sceneRef, view.showItemLabels, labelsKey, activeFloorY]);

  // Roof (#283). Which storey is active only shows or hides it: the roof is
  // built while it is on screen and kept, hidden, below the top storey, so a
  // floor switch no longer rebuilds the roof and every dormer. A roof edit
  // made down there rebuilds it on the way back up, not while hidden.
  // Walking indoors, the roof shows only from the storeys next to it.
  const roofOnStorey =
    activeFloorIndex === layout.floors.length - 1 ||
    (shownTo >= 0 ? shownTo >= layout.floors.length - 1 : allFloors);
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    if (!layout.roof || layout.roof.style === 'none') {
      removeRoof(scene);
      delete scene.userData[ROOF_BUILD_KEY];
      // The roof is a shadow caster; the static shadow map must be refreshed
      // whether the roof was just built or removed.
      requestShadowUpdate();
      return;
    }

    const baseY = buildingHeight(layout.floors);
    const buildKey = JSON.stringify([layout.roof, layout.width, layout.height, baseY]);
    if (roofOnStorey && scene.userData[ROOF_BUILD_KEY] !== buildKey) {
      buildRoof(THREE, { scene, width: layout.width, depth: layout.height, baseY, spec: layout.roof });
      scene.userData[ROOF_BUILD_KEY] = buildKey;
      requestShadowUpdate();
    }
    setRoofOnStorey(scene, roofOnStorey);
    // buildRoof adds meshes visible; only applyWallDisplay hides the roof in
    // cutaway/walls-down mode, and it otherwise runs on orbit — so a roof
    // rebuilt while the walls are open would pop in until the camera moves (#119).
    const camera = cameraRef.current;
    if (camera && applyWallDisplay(scene, camera.position.x, camera.position.z, wallDisplay, layout.width, layout.height)) {
      requestShadowUpdate();
    }
    // layout.floors is read for the eaves height only (floor count + storey
    // heights); keying on its identity would rebuild the roof on every item edit.
    // wallDisplay is read for the initial visibility only: the cutaway effect
    // re-applies it on change, so a display flip needn't rebuild the roof.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, cameraRef, layout.roof, layout.width, layout.height, layout.floors.length, storeyHeightsKey, roofOnStorey]);

  // Walkthrough attic (#487): walking indoors where the top storey shows,
  // the roof's shingled underside gives way to a plain ceiling that opens
  // into a well under each dormer. Declared after the roof effect, so a roof
  // rebuilt in the same commit is the one whose shell this hides.
  const atticCeiling =
    walkthroughActive && walkIndoors && shownTo >= layout.floors.length - 1 && !!layout.roof && layout.roof.style !== 'none';
  useEffect(() => {
    if (!isReady || !atticCeiling || !layout.roof) return undefined;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return undefined;
    const wells = buildAtticCeiling(THREE, {
      scene,
      width: layout.width,
      depth: layout.height,
      baseY: buildingHeight(layout.floors),
      spec: layout.roof,
    });
    if (wells) setRoofShellHidden(scene, true);
    invalidate();
    return () => {
      removeAtticCeiling(scene);
      setRoofShellHidden(scene, false);
      invalidate();
    };
    // layout.floors is read for the eaves height only, as in the roof effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, threeModuleRef, sceneRef, atticCeiling, layout.roof, layout.width, layout.height, layout.floors.length, storeyHeightsKey]);

  // 2D top-down view. The backing store is sized to the container's
  // clientWidth/clientHeight × devicePixelRatio (via a ResizeObserver) so the
  // aspect ratio matches the on-screen element (circles stay circular) and the
  // render is crisp on retina; a resize re-paints. The floor-plan repaint
  // handler lets an async image decode trigger a full repaint in the correct
  // layer order.
  // The latest plan paint, for the occluder observer below.
  const paint2DRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    invalidate();
    if (!view.view2D) return undefined;
    const canvas = canvas2DRef.current;
    if (!canvas) return undefined;

    const keepOut = floorKeepOut(entranceBuilding, activeFloorIndex);
    const { bounds: fitBounds, offPlan } = planViewFit(layout, activeFloor);
    const paint = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      const backingWidth = Math.round(width * dpr);
      const backingHeight = Math.round(height * dpr);
      // Only resize the backing store when it actually changes — assigning
      // canvas.width/height clears the canvas even when the value is unchanged.
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;

      const { insets, padding } = planFit(canvas, boundsSize(fitBounds));
      render2DTopDown({
        canvas,
        layout,
        floor: activeFloor,
        selectedItemId,
        extraSelectedIds,
        showMeasurements: view.showMeasurements,
        showWiFiSignals: view.showWiFiSignals,
        showHeatmap: view.showHeatmap,
        hasCollision: (item) => hasCollisions(item, activeFloor.items, layout.width, layout.height, { keepOut, interiorWalls: activeFloor.interiorWalls, storeyHeight: storeyHeight(activeFloor) }),
        // The plan fits the room and the items outside it, in the part of
        // the canvas the HUD leaves free (#381); the pointer handlers read
        // the same bounds and insets (use-canvas-2d-interaction).
        fitBounds,
        offPlan,
        insets,
        padding,
      });
    };

    const removeRepaintHandler = addFloorPlanRepaintHandler(paint);
    paint2DRef.current = paint;
    paint();

    const observer = new ResizeObserver(paint);
    observer.observe(canvas);

    // The ResizeObserver watches the content box, which doesn't change when
    // only devicePixelRatio does (window dragged between 1× and 2× monitors),
    // leaving a stale backing store (#226). A matchMedia query on the current
    // ratio fires exactly when the ratio leaves it; each fire repaints and
    // re-arms a fresh query for the new ratio.
    let dprQuery: MediaQueryList | null = null;
    const onDprChange = () => {
      paint();
      armDprListener();
    };
    const armDprListener = () => {
      dprQuery?.removeEventListener('change', onDprChange);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprQuery.addEventListener('change', onDprChange);
    };
    armDprListener();

    return () => {
      dprQuery?.removeEventListener('change', onDprChange);
      observer.disconnect();
      removeRepaintHandler();
      if (paint2DRef.current === paint) paint2DRef.current = null;
    };
  }, [invalidate, canvas2DRef, view.view2D, view.showMeasurements, view.showWiFiSignals, view.showHeatmap, layout, activeFloor, activeFloorIndex, entranceBuilding, selectedItemId, extraSelectedIds]);

  // The dock folding, the tray opening or a panel mounting moves the plan's
  // free area: repaint. Keyed on the view alone, so a layout edit doesn't
  // tear the observers down and set them up again.
  useEffect(() => {
    if (!view.view2D) return undefined;
    return observeSceneOccluders(() => paint2DRef.current?.());
  }, [view.view2D]);
}

export { measurementDistance } from '../three/measurement';
