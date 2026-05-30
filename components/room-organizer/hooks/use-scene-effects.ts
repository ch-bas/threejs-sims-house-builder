import { useEffect, type RefObject, type MutableRefObject } from 'react';
import type * as ThreeNS from 'three';
import { render2DTopDown } from '../canvas-2d/render';
import { hasCollisions } from '../lib/geometry';
import type { FloorLayout, RoomLayout, ViewSettings } from '../lib/types';
import { FLOOR_HEIGHT_METERS } from '../lib/types';
import {
  clearInteriorWalls,
  clearPreview as clearWallPreview,
  renderInteriorWalls,
  renderInteriorWallPreview,
} from '../three/interior-walls';
import { clearItemLabels, renderItemLabels } from '../three/item-labels';
import { applyTimeOfDay } from '../three/lighting';
import { clearMeasurement, measurementDistance, renderMeasurement } from '../three/measurement';
import { setOutdoorVisible } from '../three/outdoor';
import { buildRoof, removeRoof } from '../three/roof';
import { addSignalOverlays } from '../three/signal-overlay';
import { ROOM_OBJECT_TAGS, applyWallDisplay, buildRoom, removeTagged } from '../three/room-builder';
import { computeFloorOpenings, computeWallOpenings } from '../three/wall-openings';
import { createFurnitureModel } from '../three/furniture-builders';

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

  // Wall preview during draw mode
  useEffect(() => {
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    if (!view.drawWallMode || !wallDraft || !wallSnapResult) {
      clearWallPreview(scene);
      return;
    }
    renderInteriorWallPreview(THREE, scene, wallDraft, wallSnapResult.point, activeFloorY);
  }, [isReady, threeModuleRef, sceneRef, view.drawWallMode, wallDraft, wallSnapResult, activeFloorY]);

  // Cyan outline on selected wall
  useEffect(() => {
    if (!isReady) return undefined;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return undefined;

    for (const child of [...scene.children]) {
      if (child.userData.type === 'wall-selection') scene.remove(child);
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
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (renderer && camera) renderer.render(scene, camera);

    return () => {
      scene.remove(outline);
      edges.dispose();
      material.dispose();
    };
  }, [isReady, threeModuleRef, sceneRef, rendererRef, cameraRef, selectedWall, layout.floors, activeFloorIndex]);

  // Build floor + walls
  useEffect(() => {
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
      const wallOpenings = computeWallOpenings(floor.items, layout.width, layout.height);
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
        floorOpenings,
        floorPlanImage: index === 0 ? layout.floorPlanImage ?? null : null,
        floorPlanOpacity: layout.floorPlanOpacity ?? 0.5,
        floorPlanFitMode: layout.floorPlanFitMode ?? 'stretch',
        floorPlan3DEffect: view.floorPlan3DEffect,
        yOffset: index * FLOOR_HEIGHT_METERS,
        ghostOpacity: view.showAllFloors && !isActive ? 0.25 : undefined,
        onTextureLoaded: () => {
          const renderer = rendererRef.current;
          const camera = cameraRef.current;
          if (renderer && camera) renderer.render(scene, camera);
        },
      });
    }

    const camera = cameraRef.current;
    if (camera) {
      applyWallDisplay(scene, camera.position.x, camera.position.z, view.wallDisplay, layout.width, layout.height);
    }
  }, [
    isReady, threeModuleRef, sceneRef, rendererRef, cameraRef,
    layout.width, layout.height, layout.floors,
    layout.floorPlanImage, layout.floorPlanOpacity, layout.floorPlanFitMode,
    view.floorPlan3DEffect, view.showAllFloors, view.wallDisplay,
    activeFloor, activeFloorIndex,
  ]);

  // Cutaway on orbit
  useEffect(() => {
    if (!isReady) return undefined;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return undefined;

    const apply = () => {
      applyWallDisplay(scene, camera.position.x, camera.position.z, view.wallDisplay, layout.width, layout.height);
      const renderer = rendererRef.current;
      if (renderer) renderer.render(scene, camera);
    };
    apply();
    controls.addEventListener('change', apply);
    return () => controls.removeEventListener('change', apply);
  }, [isReady, threeModuleRef, sceneRef, rendererRef, cameraRef, controlsRef, view.wallDisplay, layout.width, layout.height]);

  // Furniture meshes
  useEffect(() => {
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;

    removeTagged(scene, ROOM_OBJECT_TAGS.Furniture, ROOM_OBJECT_TAGS.Signal);

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

        if (isActive) {
          const isSelected = selectedItemId === item.id || extraSelectedIds.has(item.id);
          const isHighlighted = highlightedIds.has(item.id);
          if (isSelected || isHighlighted) {
            const geometry = new THREE.BoxGeometry(item.width, item.height, item.depth);
            const edges = new THREE.EdgesGeometry(geometry);
            const accent = isSelected
              ? selectedItemId === item.id
                ? collision
                  ? 0xff6666
                  : 0x00ff00
                : 0x42a5f5
              : 0xfacc15;
            const outline = new THREE.LineSegments(
              edges,
              new THREE.LineBasicMaterial({ color: accent, linewidth: 2 })
            );
            outline.position.y = item.height / 2;
            group.add(outline);
          }
        }

        scene.add(group);
      }

      if (view.showWiFiSignals) {
        addSignalOverlays(THREE, scene, floor.items, floorY);
      }
    }
  }, [
    isReady, threeModuleRef, sceneRef,
    layout.floors, layout.width, layout.height,
    activeFloor, activeFloorIndex,
    selectedItemId, extraSelectedIds, highlightedIds,
    view.showWiFiSignals, view.showAllFloors,
  ]);

  // Lighting
  useEffect(() => {
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
  }, [isReady, threeModuleRef, sceneRef, view.timeOfDay, layout.floors]);

  // Outdoor
  useEffect(() => {
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    setOutdoorVisible(THREE, scene, view.showOutdoor, layout.width, layout.height);
  }, [isReady, threeModuleRef, sceneRef, view.showOutdoor, layout.width, layout.height]);

  // Interior walls
  useEffect(() => {
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
        { openingCandidates: floor.items }
      );
    }
  }, [isReady, threeModuleRef, sceneRef, layout.floors, activeFloor, activeFloorIndex, view.showAllFloors]);

  // Measurement markers
  useEffect(() => {
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    if (!view.measurementMode || measurementPoints.length === 0) {
      clearMeasurement(scene);
      return;
    }
    renderMeasurement(THREE, scene, measurementPoints, activeFloorY);
  }, [isReady, threeModuleRef, sceneRef, view.measurementMode, measurementPoints, activeFloorY]);

  // Item labels
  useEffect(() => {
    if (!isReady) return;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    if (!view.showItemLabels) {
      clearItemLabels(scene);
      return;
    }
    renderItemLabels(THREE, scene, activeFloor.items, activeFloorY);
  }, [isReady, threeModuleRef, sceneRef, view.showItemLabels, activeFloor.items, activeFloorY]);

  // Roof
  useEffect(() => {
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
  }, [isReady, threeModuleRef, sceneRef, layout.roof, layout.width, layout.height, layout.floors.length, activeFloorIndex, view.showAllFloors]);

  // 2D top-down view
  useEffect(() => {
    if (!view.view2D) return;
    const canvas = canvas2DRef.current;
    if (!canvas) return;
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
  }, [view.view2D, view.showMeasurements, view.showWiFiSignals, view.showHeatmap, layout, activeFloor, selectedItemId]);
}

export { measurementDistance } from '../three/measurement';
