import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROOF_EAVE_OVERHANG } from '../lib/dormers';
import { createNpcHandOff } from '../lib/npc-bodies';
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
import type { KeepOutBuilding } from '../lib/floor-keep-out';
import type { GameMode, RoomLayout, ViewSettings } from '../lib/types';

export interface UseSceneLifeOptions {
  viewStore: EditorViewStore;
  view: Pick<ViewSettings, 'showNpcs' | 'view2D' | 'weather' | 'showCameraVision'>;
  walkthroughActive: boolean;
  layout: RoomLayout;
  activeFloorIndex: number;
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
  activeFloorIndex,
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

  // The player and the walkers, to each other (#585).
  const [npcHandOff] = useState(createNpcHandOff);

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
    npcs: npcHandOff,
  });

  // people.glb is fetched only once a person is placed or the walkers are on.
  const layoutHasPeople = useMemo(
    () => layout.floors.some((floor) => floor.items.some((item) => item.type === 'person')),
    [layout.floors]
  );
  const peopleModelReady = usePeopleModel(threeModuleRef, isReady, layoutHasPeople || view.showNpcs);

  // What the walkers walk around on each storey: its items, partitions and keep-out.
  const npcBuilding = useMemo<KeepOutBuilding>(
    () => ({ width: layout.width, height: layout.height, terrain: layout.terrain, entrance: layout.entrance, floors: layout.floors, cutout: layout.cutout }),
    [layout.width, layout.height, layout.terrain, layout.entrance, layout.floors, layout.cutout]
  );
  // The storeys whose walkers are shown (#580): the active one, and while
  // walking indoors its neighbours near the stairs, as the scene draws
  // them. From outside the other storeys' rooms are barely seen through
  // the windows, and a phone pays for every figure: theirs stay parked.
  const walkSpan = walkthroughActive && !walk.outside && walk.nearStairs ? 1 : 0;
  const npcShownFrom = activeFloorIndex - walkSpan;
  const npcShownTo = activeFloorIndex + walkSpan;

  useNpcs({
    enabled: isReady && view.showNpcs && !view.view2D,
    invalidate,
    requestShadowUpdate,
    addDecorativeStep,
    threeModuleRef,
    sceneRef,
    building: npcBuilding,
    shownFrom: npcShownFrom,
    shownTo: npcShownTo,
    riggedModelReady: peopleModelReady,
    handOff: npcHandOff,
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
    player: npcHandOff.player,
  });

  return { walk, exitWalkthrough, peopleModelReady };
}
