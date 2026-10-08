import { useEffect, useMemo, type RefObject, type MutableRefObject } from 'react';
import { addFloorPlanRepaintHandler, render2DTopDown } from '../canvas-2d/render';
import { DEFAULT_FLOOR_PLAN_OPACITY } from '../lib/constants';
import { floorKeepOut, type KeepOutBuilding } from '../lib/floor-keep-out';
import { furnitureCollisionKey, furnitureItemsKey, planFurniture } from '../lib/furniture-scene';
import { hasCollisions } from '../lib/geometry';
import { mountBand } from '../lib/mount-band';
import { hasNeighbours, lowestGround } from '../lib/site';
import { buildingHeight, floorElevation, interiorWallHeight, itemForStorey, storeyHeight } from '../lib/storeys';
import { ENTRANCE_WALL_ID, entranceGeometry, entranceWallCut } from '../lib/street';
import { generateStreet } from '../lib/street-row';
import { sceneWallDisplay, walkthroughCeiling, walkthroughPit } from '../lib/walkthrough-view';
import { disposeObject, removeAndDispose } from '../three/builder-utils';
import { addVisionCones } from '../three/camera-vision';
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
import { applyTimeOfDay } from '../three/lighting';
import { clearMeasurement, renderMeasurement } from '../three/measurement';
import { buildNeighbours, removeNeighbours } from '../three/neighbours';
import { setOutdoorVisible } from '../three/outdoor';
import { buildRoof, removeRoof } from '../three/roof';
import { ROOM_OBJECT_TAGS, applyWallDisplay, buildRoom, clearFloorPlanImageCache, removeTagged } from '../three/room-builder';
import { addSignalOverlays } from '../three/signal-overlay';
import { computeFloorOpenings, computeWallOpenings } from '../three/wall-openings';
import type { FloorLayout, RoomLayout, ViewSettings } from '../lib/types';
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

function ghostifyGroup(group: import('three').Object3D, opacity = 0.3): void {
  fadeGroup(group, opacity);
}

