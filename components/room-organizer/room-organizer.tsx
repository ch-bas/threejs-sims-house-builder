'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { EditorViewProvider, useEditorView } from './contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from './contexts/room-editor-context';
import { SelectionProvider } from './contexts/selection-context';
import { catalogHighlightKey, createEditorViewStore, highlightIdsFromKey, viewExceptTime } from './hooks/editor-view-store';
import { markLayoutLoaded, useAchievements } from './hooks/use-achievements';
import { useCameraPad, useCameraPresets } from './hooks/use-camera-presets';
import { useCanvas2DInteraction } from './hooks/use-canvas-2d-interaction';
import { useEdgeVar } from './hooks/use-edge-var';
import { useEvent } from './hooks/use-event';
import { useFloorKeepOut } from './hooks/use-floor-keep-out';
import { useHistory } from './hooks/use-history';
import { useHouseLoading } from './hooks/use-house-loading';
import { useImportExport } from './hooks/use-import-export';
import { useItemCommands } from './hooks/use-item-commands';
import { useItemDrag } from './hooks/use-item-drag';
import { useItemPlacement } from './hooks/use-item-placement';
import { useKeyboardPlacement } from './hooks/use-keyboard-placement';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';
import { useSaveStatus, type SaveStatus, type SaveStatusStore } from './hooks/use-layout-persistence';
import { useLayoutState } from './hooks/use-layout-state';
import { usePhotoMode, usePhotoModeActive } from './hooks/use-photo-mode';
import { usePlacementGhost } from './hooks/use-placement-ghost';
import { useRecentColors } from './hooks/use-recent-colors';
import { useSceneEffects, measurementDistance, type UseSceneEffectsParams } from './hooks/use-scene-effects';
import { useSceneLife } from './hooks/use-scene-life';
import { useSelectionActions } from './hooks/use-selection-actions';
import { useThreeScene } from './hooks/use-three-scene';
import { useWallDraft } from './hooks/use-wall-draft';
import { useWallEdit, type WallMovePreview } from './hooks/use-wall-edit';
import { furnitureSpend } from './lib/budget';
import { findCatalogEntry } from './lib/catalog-drag';
import { collisionMessage } from './lib/collision-reason';
import { FURNITURE_CATALOG } from './lib/constants';
import { ROOF_EAVE_OVERHANG } from './lib/dormers';
import { isInsideBuilding } from './lib/footprint';
import { hasCollisions } from './lib/geometry';
import { createSnapTicker, cueHaptic, haptic, loadHapticsChoice } from './lib/haptics';
import { describeLayoutChange } from './lib/history-label';
import { loadQualityChoice } from './lib/render-quality';
import { focusCoverFor } from './lib/scene-insets';
import { gardenGroundY, groundHeightAt } from './lib/site';
import { playSound, type SoundCue } from './lib/sounds';
import { buildingHeight, floorElevation, interiorWallHeight, storeyHeight } from './lib/storeys';
import { entrancePlanOutline } from './lib/street';
import { sceneWallDisplay } from './lib/walkthrough-view';
import { wallSideAt } from './lib/wall-sides';
import { roomsToName } from './lib/zones';
import { AchievementToast } from './panels/achievement-toast';
import { BottomHud } from './panels/bottom-hud';
import { ConfirmDialogHost } from './panels/confirm-dialog';
import { DevDiagnostics } from './panels/dev-diagnostics';
import { FloorPill } from './panels/floor-pill';
import { HeaderStats, type HeaderStatsProps } from './panels/header-stats';
import { ItemContextPopover } from './panels/item-context-popover';
import { LotBadge } from './panels/lot-badge';
import { PhotoBar } from './panels/photo-bar';
import { PlacementHint } from './panels/placement-hint';
import { SidebarDrawer } from './panels/sidebar-drawer';
import { StatusToastHost } from './panels/status-toast';
import { TouchModeToggle } from './panels/touch-mode-toggle';
import { Viewport } from './panels/viewport';
import { WallDisplayPill } from './panels/wall-display-pill';
import { WelcomeBanner } from './panels/welcome-banner';
import { ZoneNameChip } from './panels/zone-name-chip';
import { clearWallGhosts, renderWallGhosts } from './three/interior-walls';
import { revealSetbacks } from './three/reveals';
import { roofPeakHeight } from './three/roof';
import { classifyOpeningOwners } from './three/wall-openings';
import type { HoverInfo } from './hooks/use-three-scene';
import type { DetectedRoom } from './lib/room-detect';
import type { CatalogItem, FurnitureItem, RoomLayout, ViewSettings } from './lib/types';

/** A stable "none" for the plan's memoised rooms to name. */
const NO_ROOMS: readonly DetectedRoom[] = [];

const INITIAL_VIEW_SETTINGS: ViewSettings = {
  view2D: false,
  showMeasurements: true,
  showWiFiSignals: true,
  snapToGrid: false,
  snapToWall: false,
  snapToItems: false,
  showMinimap: false,
  floorPlan3DEffect: false,
  timeOfDay: 12,
  weather: 'clear',
  walkthroughMode: false,
  showOutdoor: true,
  showAllFloors: false,
  wallDisplay: 'cutaway',
  measurementMode: false,
  soundsEnabled: false,
  hapticsEnabled: true,
  drawWallMode: false,
  drawZoneMode: false,
  showHeatmap: false,
  showFloorBelow: false,
  showItemLabels: false,
  showNpcs: false,
  showCameraVision: true,
};

