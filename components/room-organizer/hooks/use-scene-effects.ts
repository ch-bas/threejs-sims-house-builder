import { useEffect, useMemo, type RefObject, type MutableRefObject } from 'react';
import { render2DTopDown, setFloorPlanRepaintHandler } from '../canvas-2d/render';
import { hasCollisions } from '../lib/geometry';
import { FLOOR_HEIGHT_METERS } from '../lib/types';
import { disposeObject, removeAndDispose } from '../three/builder-utils';
import { addVisionCones } from '../three/camera-vision';
import { FURNITURE_REVISION_KEY } from '../three/drag-handlers';
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
import { setOutdoorVisible } from '../three/outdoor';
import { buildRoof, removeRoof } from '../three/roof';
import { ROOM_OBJECT_TAGS, applyWallDisplay, buildRoom, removeTagged } from '../three/room-builder';
import { addSignalOverlays } from '../three/signal-overlay';
import { computeFloorOpenings, computeWallOpenings } from '../three/wall-openings';
import type { FloorLayout, RoomLayout, ViewSettings } from '../lib/types';
import type * as ThreeNS from 'three';

interface MaterialLike {
  transparent: boolean;
  opacity: number;
}

interface MeshLike {
  material?: MaterialLike | readonly MaterialLike[] | null;
}

function ghostifyGroup(group: import('three').Object3D, opacity = 0.3): void {
  group.traverse((node) => {
    const material = (node as MeshLike).material;
    if (!material) return;
    const apply = (m: MaterialLike) => {
      m.transparent = true;
      m.opacity = Math.min(m.opacity, opacity);
    };
    if (Array.isArray(material)) {
      material.forEach(apply);
    } else {
      apply(material as MaterialLike);
    }
  });
}