export interface UseSceneEffectsParams {
  isReady: boolean;
  /** Flips once people.glb loads, so placed people rebuild as rigged figures. */
  peopleModelReady?: boolean;
  /** Request a render on the next animation frame (render-on-demand). */
  invalidate: () => void;
  /** Recompute the static shadow map — call after a shadow caster/sun change. */
  requestShadowUpdate: () => void;
  threeModuleRef: MutableRefObject<typeof import('three') | null>;
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
}: UseSceneEffectsParams): void {
  const activeFloorY = floorElevation(layout.floors, activeFloorIndex);

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
  const ghostOtherFloors = otherFloorGhostOpacity(view.showAllFloors, wallDisplay, false) !== undefined;
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
    () => planFurniture(entranceBuilding, view.showAllFloors, activeFloorIndex),
    [entranceBuilding, view.showAllFloors, activeFloorIndex]
  );
  const itemsKey = useMemo(() => furnitureItemsKey(furniturePlan), [furniturePlan]);
  const collisionKey = useMemo(() => furnitureCollisionKey(furniturePlan), [furniturePlan]);

  const lampsKey = useMemo(
    () =>
      JSON.stringify(
        layout.floors.map((floor) =>
          floor.items
            .filter((item) => (item.type === 'lamp' || item.type === 'floor-lamp') && item.position)
            .map((item) => [item.position!.x, item.position!.z, item.height])
        )
      ),
    [layout.floors]
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

    const floorsToRender = view.showAllFloors
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
      const ghostOpacity = otherFloorGhostOpacity(view.showAllFloors, wallDisplay, isActive);
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
    }

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
    view.floorPlan3DEffect, view.showAllFloors, ghostOtherFloors,
    activeFloorIndex,
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

  // Walkthrough enclosure (#359): only the active storey is built, so the
  // walker gets the underside of the storey above, and the stairwells are
  // lined up to the storey above and down to the one below — otherwise the
  // view up or down the stairs runs out into the sky or the garden. Keyed on
  // primitives so nothing is built, or rebuilt, outside walkthrough.
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
      // "Show all floors" draws the real storey above, plate and all.
      above:
        !view.showAllFloors && ceilingY !== undefined && ceilingCapY !== undefined
          ? { y: ceilingY, capY: ceilingCapY, openings: computeFloorOpenings(activeFloor) }
          : null,
      below:
        pitY !== undefined && pitTopY !== undefined && pitFloorColor !== undefined
          ? { y: pitY, topY: pitTopY, openings: computeFloorOpenings(layout.floors[activeFloorIndex - 1]), floorColor: pitFloorColor }
          : null,
      // "Show all floors" builds the real storeys above and below.
      shafts: !view.showAllFloors,
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
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, ceilingY, ceilingCapY, pitY, pitTopY, pitFloorColor, activeFloorIndex, view.showAllFloors, layout.width, layout.height, wallOpeningsKey]);

  // Furniture meshes
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    removeTagged(scene, ROOM_OBJECT_TAGS.Furniture);

    for (const { index, items, collisions } of furniturePlan) {
      const floor = layout.floors[index];
      const isActive = index === activeFloorIndex;
      const floorY = floorElevation(layout.floors, index);

      items.forEach((item, i) => {
        if (!item.position) return;

        const collision = collisions[i] === true;
        // Stairs climb to the floor above and openings are fitted into the
        // storey, so the mesh matches the hole cut for it (#202, #277).
        const group = createFurnitureModel(THREE, itemForStorey(item, floor), collision);
        // Covers builder parts that bypass the shared material() helper (#167).
        if (collision) applyCollisionTint(group);
        group.position.set(item.position.x, floorY, item.position.z);
        group.rotation.y = item.rotation ?? 0;
        if (item.mirrored) group.scale.x = -1;
        group.userData.type = ROOM_OBJECT_TAGS.Furniture;
        group.userData.id = item.id;
        group.userData.floorIndex = index;
        group.userData.locked = item.locked === true || !isActive;
        // Inactive-floor groups are excluded from pointer raycasts entirely
        // (see drag-handlers' furnitureList, #122).
        group.userData.ghostFloor = !isActive;

        if (ghostOtherFloors && !isActive) {
          ghostifyGroup(group);
        }

        scene.add(group);
      });
    }

    // The furniture set just changed — bump the revision so the drag/hover
    // raycast pre-filter cache rebuilds its list, and recompute the static
    // shadow map now that shadow casters were added/removed/moved.
    scene.userData[FURNITURE_REVISION_KEY] =
      ((scene.userData[FURNITURE_REVISION_KEY] as number | undefined) ?? 0) + 1;
    requestShadowUpdate();
    // Keyed on the plan's signatures, not `layout.floors` identity: wall
    // paint, floor patterns and interior walls give the floors a new
    // identity without touching an item, and rebuilt every mesh plus the
    // shadow map per colour-input event (#214). storeyHeightsKey covers the
    // floor elevations and itemForStorey's fitting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef,
    itemsKey, collisionKey, storeyHeightsKey,
    activeFloorIndex, view.showAllFloors, ghostOtherFloors,
    // Not read in the body: createFurnitureModel picks the rigged person up
    // from the model cache, and this re-runs the build once it's filled.
    peopleModelReady,
  ]);

  // Selection / highlight outlines. Kept out of the furniture effect above so
  // a selection click only swaps the outline LineSegments instead of
  // destroying and rebuilding every furniture mesh on the floor.
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    for (const group of scene.children) {
      if (group.userData.type !== ROOM_OBJECT_TAGS.Furniture) continue;
      for (const child of [...group.children]) {
        if (child.userData.type === 'selection-outline') {
          group.remove(child);
          disposeObject(child);
        }
      }
    }

    const outlineIds = new Set<string>([...extraSelectedIds, ...highlightedIds]);
    if (selectedItemId) outlineIds.add(selectedItemId);
    if (outlineIds.size === 0) return;

    const activePlan = furniturePlan.find((floor) => floor.index === activeFloorIndex);
    if (!activePlan) return;
    const planIndexById = new Map(activePlan.items.map((item, i) => [item.id, i]));
    for (const group of scene.children) {
      if (group.userData.type !== ROOM_OBJECT_TAGS.Furniture) continue;
      if (group.userData.floorIndex !== activeFloorIndex) continue;
      const id = group.userData.id as string;
      if (!outlineIds.has(id)) continue;
      const planIndex = planIndexById.get(id);
      const item = planIndex === undefined ? undefined : activePlan.items[planIndex];
      if (planIndex === undefined || !item) continue;

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
      const band = mountBand(itemForStorey(item, activeFloor));
      const geometry = new THREE.BoxGeometry(item.width, band.top - band.bottom, item.depth);
      const edges = new THREE.EdgesGeometry(geometry);
      geometry.dispose();
      const outline = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: accent, linewidth: 2 })
      );
      outline.position.y = (band.bottom + band.top) / 2;
      outline.userData.type = 'selection-outline';
      // Decoration, not a pointer target: the furniture raycast is recursive
      // and a line's pick threshold would give the item a hit halo (#333).
      outline.raycast = () => {};
      group.add(outline);
    }
    // The furniture effect above destroys the outline children whenever it
    // rebuilds the groups, so this effect also carries every one of its keys
    // that it doesn't read itself — otherwise a selected item loses its
    // outline after a Show-All-Floors or wall-display toggle, or once the
    // rigged person model loads (#335). It reads the same plan, so it is
    // keyed on the same signatures (#214).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady, invalidate, threeModuleRef, sceneRef,
    activeFloorIndex, selectedItemId, extraSelectedIds, highlightedIds,
    itemsKey, collisionKey, storeyHeightsKey, view.showAllFloors, ghostOtherFloors, peopleModelReady,
  ]);

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

    for (const { index, items } of furniturePlan) {
      const floorY = floorElevation(layout.floors, index);
      if (view.showWiFiSignals) {
        addSignalOverlays(THREE, scene, items, floorY);
      }
      if (view.showCameraVision) {
        addVisionCones(THREE, scene, items, floorY, index, storeyHeight(layout.floors[index]));
      }
    }
    // Item-content key, not `layout.floors` identity (#214).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady, invalidate, threeModuleRef, sceneRef,
    itemsKey, storeyHeightsKey, activeFloorIndex,
    view.showWiFiSignals, view.showCameraVision, view.showAllFloors,
  ]);

  // Lighting
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    const lampPositions = layout.floors.flatMap((floor, index) =>
      floor.items
        .filter((item) => (item.type === 'lamp' || item.type === 'floor-lamp') && item.position)
        .map((item) => ({
          x: item.position!.x,
          z: item.position!.z,
          // The 0.9 bulb factor belongs to the lamp's own height only —
          // applied after the floor offset it sank upper-floor glows 0.3 m
          // per storey, lighting the floor below (#146).
          height: item.height * 0.9 + floorElevation(layout.floors, index),
        }))
    );

    // The weather overcasts the same profile and tints the lot's ground (#189).
    applyTimeOfDay(THREE, scene, view.timeOfDay, lampPositions, view.weather);
    // The sun's angle/position changed, so the (static) shadow map must be
    // recomputed or shadows would stay frozen at the previous time of day.
    requestShadowUpdate();
    // layout.floors is read for lamp positions only; lampsKey covers exactly
    // that, so a non-lamp item edit doesn't rebuild the sky and lights.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, view.timeOfDay, view.weather, lampsKey, storeyHeightsKey]);

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
    const floorsToRender = view.showAllFloors
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
        otherFloorGhostOpacity(view.showAllFloors, wallDisplay, isActive),
        {
          openingCandidates: floor.items,
          roomWidth: layout.width,
          roomDepth: layout.height,
          wallHeight,
          ...(wallHeights ? { wallHeights } : {}),
          storeyHeight: storeyHeight(floor),
        }
      );
    }
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
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, cameraRef, interiorWallsKey, wallOpeningsKey, storeyHeightsKey, activeFloorIndex, view.showAllFloors, ghostOtherFloors, layout.width, layout.height, layout.entrance, layout.terrain]);

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
    layout.width, layout.height, view.showAllFloors, ghostOtherFloors,
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
  }, [isReady, invalidate, threeModuleRef, sceneRef, view.showItemLabels, activeFloor.items, activeFloorY]);

  // Roof
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    const topFloorIndex = layout.floors.length - 1;
    const showRoof =
      layout.roof &&
      layout.roof.style !== 'none' &&
      (view.showAllFloors || activeFloorIndex === topFloorIndex);

    if (!showRoof || !layout.roof) {
      removeRoof(scene);
      // The roof is a shadow caster; the static shadow map must be refreshed
      // whether the roof was just built or removed.
      requestShadowUpdate();
      return;
    }

    buildRoof(THREE, {
      scene,
      width: layout.width,
      depth: layout.height,
      baseY: buildingHeight(layout.floors),
      spec: layout.roof,
    });
    // buildRoof adds meshes visible; only applyWallDisplay hides the roof in
    // cutaway/walls-down mode, and it otherwise runs on orbit — so a roof
    // rebuilt while the walls are open would pop in until the camera moves (#119).
    const camera = cameraRef.current;
    if (camera) {
      applyWallDisplay(scene, camera.position.x, camera.position.z, wallDisplay, layout.width, layout.height);
    }
    requestShadowUpdate();
    // layout.floors is read for the eaves height only (floor count + storey
    // heights); keying on its identity would rebuild the roof on every item edit.
    // wallDisplay is read for the initial visibility only: the cutaway effect
    // re-applies it on change, so a display flip needn't rebuild the roof.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, cameraRef, layout.roof, layout.width, layout.height, layout.floors.length, storeyHeightsKey, activeFloorIndex, view.showAllFloors]);

  // 2D top-down view. The backing store is sized to the container's
  // clientWidth/clientHeight × devicePixelRatio (via a ResizeObserver) so the
  // aspect ratio matches the on-screen element (circles stay circular) and the
  // render is crisp on retina; a resize re-paints. The floor-plan repaint
  // handler lets an async image decode trigger a full repaint in the correct
  // layer order.
  useEffect(() => {
    invalidate();
    if (!view.view2D) return undefined;
    const canvas = canvas2DRef.current;
    if (!canvas) return undefined;

    const keepOut = floorKeepOut(entranceBuilding, activeFloorIndex);
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

      render2DTopDown({
        canvas,
        layout,
        floor: activeFloor,
        selectedItemId,
        extraSelectedIds,
        showMeasurements: view.showMeasurements,
        showWiFiSignals: view.showWiFiSignals,
        showHeatmap: view.showHeatmap,
        hasCollision: (item) => hasCollisions(item, activeFloor.items, layout.width, layout.height, { keepOut, interiorWalls: activeFloor.interiorWalls }),
      });
    };

    const removeRepaintHandler = addFloorPlanRepaintHandler(paint);
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
    };
  }, [invalidate, canvas2DRef, view.view2D, view.showMeasurements, view.showWiFiSignals, view.showHeatmap, layout, activeFloor, activeFloorIndex, entranceBuilding, selectedItemId, extraSelectedIds]);
}

export { measurementDistance } from '../three/measurement';