export function RoomOrganizer(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas2DRef = useRef<HTMLCanvasElement>(null);
  // Top-centre chips sit below the top-right pills however they wrap (#308).
  const topRightRef = useRef<HTMLDivElement>(null);
  useEdgeVar(topRightRef, '--pc-top-pills-bottom', 'bottom');

  const { layout, activeFloor, activeFloorIndex, actions } = useLayoutState();
  const activeFloorY = floorElevation(layout.floors, activeFloorIndex);
  const activeStoreyHeight = storeyHeight(activeFloor);
  const {
    unlocked: unlockedAchievements,
    pending: pendingAchievements,
    dismiss: dismissAchievements,
  } = useAchievements(layout);
  const { recent: recentColors, pushColor } = useRecentColors();
  // View and game state live in a per-editor store (#3). The orchestrator
  // reads every view field but the time of day, so an auto-cycle tick
  // re-renders only what shows the hour, not this whole tree (#148).
  const [viewStore] = useState(() => createEditorViewStore(INITIAL_VIEW_SETTINGS));
  const { setView, toggle } = viewStore.getState().actions;
  const view = useStore(viewStore, useShallow(viewExceptTime));
  const autoCycleLighting = useStore(viewStore, (state) => state.autoCycleLighting);

  // First-person walkthrough only runs in the 3D view; the 2D top-down renderer
  // has no PointerLockControls. This single signal gates walkthrough-aware
  // behaviour: canvas select/drag/hover, single-key shortcuts and the hook.
  const walkthroughActive = view.walkthroughMode && !view.view2D;
  // EXPLORE (the game mode) never edits the house, the 2D plan included: the
  // plan's clicks select only and the edit shortcuts are off (#699).
  const exploring = useStore(viewStore, (state) => state.gameMode === 'live');
  const designing = useStore(viewStore, (state) => state.gameMode === 'build');

  // The one call site per event: the sound, and on a touch device the buzz (#687).
  const playCue = useCallback(
    (cue: SoundCue) => {
      if (view.soundsEnabled) playSound(cue);
      if (view.hapticsEnabled) cueHaptic(cue);
    },
    [view.soundsEnabled, view.hapticsEnabled]
  );
  const {
    selectedItemId,
    setSelectedItemId,
    extraSelectedIds,
    setExtraSelectedIds,
    selectedWall,
    setSelectedWall,
    selectedItem,
    allSelectedIds,
    selectOnly,
    handleSelect,
    handleInteriorWallSelect,
    clearItemSelection,
    deselectAll,
    selectFromKeyboard,
    selectionIsGroup,
    selectionHasGroups,
    groupSelection,
    ungroupSelection,
    saveSelectionAsSet,
    selectionValue,
  } = useSelectionActions({ activeFloor, activeFloorIndex, actions, playCue });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [measurementPoints, setMeasurementPoints] = useState<ReadonlyArray<{ x: number; z: number }>>([]);
  // Set once the history exists, below.
  const commitWallStepRef = useRef<() => void>(() => {});
  const {
    wallDraft,
    wallSnapResult,
    wallDrawStatus,
    handleWallClick,
    handleWallLength,
    setWallLengthOpen,
    handleFloorPointerMove,
    handleFloorPointerLeave,
    roomStamp,
    cancelStamp,
    armStamp,
    stampGhost,
    escapeDraft,
  } = useWallDraft({
    layout,
    activeFloor,
    activeFloorIndex,
    drawWallMode: view.drawWallMode,
    drawZoneMode: view.drawZoneMode,
    measurementMode: view.measurementMode,
    actions,
    playCue,
    setSelectedWall,
    commitStepRef: commitWallStepRef,
  });

  const keepOut = useFloorKeepOut(layout, activeFloorIndex);
  const collidingIds = useMemo(() => {
    const matches = new Set<string>();
    for (const item of activeFloor.items) {
      if (hasCollisions(item, activeFloor.items, layout.width, layout.height, { keepOut, interiorWalls: activeFloor.interiorWalls, storeyHeight: activeStoreyHeight })) {
        matches.add(item.id);
      }
    }
    return matches;
  }, [activeFloor.items, activeFloor.interiorWalls, activeStoreyHeight, layout.width, layout.height, keepOut]);

  const handleEmptyClick = useCallback(
    (x: number, z: number) => {
      if (handleWallClick(x, z)) return;
      if (view.measurementMode) {
        setMeasurementPoints((current) => {
          if (current.length >= 2) return [{ x, z }];
          return [...current, { x, z }];
        });
      }
    },
    [view.measurementMode, handleWallClick]
  );

  // A quality picked on this device (#760). In an effect: the prerender has no storage.
  useEffect(() => {
    const renderQuality = loadQualityChoice();
    if (renderQuality !== 'auto') setView((v) => ({ ...v, renderQuality }));
    // The haptics switch, likewise per device (#687).
    if (!loadHapticsChoice()) setView((v) => ({ ...v, hapticsEnabled: false }));
  }, [setView]);

  // The zone with handles on the plan (#628). The handles are zone mode's.
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  useEffect(() => {
    if (!view.drawZoneMode) setSelectedZoneId(null);
  }, [view.drawZoneMode]);

  // Points are floor-plane coordinates; kept on a floor switch, they'd float
  // on the new floor showing a distance measured on the old one (#224).
  useEffect(() => {
    setMeasurementPoints([]);
  }, [activeFloorIndex, activeFloor.id]);

  // A whole-layout replacement (import, share/local hydration, adopting
  // another tab's save) invalidates every piece of transient selection state,
  // not just the item ids (#224).
  const clearTransientSelection = useCallback(() => {
    selectOnly(null);
    setSelectedWall(null);
    setMeasurementPoints([]);
  }, [selectOnly, setSelectedWall]);

  // The recess's span of the front wall on this storey; openings settle on
  // its piers (#394). Memoised on what the recess is fitted to.
  const { width: lotWidth, height: lotDepth, terrain, entrance, floors, cutout } = layout;
  const frontGap = useMemo(
    () => entrancePlanOutline({ width: lotWidth, height: lotDepth, terrain, entrance, floors, cutout }, activeFloorIndex),
    [lotWidth, lotDepth, terrain, entrance, floors, cutout, activeFloorIndex]
  );

  const {
    sceneBoxRef,
    invalidateBoxRef,
    handleDragStart,
    handleDrag,
    handleDragEnd,
    handleDragCancel,
    isDragActive,
  } = useItemDrag({
    activeFloor,
    activeFloorIndex,
    roomWidth: layout.width,
    roomDepth: layout.height,
    keepOut,
    frontGap,
    cutout: layout.cutout,
    terrain: layout.terrain,
    actions,
    allSelectedIds,
  });

  const history = useHistory(layout, useCallback(
    (snapshot: RoomLayout) => {
      // On the storey the undone change was on (#578).
      actions.restoreLayout(snapshot);
      // An undo or redo restores a house; it earns nothing (#450).
      markLayoutLoaded();
    },
    [actions]
  ), { describe: describeLayoutChange });
  // The stable callbacks, so the wrappers below don't change identity every
  // time canUndo/canRedo flips.
  const { commitNow: commitHistoryNow, clear: clearHistory } = history;

  commitWallStepRef.current = commitHistoryNow;

  const {
    rotateItemHandler,
    rotateItemByHandler,
    canTwistItem,
    toggleCameraBracket,
    refuseOverBudget,
    removeItem,
    removeItemOrSelection,
    duplicateSelected,
    chimePlacement,
    handleLockedDrag,
    refuseZone,
    copySelectionToClipboard,
    pasteFromClipboard,
    nudgeItem,
    toggleLock,
    refuseLockedItem,
    removeInteriorWall,
    toggleExteriorWall,
  } = useItemCommands({
    layout,
    activeFloor,
    activeFloorIndex,
    frontGap,
    actions,
    commitHistoryNow,
    undoHistory: history.undo,
    playCue,
    exploring,
    selection: { allSelectedIds, selectOnly, setSelectedItemId, setExtraSelectedIds, setSelectedWall },
  });

  const { saveStatus, remoteLayout, clearRemoteLayout, adoptRemoteLayout } = useHouseLoading({
    layout,
    actions,
    commitHistoryNow,
    clearHistory,
    undoHistory: history.undo,
    clearTransientSelection,
  });

  const hasSignalItems = useMemo(
    () => activeFloor.items.some((item) => item.isWiFiAccessPoint || item.isCCTV),
    [activeFloor.items]
  );

  // What the header counts: the porch door is free (#600). The soft-budget
  // confirm reads it, so the hard budget's write-off doesn't matter here.
  const buildingCost = useMemo(() => furnitureSpend({ floors: layout.floors }), [layout.floors]);

  // Set once the keyboard placement and the ghost exist, below.
  const placedAfterConfirmRef = useRef<(id: string, catalogItem: CatalogItem) => void>(() => {});

  const { snapPosition: snapPlacement, lastSnapWall, getDragPlaneY, snapCatalogPlacement, placeCatalogItem } = useItemPlacement({
    activeFloor,
    activeFloorY,
    roomWidth: layout.width,
    roomDepth: layout.height,
    buildingCost,
    actions,
    view,
    allSelectedIds,
    frontGap,
    cutout: layout.cutout,
    refusePurchase: refuseOverBudget,
    // A soft-budget buy agreed to in the in-app question lands after the
    // place call returned '' (#649).
    onPlacedAfterConfirm: (id: string, catalogItem: CatalogItem) => placedAfterConfirmRef.current(id, catalogItem),
  });

  // A drag, in either view, buzzes once as the item snaps onto a wall (#687):
  // every move's snap goes through here, and every drag starts through
  // startItemDrag, which forgets the last drag's wall.
  const [snapTicker] = useState(createSnapTicker);
  const snapPosition = useCallback(
    (id: string, x: number, z: number) => {
      const snapped = snapPlacement(id, x, z);
      if (snapTicker.next(lastSnapWall()) && view.hapticsEnabled) haptic('snap');
      return snapped;
    },
    [snapPlacement, lastSnapWall, snapTicker, view.hapticsEnabled]
  );
  const startItemDrag = useCallback(
    (id: string) => {
      snapTicker.reset();
      handleDragStart(id);
    },
    [snapTicker, handleDragStart]
  );

  // Every catalog add (tile click, keyboard, drag-drop) comes through here,
  // so each chimes once (#460). '' = declined or refused: nothing was added.
  const placeDiscrete = useCallback(
    (catalogItem: CatalogItem, position?: { x: number; z: number }, rotation?: number): string => {
      commitHistoryNow();
      return chimePlacement(placeCatalogItem(catalogItem, position, rotation));
    },
    [commitHistoryNow, placeCatalogItem, chimePlacement]
  );

  // Keyboard placement (#168): Enter on a catalog tile places through the
  // wrapped `placeCatalogItem` and keeps the item unlocked until Enter/Escape.
  const {
    placingId,
    placeCatalogItem: placeFromCatalog,
    confirmPlacement,
    cancelPlacement,
    ghost,
    endGhost,
    adoptDeferredPlacement,
  } = useKeyboardPlacement({
    layout,
    selectedItemId,
    actions,
    history,
    selectOnly,
    placeCatalogItem: placeDiscrete,
    // The drawer's backdrop would take the click meant to place it.
    onGhostPickUp: useCallback(() => setSidebarCollapsed(true), []),
  });

  // The soft-budget yes, placed after the place call returned: the same
  // chime and selection as placeDiscrete, the keyboard session if a tile's
  // Enter asked, and no selection while a Shift-held ghost stays in hand.
  placedAfterConfirmRef.current = (id, catalogItem) => {
    const placed = chimePlacement(id);
    if (!placed) return;
    if (ghost) return;
    selectOnly(placed);
    adoptDeferredPlacement(placed, catalogItem);
  };

  // EXPLORE edits nothing, so it shows no handles either.
  const planZoneId = exploring ? null : selectedZoneId;
  // The rooms the zone tool offers to name (#719); none outside it.
  const planRoomsToName = useMemo(
    () => (view.drawZoneMode && !exploring ? roomsToName(layout, activeFloorIndex) : NO_ROOMS),
    [view.drawZoneMode, exploring, layout, activeFloorIndex]
  );

  // Moving a selected wall, in both views (#718). The 3D ghosts are wired below,
  // once the scene exists.
  const interiorSelectedWallId = selectedWall?.kind === 'interior' ? selectedWall.id : null;
  const wallGhostsRef = useRef<((preview: WallMovePreview | null) => void) | null>(null);
  const { grabWall, wallMovePreview, isHoldingWall, cancelWallHold } = useWallEdit({
    enabled: !exploring && !walkthroughActive && !ghost && !view.drawWallMode && !view.drawZoneMode && !view.measurementMode,
    pressDrags: designing,
    layout,
    activeFloor,
    activeFloorIndex,
    selectedWallId: interiorSelectedWallId,
    ghostsRef: wallGhostsRef,
    onMove: (patches) => {
      // One undo step, however quickly the next move follows.
      commitWallStepRef.current();
      actions.updateInteriorWalls(patches);
      playCue('place');
    },
    onRefused: refuseZone,
  });

  // 2D plan select/drag (#219). Reuses use-item-drag's session, so the commit
  // semantics (single dispatch, lock-on-release, wall settling, isDragActive
  // keyboard gate) are identical to a 3D drag.
  const { clientToWorld2D, repaintPlan } = useCanvas2DInteraction({
    enabled: view.view2D,
    exploring,
    canvasRef: canvas2DRef,
    layout,
    activeFloor,
    view,
    selectedItemId,
    extraSelectedIds,
    allSelectedIds,
    onItemSelect: handleSelect,
    onDeselect: deselectAll,
    snapPosition,
    onItemDragStart: startItemDrag,
    onItemDrag: handleDrag,
    onItemDragEnd: handleDragEnd,
    onItemDragCancel: handleDragCancel,
    onLockedDrag: handleLockedDrag,
    onZoneRefused: refuseZone,
    onWallPoint: handleEmptyClick,
    onWallPointerMove: handleFloorPointerMove,
    onWallPointerLeave: handleFloorPointerLeave,
    onWallPress: roomStamp.press,
    onWallPressCancel: roomStamp.cancelPress,
    onInteriorWallSelect: handleInteriorWallSelect,
    selectedWallId: interiorSelectedWallId,
    onWallGrab: grabWall,
    wallMovePreview,
    selectedZoneId: planZoneId,
    onZoneSelect: setSelectedZoneId,
    roomsToName: planRoomsToName,
  });

  const orbitGroundAt = useCallback(
    (z: number) => groundHeightAt(layout.terrain, z, layout.height / 2),
    [layout.terrain, layout.height]
  );
  // L2 photo (#626): the canvas only orbits while the HUD is hidden.
  const photoActive = usePhotoModeActive();
  const { isReady, shadersWarming, error, invalidate, requestShadowUpdate, addDecorativeStep, threeModuleRef, sceneRef, rendererRef, cameraRef, controlsRef, worldPositionFromClient } =
    useThreeScene({
      canvasRef,
      walkthroughActive,
      orbitOnly: photoActive,
      groundAt: orbitGroundAt,
      renderQuality: view.renderQuality,
      // The distance tool measures across furniture, so its clicks go to the floor (#341).
      floorPickOnly: view.drawWallMode || view.measurementMode,
      onItemSelect: handleSelect,
      selectedIds: allSelectedIds,
      onItemDragStart: startItemDrag,
      onItemDrag: handleDrag,
      onItemDragEnd: handleDragEnd,
      onItemDragCancel: handleDragCancel,
      canTwistItem,
      // One gesture, one undo entry and one cue, however it pauses (#689).
      onItemTwistStart: history.holdGesture,
      onItemTwist: (id: string, radians: number, first: boolean) => rotateItemByHandler(id, radians, first),
      onItemTwistEnd: (_id: string, turned: boolean) => history.releaseGesture(turned),
      onItemHover: setHover,
      onEmptyClick: handleEmptyClick,
      onWallSelect: ({ wallId, kind, from }) => {
        // EXPLORE edits nothing, and this opens the paint target.
        if (exploring) return;
        const wall = kind === 'interior' ? activeFloor.interiorWalls?.find((entry) => entry.id === wallId) : undefined;
        setSelectedWall({ id: wallId, kind, ...(wall ? { side: wallSideAt(wall, from) } : {}) });
      },
      onWallGrab: grabWall,
      onFloorGrab: roomStamp.grabFloor,
      // Only track the floor pointer while wall-draw mode consumes it — the
      // handler writes React state per mousemove, re-rendering the whole tree,
      // and the hook skips the floor raycast when the handler is absent.
      ...(view.drawWallMode ? { onFloorPointerMove: handleFloorPointerMove } : {}),
      onFloorPointerLeave: handleFloorPointerLeave,
      snapPosition,
      getDragPlaneY,
    });

  wallGhostsRef.current = (preview) => {
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return;
    if (preview) renderWallGhosts(THREE, scene, preview.moved, activeFloorY, interiorWallHeight(activeFloor), preview.refusal !== null);
    else clearWallGhosts(scene);
    invalidate();
  };

  sceneBoxRef.current = sceneRef;
  invalidateBoxRef.current = invalidate;

  // Placement ghost (#463 d): a clicked catalogue tile follows the pointer
  // until a click or tap places it.
  // Another tool (walls, distance, zones, the walkthrough) owns the clicks:
  // the ghost is put down rather than taking them.
  const placementGhost = usePlacementGhost({
    ghost,
    endGhost,
    enabled: !walkthroughActive && !view.drawWallMode && !view.measurementMode && !view.drawZoneMode,
    sceneReady: isReady,
    view2D: view.view2D,
    canvasRef,
    canvas2DRef,
    worldPositionFromClient,
    clientToWorld2D,
    snapCatalogPlacement,
    floorItems: activeFloor.items,
    collides: (item: FurnitureItem) =>
      hasCollisions(item, activeFloor.items, layout.width, layout.height, {
        keepOut,
        interiorWalls: activeFloor.interiorWalls,
        storeyHeight: activeStoreyHeight,
      }),
    // Where it will stand: a door or window back in its reveal, curtains out in front of one (#758).
    revealSetback: (item: FurnitureItem) => {
      const items = [...activeFloor.items, item];
      const owners = classifyOpeningOwners(items, layout.width, layout.height, activeFloor.interiorWalls ?? [], layout.cutout);
      const context = {
        width: layout.width,
        depth: layout.height,
        cutout: layout.cutout,
        hiddenWalls: activeFloor.hiddenWalls,
        noWalls: activeFloorIndex === 0 && !!layout.floorPlanImage,
      };
      return revealSetbacks(items, owners, context, activeStoreyHeight).get(item.id) ?? 0;
    },
    // placeDiscrete plays the place cue, or `refused` (hard budget, full floor).
    place: (catalogItem, position, rotation, keep) => {
      const id = placeDiscrete(catalogItem, position, rotation);
      // '' = refused, or declined at the soft budget's confirm.
      if (!id) return false;
      selectOnly(keep ? null : id);
      return true;
    },
    threeModuleRef,
    sceneRef,
    invalidate,
    floorY: activeFloorY,
    groundY: (item) => (item.position ? gardenGroundY(item, activeFloorIndex, item.position, layout) : null),
    storeyHeight: activeStoreyHeight,
  });
  // A mode switch (Design, Furnish, Explore) puts the ghost down too.
  const gameMode = useStore(viewStore, (state) => state.gameMode);
  useEffect(() => endGhost(), [gameMode, endGhost]);


  const { walk, exitWalkthrough, peopleModelReady } = useSceneLife({
    viewStore,
    view,
    walkthroughActive,
    layout,
    activeFloorIndex,
    onFloorChange: actions.setActiveFloorIndex,
    canvasRef,
    scene: { isReady, invalidate, requestShadowUpdate, addDecorativeStep, threeModuleRef, sceneRef, cameraRef, controlsRef },
  });

  // Called from a child so that a time-of-day tick or a search keystroke,
  // which the scene effects read, re-renders that child alone (#148).
  const sceneEffectsProps: SceneEffectsProps = {
    isReady,
    peopleModelReady,
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
    selectedItemId,
    extraSelectedIds,
    selectedWall,
    selectedZoneId: planZoneId,
    roomsToName: planRoomsToName,
    wallDraft,
    stampGhost,
    stampArmed: roomStamp.armed,
    wallSnapResult,
    measurementPoints,
    walkIndoors: walkthroughActive && !walk.outside,
    walkNearStairs: walk.nearStairs,
    walkLampStorey: walk.lampStorey,
  };

  // The roof as camera framing sees it: on screen only with the walls up,
  // on the top storey or with every storey shown (as the roof effect shows it;
  // the walkthrough shows every storey, #446).
  const roofStyle = layout.roof?.style ?? 'none';
  const roofShows =
    roofStyle !== 'none' &&
    sceneWallDisplay(view.wallDisplay, walkthroughActive) === 'up' &&
    (view.showAllFloors || walkthroughActive || activeFloorIndex === layout.floors.length - 1);
  // Open to the sky, walls fully up can still hide a focused item (#783).
  const sceneWalls = sceneWallDisplay(view.wallDisplay, walkthroughActive);
  // A traced ground floor builds no shell walls.
  const tracedGround = !!layout.floorPlanImage;
  const roofPeak = roofShows ? roofPeakHeight(roofStyle, layout.width, layout.height) : 0;
  const framedRoof = useMemo(
    () => (roofShows ? { peak: roofPeak, overhang: ROOF_EAVE_OVERHANG } : null),
    [roofShows, roofPeak]
  );
  const { applyPreset, focusOn, fitToRoom } = useCameraPresets({
    cameraRef,
    controlsRef,
    invalidate,
    roomSize: Math.max(layout.width, layout.height),
    roomWidth: layout.width,
    roomDepth: layout.height,
    buildingHeight: buildingHeight(layout.floors),
    roof: framedRoof,
    canvasRef,
    active: isReady && !view.view2D,
    walkthroughActive,
  });

  const { handleScreenshot, handleExportGlb, handleShareLink, handleImport } = useImportExport({
    layout,
    activeFloorName: activeFloor.name,
    actions,
    commitHistoryNow,
    view2D: view.view2D,
    canvasRef,
    canvas2DRef,
    rendererRef,
    sceneRef,
    cameraRef,
    onImported: clearTransientSelection,
  });

  // L2 photo (#626): HUD-less capture of the 3D view.
  const photo = usePhotoMode({
    available: isReady && !view.view2D,
    houseName: layout.name,
    rendererRef,
    sceneRef,
    cameraRef,
    invalidate,
    walking: walkthroughActive,
    onEnter: () => {
      deselectAll();
      setHover(null);
    },
  });

  // Advance the time-of-day at roughly 1 in-game hour per second when on.
  useEffect(() => {
    if (!autoCycleLighting) return undefined;
    const intervalId = window.setInterval(() => {
      setView((v) => ({ ...v, timeOfDay: (v.timeOfDay + 0.25) % 24 }));
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [autoCycleLighting, setView]);

  // Achievement unlocks ping the success chime.
  useEffect(() => {
    if (pendingAchievements.length > 0) playCue('success');
  }, [pendingAchievements, playCue]);

  // Reset measurements whenever the user exits the mode.
  useEffect(() => {
    if (!view.measurementMode) setMeasurementPoints([]);
  }, [view.measurementMode]);

  // `[` / `]` and PgUp / PgDn, and the touch walk HUD's clock and floor buttons (#688).
  const advanceTime = useEvent((deltaHours: number) => {
    setView((v) => ({ ...v, timeOfDay: (((v.timeOfDay + deltaHours) % 24) + 24) % 24 }));
  });
  const changeFloor = useEvent((delta: number) => {
    const next = activeFloorIndex + delta;
    if (next < 0 || next >= layout.floors.length) return;
    actions.setActiveFloorIndex(next);
  });
  const shortcutHandlers = useMemo(
    () => ({
      removeItem: removeItemOrSelection,
      removeRow: removeItem,
      duplicateItem: duplicateSelected,
      copySelection: copySelectionToClipboard,
      pasteClipboard: pasteFromClipboard,
      rotateItem: rotateItemHandler,
      rotateItemBy: rotateItemByHandler,
      moveItem: nudgeItem,
      toggleLock,
      refuseLocked: refuseLockedItem,
      toggle2D: () => toggle('view2D'),
      toggleMeasurements: () => toggle('showMeasurements'),
      toggleSnap: () => toggle('snapToGrid'),
      toggleSignals: () => toggle('showWiFiSignals'),
      undo: history.undo,
      redo: history.redo,
      deselect: () => {
        if (cancelWallHold()) {
          repaintPlan();
          return;
        }
        if (escapeDraft()) return;
        // A second Escape, with no draft pending, leaves wall-draw mode (#349).
        if (view.drawWallMode) {
          toggle('drawWallMode');
          return;
        }
        // Likewise for the distance tool (#341).
        if (view.measurementMode) {
          toggle('measurementMode');
          return;
        }
        // And for zone drawing, whose drawer button is folded away (#439).
        if (view.drawZoneMode) {
          toggle('drawZoneMode');
          return;
        }
        clearItemSelection();
        setSelectedWall(null);
      },
      focusOnSelection: () => {
        if (!selectedItem?.position) return;
        const { x, z } = selectedItem.position;
        const building = { width: layout.width, height: layout.height, cutout: layout.cutout };
        // A flat roof counts: only 'none' leaves the storey open to the sky.
        const covered = roofShows || (view.showAllFloors && activeFloorIndex < layout.floors.length - 1);
        focusOn(selectedItem.position, {
          floorY: isInsideBuilding(building, x, z) || activeFloorIndex > 0 ? activeFloorY : orbitGroundAt(z),
          size: Math.max(selectedItem.width, selectedItem.depth, selectedItem.height),
          cover: focusCoverFor({
            covered,
            wallDisplay: sceneWalls,
            storeyHeight: activeStoreyHeight,
            building,
            walls: activeFloor.interiorWalls ?? [],
            hiddenSides: activeFloor.hiddenWalls ?? [],
            noShell: tracedGround && activeFloorIndex === 0,
          }),
        });
      },
      advanceTime,
      changeFloor,
      toggleSidebar: () => setSidebarCollapsed((c) => !c),
      removeInteriorWall,
      toggleExteriorWall,
      // Only while a keyboard placement is pending, so Enter/Escape otherwise
      // keep their ordinary meaning (#168).
      ...(placingId ? { confirmPlacement, cancelPlacement } : {}),
      // A placement ghost (#463 d) takes them the same way.
      ...(ghost ? { confirmPlacement: () => placementGhost.confirm(), cancelPlacement: placementGhost.cancel } : {}),
    }),
    [
      placingId,
      confirmPlacement,
      cancelPlacement,
      ghost,
      placementGhost,
      removeItemOrSelection,
      removeItem,
      duplicateSelected,
      copySelectionToClipboard,
      pasteFromClipboard,
      rotateItemHandler,
      rotateItemByHandler,
      nudgeItem,
      toggleLock,
      refuseLockedItem,
      removeInteriorWall,
      toggleExteriorWall,
      activeFloor.interiorWalls,
      activeFloor.hiddenWalls,
      activeFloorIndex,
      activeFloorY,
      layout.floors.length,
      layout.width,
      layout.height,
      layout.cutout,
      toggle,
      history.undo,
      history.redo,
      selectedItem,
      focusOn,
      roofShows,
      sceneWalls,
      tracedGround,
      view.showAllFloors,
      activeStoreyHeight,
      orbitGroundAt,
      advanceTime,
      changeFloor,
      escapeDraft,
      cancelWallHold,
      repaintPlan,
      view.drawWallMode,
      view.measurementMode,
      view.drawZoneMode,
      clearItemSelection,
      setSelectedWall,
    ]
  );

  // The wall gesture commits on release, like an item drag: what would change
  // the house under it waits.
  const isAnyHoldActive = useCallback(() => isDragActive() || isHoldingWall(), [isDragActive, isHoldingWall]);
  useKeyboardShortcuts({
    selectedItem,
    selectedWall,
    hasSignalItems,
    walkthroughActive,
    exploring,
    isDragActive: isAnyHoldActive,
    handlers: shortcutHandlers,
  });



  // Stable identities for the memoised drawer and HUD (#3): these handlers
  // close over the layout, so they change on every edit.
  const collapseSidebar = useCallback(() => setSidebarCollapsed(true), []);
  // What Escape does to the popover on the scene, for Escape in the drawer (#632).
  const dismissItemPopover = useEvent(() => (shortcutHandlers.cancelPlacement ?? shortcutHandlers.deselect)());
  const stableApplyPreset = useEvent(applyPreset);
  const stableFitToRoom = useEvent(fitToRoom);
  const stableScreenshot = useEvent(handleScreenshot);
  const stableImport = useEvent(handleImport);
  const stableExportGlb = useEvent(handleExportGlb);
  const stableShareLink = useEvent(handleShareLink);
  const stablePlaceFromCatalog = useEvent(placeFromCatalog);
  const stableRemoveItem = useEvent(removeItem);
  const stableDuplicateItem = useEvent(duplicateSelected);
  const { orbitByPad, zoomByPad } = useCameraPad({ threeModuleRef, cameraRef, controlsRef, invalidate });

  const roomEditorValue = useMemo<RoomEditorContextValue>(
    () => ({
      layout,
      activeFloor,
      activeFloorIndex,
      actions,
      collidingIds,
      recentColors,
      pushColor,
      playCue,
      history,
      isReady,
      error,
    }),
    [
      layout, activeFloor, activeFloorIndex, actions,
      collidingIds,
      recentColors, pushColor, playCue,
      history, isReady, error,
    ]
  );

  return (
    <EditorViewProvider store={viewStore}>
    <SceneEffects {...sceneEffectsProps} />
    <RoomEditorProvider value={roomEditorValue}>
    <SelectionProvider value={selectionValue}>
    <div
      className="pc-world"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
      }}
    >
      <Viewport
        isReady={isReady}
        shadersWarming={shadersWarming}
        error={error}
        view2D={view.view2D}
        layout={layout}
        activeFloor={activeFloor}
        selectedItem={selectedItem}
        selectionCount={allSelectedIds.size}
        onCopySelection={copySelectionToClipboard}
        selectionGrouped={selectionIsGroup}
        // Grouping edits the house: not while exploring (#699).
        onGroupSelection={exploring || selectionIsGroup ? undefined : groupSelection}
        onUngroupSelection={!exploring && selectionHasGroups ? ungroupSelection : undefined}
        onSaveSelectionAsSet={saveSelectionAsSet}
        showMeasurements={view.showMeasurements}
        showMinimap={view.showMinimap}
        walkHud={
          walkthroughActive
            ? {
                locked: walk.locked,
                lockRefused: walk.lockRefused,
                seatName: walk.seatName,
                seated: walk.seated,
                floorName: activeFloor.name,
                multiFloor: layout.floors.length > 1,
                canFloorUp: activeFloorIndex < layout.floors.length - 1,
                canFloorDown: activeFloorIndex > 0,
                onStick: walk.setStick,
                onToggleSit: walk.toggleSit,
                onExit: exitWalkthrough,
                onChangeFloor: changeFloor,
                onAdvanceTime: advanceTime,
              }
            : null
        }
        measurementDistance={measurementDistance(measurementPoints)}
        {...(view.measurementMode ? { measurementPointsPlaced: measurementPoints.length } : {})}
        wallDrawStatus={wallDrawStatus}
        onWallLength={handleWallLength}
        onWallLengthField={setWallLengthOpen}
        canvasRef={canvasRef}
        canvas2DRef={canvas2DRef}
        hover={
          hover &&
          (() => {
            const item = activeFloor.items.find((entry) => entry.id === hover.id);
            return item ? { item, clientX: hover.clientX, clientY: hover.clientY } : null;
          })()
        }
        onCatalogDrop={(clientX, clientY, key) => {
          if (exploring) return;
          const item = findCatalogEntry(FURNITURE_CATALOG, key);
          if (!item) return;
          // The 2D plan inverts the renderer's view transform; 3D raycasts (#166).
          const world = view.view2D
            ? clientToWorld2D(clientX, clientY)
            : worldPositionFromClient(clientX, clientY);
          const newId = placeDiscrete(item, world ?? undefined);
          if (!newId) return;
          selectOnly(newId);
        }}
        // Keyboard selection on the scene (#650): as a click on the item would.
        onKeyboardSelect={selectFromKeyboard}
        placing={placingId !== null || ghost !== null}
      />

      <DevDiagnostics isReady={isReady} rendererRef={rendererRef} sceneRef={sceneRef} />

      <LotBadge
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
      />

      {/* Top-center: live stats */}
      <div
        className="pc-header-stats"
        style={{
          position: 'absolute',
          top: 16,
          // Boxed between the widest title badge + sidebar toggle and the
          // top-right pills, so it wraps instead of sliding under them (#299).
          left: 398,
          right: 303,
          zIndex: 30,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        {/* Covers the 2D plan's top edge on a desktop window (#381). */}
        <div
          className="pc-glass pc-glass--dark"
          data-plan-occluder=""
          style={{ padding: '8px 12px', pointerEvents: 'auto' }}
        >
          <SaveStatusHeaderStats
            saveStatus={saveStatus}
            remoteChange={remoteLayout !== null}
            onAdoptRemote={adoptRemoteLayout}
            onDismissRemote={clearRemoteLayout}
          />
        </div>
      </div>

      {/* Top-right: floor pill + wall display */}
      <div
        ref={topRightRef}
        className="pc-top-right"
        data-scene-occluder=""
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
        }}
      >
        <FloorPill />
        <WallDisplayPill />
      </div>

      {/* Selection popover lives on the right edge */}
      {selectedItem && (
        <ItemContextPopover
          collision={collisionMessage(
            selectedItem,
            activeFloor.items,
            layout.width,
            layout.height,
            { keepOut, interiorWalls: activeFloor.interiorWalls, storeyHeight: activeStoreyHeight }
          )}
          onRotate={rotateItemHandler}
          onToggleCameraBracket={toggleCameraBracket}
          onDuplicate={duplicateSelected}
          onRemove={removeItem}
          onClose={clearItemSelection}
        />
      )}

      <BottomHud
        selectedWall={selectedWall}
        onSelectedWallChange={setSelectedWall}
        onOrbit={orbitByPad}
        onZoom={zoomByPad}
        onFit={stableFitToRoom}
        controlsRef={controlsRef}
        placeCatalogItem={stablePlaceFromCatalog}
        stampArmed={roomStamp.armed}
        onArmStamp={armStamp}
        onCancelStamp={cancelStamp}
      />

      {/* L2 photo (#626): the shutter, the one HUD photo mode keeps. */}
      {photo.active && <PhotoBar onTake={photo.take} onDone={photo.leave} />}

      {/* Touch mode toggle — visible on mobile only */}
      <TouchModeToggle controlsRef={controlsRef} isReady={isReady} onFit={fitToRoom} />

      {/* Welcome modal — auto-shows once, dismissible */}
      <WelcomeBanner />

      {/* Keyboard-placement key hint (#168) */}
      <PlacementHint active={placingId !== null} ghost={ghost} onCancel={placementGhost.cancel} />

      {/* Inline zone naming and export/share status (#374) */}
      <ZoneNameChip />
      <StatusToastHost />
      {/* In-app confirm, instead of window.confirm (#649) */}
      <ConfirmDialogHost />

      {/* Achievement toast */}
      <AchievementToast
        drawerOpen={!sidebarCollapsed}
        pending={pendingAchievements}
        onDismiss={dismissAchievements}
      />

      <SidebarDrawer
        collapsed={sidebarCollapsed}
        onCollapse={collapseSidebar}
        dismissItemPopover={selectedItem ? dismissItemPopover : null}
        unlockedAchievements={unlockedAchievements}
        onApplyPreset={stableApplyPreset}
        onFitToRoom={stableFitToRoom}
        onScreenshot={stableScreenshot}
        onImport={stableImport}
        onExportGlb={stableExportGlb}
        onShareLink={stableShareLink}
        placeCatalogItem={stablePlaceFromCatalog}
        removeItem={stableRemoveItem}
        duplicateItem={stableDuplicateItem}
      />
    </div>
    </SelectionProvider>
    </RoomEditorProvider>
    </EditorViewProvider>
  );
}

// The save status's only subscriber, so a flip re-renders the header, not
// the editor (#3).
function SaveStatusHeaderStats({
  saveStatus,
  ...props
}: { saveStatus: SaveStatusStore } & Omit<HeaderStatsProps, keyof SaveStatus>): JSX.Element {
  return <HeaderStats {...props} {...useSaveStatus(saveStatus)} />;
}

type SceneEffectsProps = Omit<UseSceneEffectsParams, 'view' | 'highlightedIds'>;

// Renders nothing: it owns the scene effects, subscribed to the whole view
// (time of day included) and to the catalog search's highlighted items.
function SceneEffects(props: SceneEffectsProps): null {
  const view = useEditorView((state) => state.view);
  // A string key, so a keystroke that matches the same items keeps the set's
  // identity and leaves the furniture effect alone.
  const highlightKey = useEditorView((state) => catalogHighlightKey(state.catalogQuery, props.activeFloor.items));
  const highlightedIds = useMemo(() => highlightIdsFromKey(highlightKey), [highlightKey]);
  useCameraTargetOnStorey(props, view.walkthroughMode && !view.view2D);
  useSceneEffects({ ...props, view, highlightedIds });
  return null;
}

// Slide the camera target to mid-height of the active storey — on a floor
// switch, and when a storey height below or on it changes (#202). Declared
// ahead of the scene effects, so the lamp pool is assigned around the new
// storey's target, not the old one (#393).
function useCameraTargetOnStorey(
  { layout, activeFloor, activeFloorIndex, cameraRef, controlsRef, invalidate }: SceneEffectsProps,
  walkthroughActive: boolean
): void {
  const cameraTargetY = floorElevation(layout.floors, activeFloorIndex) + storeyHeight(activeFloor) / 2;
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const dy = cameraTargetY - controls.target.y;
    if (Math.abs(dy) < 0.01) return;
    // Keep the orbit target on the new storey even mid-walkthrough, so the
    // orbit camera aims right after an exit — but never touch the camera or
    // run controls.update() while walkthrough owns it: update() has no
    // `enabled` guard, so it re-aims the first-person camera at the orbit
    // target and clamps it back into the polar cone (#114/#216). Walkthrough
    // owns its own eye height.
    controls.target.y = cameraTargetY;
    if (!walkthroughActive) {
      camera.position.y += dy;
      controls.update();
    }
    // Defer painting to the next frame via invalidate(): a synchronous
    // renderer.render here ran BEFORE the scene effects rebuilt the new
    // floor, flashing the old floor's contents from the new camera (#216).
    invalidate();
  }, [cameraTargetY, walkthroughActive, cameraRef, controlsRef, invalidate]);
}

export default RoomOrganizer;
