import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ROOF_EAVE_OVERHANG } from '../lib/dormers';
import { streetDryBoxes } from '../lib/street-row';
import { streetSiteOf } from '../lib/walk-collision';
import { modeAfterExplore, rememberModeBeforeExplore } from '../lib/walkthrough-view';
import { useCameraVision } from './use-camera-vision';
import { useNpcs } from './use-npcs';
import { usePeopleModel } from './use-people-model';
import { useWalkthrough, type UseWalkthroughResult, type WalkthroughBuilding } from './use-walkthrough';
import { useWeather } from './use-weather';
import type { EditorViewStore } from './editor-view-store';
import type { UseThreeSceneResult } from './use-three-scene';
import type { KeepOutRect } from '../lib/geometry';
import type { FloorLayout, GameMode, RoomLayout, ViewSettings } from '../lib/types';

export interface UseSceneLifeOptions {
  viewStore: EditorViewStore;
  view: Pick<ViewSettings, 'showNpcs' | 'view2D' | 'weather' | 'showCameraVision'>;
  walkthroughActive: boolean;
  layout: RoomLayout;
  activeFloor: FloorLayout;
  activeFloorIndex: number;
  activeFloorY: number;
  keepOut: readonly KeepOutRect[];
  onFloorChange: (index: number) => void;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  scene: Pick<
    UseThreeSceneResult,
    'isReady' | 'invalidate' | 'requestShadowUpdate' | 'addDecorativeStep' | 'threeModuleRef' | 'sceneRef' | 'cameraRef' | 'controlsRef'
  >;
}

export interface SceneLife {
  walk: UseWalkthroughResult;
  exitWalkthrough: () => void;
  peopleModelReady: boolean;
}

/**
 * What moves in the scene on its own: the first-person walk (#446), the
 * walkers and the people model they share, the weather and the camera
 * cones, all on the frame budget.
 */
export function useSceneLife({
  viewStore,
  view,
  walkthroughActive,
  layout,
  activeFloor,
  activeFloorIndex,
  activeFloorY,
  keepOut,
  onFloorChange,
  canvasRef,
  scene,
}: UseSceneLifeOptions): SceneLife {
  const { isReady, invalidate, requestShadowUpdate, addDecorativeStep, threeModuleRef, sceneRef, cameraRef, controlsRef } = scene;
  const { setView, setGameMode } = viewStore.getState().actions;

  // The mode EXPLORE was entered from, so leaving it goes back there (#454).
  // Read from the store, not rendered: a mode switch needn't re-render this.
  const modeBeforeExploreRef = useRef<GameMode>(viewStore.getState().gameMode);
  useEffect(
    () =>
      viewStore.subscribe((state) => {
        modeBeforeExploreRef.current = rememberModeBeforeExplore(modeBeforeExploreRef.current, state.gameMode);
      }),
    [viewStore]
  );
  const exitWalkthrough = useCallback(() => {
    setView((v) => (v.walkthroughMode ? { ...v, walkthroughMode: false } : v));
    setGameMode((mode) => modeAfterExplore(mode, modeBeforeExploreRef.current));
  }, [setView, setGameMode]);

  // What the walker moves through (#446): every storey (stairs join them),
  // the shell and the street outside. Only read while walking.
  const walkRoofStyle = layout.roof?.style;
  const walkRoofColor = layout.roof?.color;
  const walkBuilding = useMemo<WalkthroughBuilding>(
    () => ({
      width: layout.width,
      depth: layout.height,
      floors: layout.floors,
      terrain: layout.terrain,
      entrance: layout.entrance,
      frontage: layout.frontage,
      cutout: layout.cutout,
      ...(layout.neighbours ? { neighbours: layout.neighbours } : {}),
      ...(walkRoofStyle ? { roof: { style: walkRoofStyle, ...(walkRoofColor ? { color: walkRoofColor } : {}) } } : {}),
    }),
    [layout.width, layout.height, layout.floors, layout.terrain, layout.entrance, layout.frontage, layout.cutout, layout.neighbours, walkRoofStyle, walkRoofColor]
  );

  const walk = useWalkthrough({
    enabled: isReady && walkthroughActive,
    invalidate,
    canvasRef,
    threeModuleRef,
    cameraRef,
    orbitRef: controlsRef,
    building: walkBuilding,
    activeFloorIndex,
    onFloorChange,
    onExit: exitWalkthrough,
  });

  // people.glb is fetched only once a person is placed or the walkers are on.
  const layoutHasPeople = useMemo(
    () => layout.floors.some((floor) => floor.items.some((item) => item.type === 'person')),
    [layout.floors]
  );
  const peopleModelReady = usePeopleModel(threeModuleRef, isReady, layoutHasPeople || view.showNpcs);

  useNpcs({
    enabled: isReady && view.showNpcs && !view.view2D,
    invalidate,
    requestShadowUpdate,
    addDecorativeStep,
    threeModuleRef,
    sceneRef,
    roomWidth: layout.width,
    roomDepth: layout.height,
    items: activeFloor.items,
    interiorWalls: activeFloor.interiorWalls,
    keepOut,
    floorY: activeFloorY,
    riggedModelReady: peopleModelReady,
  });

  // Rebuilt with the street, not on every edit: it re-seeds the whole field.
  const streetKey = JSON.stringify([
    layout.width, layout.height, layout.roof?.style, layout.terrain, layout.frontage, layout.neighbours,
    layout.floors.map((floor) => floor.height),
  ]);
  const dryBoxes = useMemo(
    () => streetDryBoxes(streetSiteOf({ ...layout, depth: layout.height })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- streetKey covers what the street reads.
    [streetKey]
  );

  useWeather({
    weather: view.weather,
    enabled: isReady && !view.view2D,
    invalidate,
    addDecorativeStep,
    threeModuleRef,
    sceneRef,
    roomWidth: layout.width,
    roomDepth: layout.height,
    // The eaves keep the ground under them dry too (#660).
    clearance: layout.roof && layout.roof.style !== 'none' ? ROOF_EAVE_OVERHANG : 0,
    dryBoxes,
    terrain: layout.terrain,
  });

  useCameraVision({
    enabled: isReady && view.showCameraVision && !view.view2D,
    addDecorativeStep,
    threeModuleRef,
    sceneRef,
    // Cones don't see through walls (#590).
    building: walkBuilding,
  });

  return { walk, exitWalkthrough, peopleModelReady };
}