export interface UseSceneEffectsParams {
  isReady: boolean;
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
  const activeFloorY = activeFloorIndex * FLOOR_HEIGHT_METERS;

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
    renderInteriorWallPreview(THREE, scene, wallDraft, wallSnapResult.point, activeFloorY);
  }, [isReady, invalidate, threeModuleRef, sceneRef, view.drawWallMode, wallDraft, wallSnapResult, activeFloorY]);

  // Build floor + walls
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    removeTagged(scene, ROOM_OBJECT_TAGS.Floor, ROOM_OBJECT_TAGS.Wall);

    const floorsToRender = view.showAllFloors
      ? layout.floors.map((floor, index) => ({ floor, index }))
      : [{ floor: activeFloor, index: activeFloorIndex }];

    for (const { floor, index } of floorsToRender) {
      const isActive = index === activeFloorIndex;
      const wallOpenings = computeWallOpenings(
        floor.items,
        layout.width,
        layout.height,
        3,
        floor.interiorWalls ?? []
      );
      // Stairs on the floor below create openings in this floor's plane.
      const floorBelow = index > 0 ? layout.floors[index - 1] : undefined;
      const floorOpenings = computeFloorOpenings(floorBelow);
      buildRoom(THREE, {
        scene,
        width: layout.width,
        depth: layout.height,
        floorColor: floor.floorColor,
        floorPattern: floor.floorPattern,
        wallPattern: floor.wallPattern,
        wallColors: floor.wallColors,
        wallOpenings,
        hiddenWalls: floor.hiddenWalls,
        floorOpenings,
        floorPlanImage: index === 0 ? layout.floorPlanImage ?? null : null,
        floorPlanOpacity: layout.floorPlanOpacity ?? 0.5,
        floorPlanFitMode: layout.floorPlanFitMode ?? 'stretch',
        floorPlan3DEffect: view.floorPlan3DEffect,
        yOffset: index * FLOOR_HEIGHT_METERS,
        ghostOpacity: view.showAllFloors && !isActive ? 0.25 : undefined,
        onTextureLoaded: invalidate,
      });
    }

    const camera = cameraRef.current;
    if (camera) {
      applyWallDisplay(scene, camera.position.x, camera.position.z, view.wallDisplay, layout.width, layout.height);
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
    layout.width, layout.height, shellFinishesKey, wallOpeningsKey,
    layout.floorPlanImage, layout.floorPlanOpacity, layout.floorPlanFitMode,
    view.floorPlan3DEffect, view.showAllFloors, view.wallDisplay,
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
      applyWallDisplay(scene, camera.position.x, camera.position.z, view.wallDisplay, layout.width, layout.height);
      invalidate();
    };
    apply();
    controls.addEventListener('change', apply);
    return () => controls.removeEventListener('change', apply);
  }, [isReady, invalidate, threeModuleRef, sceneRef, rendererRef, cameraRef, controlsRef, view.wallDisplay, layout.width, layout.height]);

  // Furniture meshes
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    removeTagged(scene, ROOM_OBJECT_TAGS.Furniture);

    const floorsToRender = view.showAllFloors
      ? layout.floors.map((floor, index) => ({ floor, index }))
      : [{ floor: activeFloor, index: activeFloorIndex }];

    for (const { floor, index } of floorsToRender) {
      const isActive = index === activeFloorIndex;
      const floorY = index * FLOOR_HEIGHT_METERS;

      for (const item of floor.items) {
        if (!item.position) continue;

        const collision = hasCollisions(item, floor.items, layout.width, layout.height);
        const group = createFurnitureModel(THREE, item, collision);
        group.position.set(item.position.x, floorY, item.position.z);
        group.rotation.y = item.rotation ?? 0;
        if (item.mirrored) group.scale.x = -1;
        group.userData.type = ROOM_OBJECT_TAGS.Furniture;
        group.userData.id = item.id;
        group.userData.floorIndex = index;
        group.userData.locked = item.locked === true || !isActive;

        if (!isActive && view.showAllFloors) {
          ghostifyGroup(group);
        }

        scene.add(group);
      }
    }

    // The furniture set just changed — bump the revision so the drag/hover
    // raycast pre-filter cache rebuilds its list, and recompute the static
    // shadow map now that shadow casters were added/removed/moved.
    scene.userData[FURNITURE_REVISION_KEY] =
      ((scene.userData[FURNITURE_REVISION_KEY] as number | undefined) ?? 0) + 1;
    requestShadowUpdate();
  }, [
    isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef,
    layout.floors, layout.width, layout.height,
    activeFloor, activeFloorIndex, view.showAllFloors,
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

    const itemsById = new Map(activeFloor.items.map((item) => [item.id, item]));
    for (const group of scene.children) {
      if (group.userData.type !== ROOM_OBJECT_TAGS.Furniture) continue;
      if (group.userData.floorIndex !== activeFloorIndex) continue;
      const id = group.userData.id as string;
      if (!outlineIds.has(id)) continue;
      const item = itemsById.get(id);
      if (!item) continue;

      const isSelected = selectedItemId === id || extraSelectedIds.has(id);
      const collision = hasCollisions(item, activeFloor.items, layout.width, layout.height);
      const accent = isSelected
        ? selectedItemId === id
          ? collision
            ? 0xff6666
            : 0x00ff00
          : 0x42a5f5
        : 0xfacc15;
      const geometry = new THREE.BoxGeometry(item.width, item.height, item.depth);
      const edges = new THREE.EdgesGeometry(geometry);
      geometry.dispose();
      const outline = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: accent, linewidth: 2 })
      );
      outline.position.y = item.height / 2;
      outline.userData.type = 'selection-outline';
      group.add(outline);
    }
    // view.showAllFloors is included because the furniture effect rebuilds all
    // groups when it toggles (destroying the outline LineSegments children); the
    // outline effect must re-run afterward to reattach outlines, otherwise a
    // selected item is left with no outline after a Show-All-Floors toggle.
  }, [
    isReady, invalidate, threeModuleRef, sceneRef,
    activeFloor, activeFloorIndex, layout.width, layout.height,
    selectedItemId, extraSelectedIds, highlightedIds, view.showAllFloors,
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

    const floorsToRender = view.showAllFloors
      ? layout.floors.map((floor, index) => ({ floor, index }))
      : [{ floor: activeFloor, index: activeFloorIndex }];

    for (const { floor, index } of floorsToRender) {
      const floorY = index * FLOOR_HEIGHT_METERS;
      if (view.showWiFiSignals) {
        addSignalOverlays(THREE, scene, floor.items, floorY);
      }
      if (view.showCameraVision) {
        addVisionCones(THREE, scene, floor.items, floorY, index);
      }
    }
  }, [
    isReady, invalidate, threeModuleRef, sceneRef,
    layout.floors, activeFloor, activeFloorIndex,
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
          height: item.height + index * FLOOR_HEIGHT_METERS,
        }))
    );

    applyTimeOfDay(THREE, scene, view.timeOfDay, lampPositions);
    // The sun's angle/position changed, so the (static) shadow map must be
    // recomputed or shadows would stay frozen at the previous time of day.
    requestShadowUpdate();
    // layout.floors is read for lamp positions only; lampsKey covers exactly
    // that, so a non-lamp item edit doesn't rebuild the sky and lights.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, view.timeOfDay, lampsKey]);

  // Outdoor
  useEffect(() => {
    invalidate();
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    setOutdoorVisible(THREE, scene, view.showOutdoor, layout.width, layout.height);
  }, [isReady, invalidate, threeModuleRef, sceneRef, view.showOutdoor, layout.width, layout.height]);

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

    for (const { floor, index } of floorsToRender) {
      const walls = floor.interiorWalls ?? [];
      if (walls.length === 0) continue;
      const isActive = index === activeFloorIndex;
      renderInteriorWalls(
        THREE, scene, walls,
        index * FLOOR_HEIGHT_METERS,
        view.showAllFloors && !isActive ? 0.25 : undefined,
        { openingCandidates: floor.items, roomWidth: layout.width, roomDepth: layout.height }
      );
    }
    // Interior walls cast shadows — recompute the static shadow map after any
    // add/remove/re-extrude so their cast shadows don't go stale.
    requestShadowUpdate();
    // layout.floors/activeFloor are read for the wall segments and the
    // door/window opening candidates only; the two keys cover exactly that,
    // so a furniture edit doesn't re-extrude every interior wall.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, interiorWallsKey, wallOpeningsKey, activeFloorIndex, view.showAllFloors, layout.width, layout.height]);

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
    shellFinishesKey, wallOpeningsKey, interiorWallsKey,
    layout.width, layout.height, view.showAllFloors, view.wallDisplay,
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
      return;
    }

    buildRoof(THREE, {
      scene,
      width: layout.width,
      depth: layout.height,
      baseY: layout.floors.length * FLOOR_HEIGHT_METERS,
      spec: layout.roof,
    });
  }, [isReady, invalidate, threeModuleRef, sceneRef, layout.roof, layout.width, layout.height, layout.floors.length, activeFloorIndex, view.showAllFloors]);

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
        showMeasurements: view.showMeasurements,
        showWiFiSignals: view.showWiFiSignals,
        showHeatmap: view.showHeatmap,
        hasCollision: (item) => hasCollisions(item, activeFloor.items, layout.width, layout.height),
      });
    };

    setFloorPlanRepaintHandler(paint);
    paint();

    const observer = new ResizeObserver(paint);
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      setFloorPlanRepaintHandler(null);
    };
  }, [invalidate, canvas2DRef, view.view2D, view.showMeasurements, view.showWiFiSignals, view.showHeatmap, layout, activeFloor, selectedItemId]);
}

export { measurementDistance } from '../three/measurement';
