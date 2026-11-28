'use client';

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { EditorViewProvider, useEditorView } from './contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from './contexts/room-editor-context';
import { SelectionProvider } from './contexts/selection-context';
import { catalogHighlightKey, createEditorViewStore, highlightIdsFromKey, loadLengthUnit, viewExceptTime } from './hooks/editor-view-store';
import { getGroundDrawKind, setGroundDrawKind, useGroundDrawKind } from './hooks/ground-draw';
import { markLayoutLoaded, useAchievements } from './hooks/use-achievements';
import { useBackupReminder } from './hooks/use-backup-reminder';
import { useCameraPad, useCameraPresets, useCameraTargetOnStorey } from './hooks/use-camera-presets';
import { useCanvas2DInteraction } from './hooks/use-canvas-2d-interaction';
import { useEdgeVar } from './hooks/use-edge-var';
import { useEvent } from './hooks/use-event';
import { NOT_WHILE_EXPLORING, NOT_WHILE_TOURING } from './hooks/use-exploring';
import { useFileDrop, useLaunchedFiles } from './hooks/use-file-drop';
import { useFirstStepsAsked } from './hooks/use-first-steps';
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
import { layoutStore } from './hooks/use-layout-store';
import { useMeasureTool } from './hooks/use-measure-tool';
import { usePhotoMode, usePhotoModeActive } from './hooks/use-photo-mode';
import { usePlacementGhost } from './hooks/use-placement-ghost';
import { useRecentColors } from './hooks/use-recent-colors';
import { useSceneEffects, measurementDistance, type UseSceneEffectsParams } from './hooks/use-scene-effects';
import { useSceneLife } from './hooks/use-scene-life';
import { useSelectionActions } from './hooks/use-selection-actions';
import { useServiceWorker } from './hooks/use-service-worker';
import { useAskToKeepStorage } from './hooks/use-storage-persist';
import { useThreeScene } from './hooks/use-three-scene';
import { useTourPhase } from './hooks/use-tour-phase';
import { useWallDraft } from './hooks/use-wall-draft';
import { useWallEdit, type WallMovePreview } from './hooks/use-wall-edit';
import { offerWhatsNew, useWhatsNewState, whatsNewMounts } from './hooks/use-whats-new';
import {
  announce,
  announceSettled,
  cancelSettledAnnouncement,
  describeGroupTurn,
  describeHistoryStep,
  describeLock,
  describePlacement,
  withdrawAnnouncement,
} from './lib/announce';
import { APP_VERSION, offersWhatsNew, settleSeenVersion, versionSeenBefore } from './lib/app-version';
import { budgetOf, furnitureSpend } from './lib/budget';
import { catalogItemFromDrag } from './lib/catalog-variants';
import { collisionMessage } from './lib/collision-reason';
import { FURNITURE_CATALOG } from './lib/constants';
import { swingClearanceNote } from './lib/door-clearance';
import { notifyRefused } from './lib/editor-notices';
import { planIsDrawing } from './lib/floor-plan-fit';
import { isInsideBuilding } from './lib/footprint';
import { hasCollisions } from './lib/geometry';
import { createSnapTicker, cueHaptic, haptic, loadHapticsChoice } from './lib/haptics';
import { describeLayoutChange } from './lib/history-label';
import { fitRun, frontPathGate, runLot, runsRoundLot } from './lib/item-run';
import { dimensionLength } from './lib/plan-dimensions';
import { formatDimension } from './lib/plan-export/plan-geometry';
import { loadQualityChoice } from './lib/render-quality';
import { ROOF_EAVE_OVERHANG, roofPeakHeight } from './lib/roof-shape';
import { activeStoreyRoomScores } from './lib/room-score';
import { focusCoverFor } from './lib/scene-insets';
import { toggleShortcutsOverlay } from './lib/shortcut-overlay';
import { gardenGroundY, groundHeightAt } from './lib/site';
import { playSound, type SoundCue } from './lib/sounds';
import { buildingHeight, floorElevation, interiorWallHeight, storeyHeight } from './lib/storeys';
import { entrancePlanOutline } from './lib/street';
import { isTourSession } from './lib/tour-session';
import { createWalkerCards } from './lib/walker-card';
import { sceneWallDisplay } from './lib/walkthrough-view';
import { wallSideAt } from './lib/wall-sides';
import { roomsToName } from './lib/zones';
import { AchievementToast } from './panels/achievement-toast';
import { Announcer } from './panels/announcer';
import { BottomHud } from './panels/bottom-hud';
import { CameraPad } from './panels/camera-pad';
import { ChallengeChip } from './panels/challenge-chip';
import { ConfirmDialogHost } from './panels/confirm-dialog';
import { DevDiagnostics } from './panels/dev-diagnostics';
import { FileDropOverlay } from './panels/file-drop-overlay';
import { FirstStepsCard } from './panels/first-steps-card';
import { FloorPill } from './panels/floor-pill';
import { GroundDrawChip } from './panels/ground-draw-chip';
import { HeaderStats, type HeaderStatsProps } from './panels/header-stats';
import { ItemContextPopover } from './panels/item-context-popover';
import { LotBadge } from './panels/lot-badge';
import { PlacementHint } from './panels/placement-hint';
import { PlanCalibrationChip } from './panels/plan-calibration-chip';
import { ShortcutsOverlayHost } from './panels/shortcuts-overlay';
import { SidebarDrawer } from './panels/sidebar-drawer';
import { StatusToastHost } from './panels/status-toast';
import { TouchModeToggle } from './panels/touch-mode-toggle';
import { TourBanner } from './panels/tour-banner';
import { Viewport } from './panels/viewport';
import { WallDisplayPill } from './panels/wall-display-pill';
import { WelcomeBanner, isReturningVisit } from './panels/welcome-banner';
import { WhatsNewCard } from './panels/whats-new-card';
import { ZoneNameChip } from './panels/zone-name-chip';
import { clearWallGhosts, renderWallGhosts } from './three/interior-walls';
import { revealSetbacks } from './three/reveals';
import { classifyOpeningOwners } from './three/wall-openings';
import type { HoverInfo } from './hooks/use-three-scene';
import type { DetectedRoom } from './lib/room-detect';
import type { CatalogItem, FurnitureItem, RoomLayout, ViewSettings } from './lib/types';

// G4 album (#912): the shutter and its album load as photo mode opens.
const PhotoBar = lazy(() => import('./panels/photo-bar').then((module) => ({ default: module.PhotoBar })));
// #906: loaded on the first tap on a walker.
const WalkerCard = lazy(() => import('./panels/walker-card').then((module) => ({ default: module.WalkerCard })));

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
  ambienceEnabled: false,
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
  const { recent: recentColors, pushColor } = useRecentColors();
  // View and game state live in a per-editor store (#3). The orchestrator
  // reads every view field but the time of day, so an auto-cycle tick
  // re-renders only what shows the hour, not this whole tree (#148).
  const [viewStore] = useState(() => {
    const store = createEditorViewStore(INITIAL_VIEW_SETTINGS, { lengthUnit: loadLengthUnit() });
    // A shared link opens as a tour (#722), in EXPLORE from the first render:
    // nothing edits the house, and leaving the walk stays in EXPLORE.
    if (isTourSession()) store.getState().actions.setGameMode('live');
    return store;
  });
  const { setView, toggle } = viewStore.getState().actions;
  const view = useStore(viewStore, useShallow(viewExceptTime));
  // The garden-surface tool (#924) owns the plan's presses while it is on.
  const groundDrawing = useGroundDrawKind() !== null;
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
  // The room goals score the active storey with these collisions (#903).
  const knownCollisions = useMemo(() => ({ floorIndex: activeFloorIndex, ids: collidingIds }), [activeFloorIndex, collidingIds]);
  const {
    unlocked: unlockedAchievements,
    pending: pendingAchievements,
    dismiss: dismissAchievements,
  } = useAchievements(layout, knownCollisions);
  // Ask the browser to keep the houses after the first real edit (#928).
  useAskToKeepStorage(layout);

  // The distance tool, on the 3D floor and on the plan (#921).
  // Undo for an unpin's notice; set once the history exists, below.
  const undoRef = useRef<() => void>(() => {});
  const undoLatest = useCallback(() => undoRef.current(), []);
  const measure = useMeasureTool({ layout, activeFloor, activeFloorIndex, measurementMode: view.measurementMode, actions, undo: undoLatest, planShown: view.view2D, playCue });
  const measurementPoints = measure.points;
  const { placeFloorPoint, clear: clearMeasurement, selectedPinId: measuredPinId, selectPin: selectMeasuredPin } = measure;
  // The pin picked on the plan, as the chip shows it (#921).
  const pickedPin = measure.selectedPinId === null ? null : activeFloor.dimensions?.find((entry) => entry.id === measure.selectedPinId);
  const lengthUnit = useStore(viewStore, (state) => state.lengthUnit);
  const measurePick = pickedPin
    ? { label: formatDimension(dimensionLength(pickedPin), lengthUnit), ...(exploring ? {} : { onUnpin: measure.unpin }) }
    : null;
  const handleEmptyClick = useCallback(
    (x: number, z: number) => {
      if (handleWallClick(x, z)) return;
      if (view.measurementMode) placeFloorPoint(x, z);
    },
    [view.measurementMode, handleWallClick, placeFloorPoint]
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

  // A whole-layout replacement (import, share/local hydration, adopting
  // another tab's save) invalidates every piece of transient selection state,
  // not just the item ids (#224).
  const clearTransientSelection = useCallback(() => {
    selectOnly(null);
    setSelectedWall(null);
    clearMeasurement();
  }, [selectOnly, setSelectedWall, clearMeasurement]);

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
  ), {
    describe: describeLayoutChange,
    // Screen readers hear what the step took back or brought back (#929).
    // Always: two undos in a row took back two steps, even with one label.
    onStep: (kind, label) => announce(describeHistoryStep(kind, label), { tag: 'history', always: true }),
  });
  // The stable callbacks, so the wrappers below don't change identity every
  // time canUndo/canRedo flips.
  const { commitNow: commitHistoryNow, clear: clearHistory } = history;

  commitWallStepRef.current = commitHistoryNow;
  undoRef.current = history.undo;

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

  const { saveStatus, remoteLayout, clearRemoteLayout, adoptRemoteLayout, tourHouse, keepTourCopy, leaveTour } = useHouseLoading({
    layout,
    actions,
    commitHistoryNow,
    clearHistory,
    clearTransientSelection,
  });

  // The shared-link tour (#722): EXPLORE for as long as it lasts, then
  // DESIGN, whichever way it ends.
  const tourPhase = useTourPhase();
  // #931: What's new for a returning player after an update. Not during a
  // tour, which writes nothing to the visitor's storage (#722). The seen
  // version is stamped now only when there is nothing to tell; otherwise
  // once the card has shown or closed (use-whats-new).
  useEffect(() => {
    if (tourPhase === 'touring') return;
    const seen = versionSeenBefore();
    if (tourPhase === 'none' && offersWhatsNew(seen, APP_VERSION, isReturningVisit())) offerWhatsNew(seen);
    else settleSeenVersion();
  }, [tourPhase]);
  const whatsNew = useWhatsNewState();
  const firstStepsAsked = useFirstStepsAsked();
  const touring = tourPhase === 'touring';
  const wasTouringRef = useRef(touring);
  useEffect(() => {
    const { setGameMode } = viewStore.getState().actions;
    if (touring) {
      wasTouringRef.current = true;
      return viewStore.subscribe((state) => {
        if (state.gameMode !== 'live') setGameMode('live');
      });
    }
    if (!wasTouringRef.current) return undefined;
    wasTouringRef.current = false;
    setView((v) => (v.walkthroughMode ? { ...v, walkthroughMode: false } : v));
    setGameMode('build');
    return undefined;
  }, [touring, viewStore, setView]);

  const hasSignalItems = useMemo(
    () => activeFloor.items.some((item) => item.isWiFiAccessPoint || item.isCCTV),
    [activeFloor.items]
  );

  // What the header counts: the porch door is free (#600). The soft-budget
  // confirm reads it, so the hard budget's write-off doesn't matter here.
  const buildingCost = useMemo(() => furnitureSpend({ floors: layout.floors }), [layout.floors]);

  // Set once the keyboard placement and the ghost exist, below.
  const placedAfterConfirmRef = useRef<(id: string, catalogItem: CatalogItem) => void>(() => {});
  const runPlacedAfterConfirmRef = useRef<(ids: string[]) => void>(() => {});

  const { snapPosition: snapPlacement, lastSnapWall, getDragPlaneY, snapCatalogPlacement, placeCatalogItem, placeRun } = useItemPlacement({
    activeFloor,
    activeFloorY,
    roomWidth: layout.width,
    roomDepth: layout.height,
    buildingCost,
    budget: budgetOf(layout),
    actions,
    view,
    allSelectedIds,
    frontGap,
    cutout: layout.cutout,
    refusePurchase: refuseOverBudget,
    // A soft-budget buy agreed to in the in-app question lands after the
    // place call returned '' (#649).
    onPlacedAfterConfirm: (id: string, catalogItem: CatalogItem) => placedAfterConfirmRef.current(id, catalogItem),
    onRunPlacedAfterConfirm: (ids: string[]) => runPlacedAfterConfirmRef.current(ids),
  });

  // A drag, in either view, buzzes once as the item snaps onto a wall (#687):
  // every move's snap goes through here, and every drag starts through
  // startItemDrag, which forgets the last drag's wall.
  const [snapTicker] = useState(createSnapTicker);
  // The walker card (#906): a tap on a walker opens it, the walkers fill it in.
  const [walkerCards] = useState(createWalkerCards);
  const walkerCardOpen = useSyncExternalStore(walkerCards.subscribe, () => walkerCards.selected() !== null, () => false);
  const snapPosition = useCallback(
    (id: string, x: number, z: number) => {
      const snapped = snapPlacement(id, x, z);
      if (snapTicker.next(lastSnapWall()) && view.hapticsEnabled) haptic('snap');
      return snapped;
    },
    [snapPlacement, lastSnapWall, snapTicker, view.hapticsEnabled]
  );
  // A drag that slipped past the views' own gates still edits nothing in
  // EXPLORE (#722): no session opens, and without one a move would dispatch
  // directly, so moves are dropped too.
  const exploringRef = useRef(exploring);
  exploringRef.current = exploring;
  const startItemDrag = useCallback(
    (id: string) => {
      if (exploringRef.current) return;
      snapTicker.reset();
      handleDragStart(id);
    },
    [snapTicker, handleDragStart]
  );
  const guardedDrag = useCallback(
    (id: string, x: number, z: number) => {
      if (exploringRef.current) return;
      handleDrag(id, x, z);
    },
    [handleDrag]
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
  // A run of fence, hedge or stones (#915): one undo step, one cue.
  const placeRunDiscrete = useCallback(
    (items: FurnitureItem[]): string => {
      commitHistoryNow();
      return chimePlacement(placeRun(items));
    },
    [commitHistoryNow, placeRun, chimePlacement]
  );
  // A laid run is selected whole, so Demolish takes it back in one go.
  const selectRun = useCallback(
    (ids: readonly string[]) => {
      setSelectedItemId(ids[0] ?? null);
      setExtraSelectedIds(new Set(ids.slice(1)));
    },
    [setSelectedItemId, setExtraSelectedIds]
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
    // Picking an item up ends the garden-surface tool (#924), as starting the
    // tool puts the ghost down.
    onGhostPickUp: useCallback(() => {
      setGroundDrawKind(null);
      setSidebarCollapsed(true);
    }, []),
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
  // The same for a run (#915): chimed once, the whole run selected.
  runPlacedAfterConfirmRef.current = (ids) => {
    const placed = chimePlacement(ids[0] ?? '');
    if (!placed || ghost) return;
    selectRun(ids);
  };

  // EXPLORE edits nothing, so it shows no handles either.
  const planZoneId = exploring ? null : selectedZoneId;
  // The rooms the zone tool offers to name (#719); none outside it.
  const planRoomsToName = useMemo(
    () => (view.drawZoneMode && !exploring ? roomsToName(layout, activeFloorIndex) : NO_ROOMS),
    [view.drawZoneMode, exploring, layout, activeFloorIndex]
  );

  // The active storey's room types and stars, written on the plan under each
  // zone's name (#905). Only while the plan shows; the collisions are the editor's.
  const planRoomScores = useMemo(
    () => (view.view2D ? activeStoreyRoomScores(layout, { floorIndex: activeFloorIndex, ids: collidingIds }) : undefined),
    [view.view2D, layout, activeFloorIndex, collidingIds]
  );

  // Moving a selected wall, in both views (#718). The 3D ghosts are wired below,
  // once the scene exists.
  const interiorSelectedWallId = selectedWall?.kind === 'interior' ? selectedWall.id : null;
  const wallGhostsRef = useRef<((preview: WallMovePreview | null) => void) | null>(null);
  const { grabWall, wallMovePreview, isHoldingWall, cancelWallHold } = useWallEdit({
    enabled: !exploring && !walkthroughActive && !ghost && !groundDrawing && !view.drawWallMode && !view.drawZoneMode && !view.measurementMode,
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
    onItemDrag: guardedDrag,
    onItemDragEnd: handleDragEnd,
    onItemDragCancel: handleDragCancel,
    onLockedDrag: handleLockedDrag,
    onZoneRefused: refuseZone,
    onGroundAdded: chimePlacement,
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
    roomScores: planRoomScores,
    onMeasurePoint: measure.placePoint,
    onMeasureTapUndo: measure.takeBackPoint,
    onMeasureHover: measure.setTip,
    onPinSelect: measure.selectPin,
    measureInProgress: measurementPoints.length === 1,
  });

  const orbitGroundAt = useCallback(
    (z: number) => groundHeightAt(layout.terrain, z, layout.height / 2),
    [layout.terrain, layout.height]
  );
  // L2 photo (#626): the canvas only orbits while the HUD is hidden.
  const photoActive = usePhotoModeActive();
  // #928: suggest a backup now and then; not in EXPLORE, photo mode or over the drawer.
  useBackupReminder(layout, exploring || photoActive || !sidebarCollapsed);
  const { isReady, shadersWarming, error, invalidate, requestShadowUpdate, addDecorativeStep, addFrameJob, threeModuleRef, sceneRef, rendererRef, cameraRef, controlsRef, worldPositionFromClient } =
    useThreeScene({
      canvasRef,
      walkthroughActive,
      orbitOnly: photoActive,
      // EXPLORE never edits the house: an item press selects only (#722).
      selectOnly: exploring,
      groundAt: orbitGroundAt,
      renderQuality: view.renderQuality,
      // The distance tool measures across furniture, so its clicks go to the floor (#341).
      floorPickOnly: view.drawWallMode || view.measurementMode,
      onItemSelect: handleSelect,
      selectedIds: allSelectedIds,
      onItemDragStart: startItemDrag,
      onItemDrag: guardedDrag,
      onItemDragEnd: handleDragEnd,
      onItemDragCancel: handleDragCancel,
      canTwistItem,
      // One gesture, one undo entry and one cue, however it pauses (#689).
      onItemTwistStart: history.holdGesture,
      onItemTwist: (id: string, radians: number, first: boolean) => rotateItemByHandler(id, radians, first),
      onItemTwistEnd: (_id: string, turned: boolean) => history.releaseGesture(turned),
      onItemHover: setHover,
      onEmptyClick: handleEmptyClick,
      // A tap on a walker opens its card; on empty floor (null) closes it (#906).
      onWalkerTap: (walkerId: number | null, at: { x: number; y: number }) => (walkerId === null ? walkerCards.close() : walkerCards.select(walkerId, at)),
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
  // Offline (#933): the service worker registers after the first frame.
  useServiceWorker(isReady && !shadersWarming);

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
    enabled: !walkthroughActive && !groundDrawing && !view.drawWallMode && !view.measurementMode && !view.drawZoneMode,
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
        noWalls: activeFloorIndex === 0 && planIsDrawing(layout),
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
    run: {
      lot: runLot(layout),
      gate: frontPathGate(layout),
      fit: (sections) =>
        fitRun(sections, { items: activeFloor.items, roomWidth: layout.width, roomDepth: layout.height, keepOut }),
      place: (_catalogItem, items, keep) => {
        const id = placeRunDiscrete(items);
        if (!id) return false;
        if (keep) selectOnly(null);
        else selectRun(items.map((item) => item.id));
        return true;
      },
      refuse: (blocker, roundLot) =>
        notifyRefused(
          roundLot && blocker.type === ghost?.type
            ? `A ${blocker.name} already stands on the lot's edge. Remove it to run a new one round the lot.`
            : roundLot
            ? `The ${blocker.name} stands on the lot's edge, where the run round the lot would go. Move or remove it first.`
            : `The run would stand in the ${blocker.name}. Draw it clear of it.`,
          playCue
        ),
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
    walkerCards,
  });

  const tourTogglePlan = useEvent(() => toggle('view2D'));
  // A refused Keep a copy plays the refused cue (#722).
  const keepTourCopyWithCue = useEvent(() => keepTourCopy(playCue));

  // The tour's Walk through (#722), as EXPLORE starts it from the mode panel.
  // The walk's HUD exits it.
  const tourWalk = useEvent(() => {
    selectOnly(null);
    setSelectedWall(null);
    setView((v) => ({ ...v, view2D: false, walkthroughMode: true }));
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
    roomScores: planRoomScores,
    wallDraft,
    stampGhost,
    stampArmed: roomStamp.armed,
    wallSnapResult,
    measurementPoints,
    measureTip: view.view2D ? measure.tip : null,
    selectedDimensionId: measure.selectedPinId,
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
  // A traced ground floor builds no shell walls; an underlay keeps them (#920).
  const tracedGround = planIsDrawing(layout);
  const roofPeak = roofShows && layout.roof ? roofPeakHeight(layout.roof, layout.width, layout.height) : 0;
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
    addFrameJob,
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
    // G4 album (#912): photos are kept per house, with the scene's hour and weather.
    houseId: layout.id,
    readConditions: () => {
      const { timeOfDay, weather } = viewStore.getState().view;
      return { hour: timeOfDay, weather };
    },
    rendererRef,
    sceneRef,
    cameraRef,
    invalidate,
    walking: walkthroughActive,
    onEnter: () => {
      deselectAll();
      setHover(null);
    },
    // W4 shot presets (#912): an hour, a weather and a camera preset, all view settings.
    shot: {
      read: () => {
        const { view: { timeOfDay, weather }, autoCycleLighting: autoCycle } = viewStore.getState();
        return { hour: timeOfDay, weather, autoCycle };
      },
      write: ({ hour, weather, autoCycle }) => {
        const { setView: setViewSettings, setAutoCycleLighting } = viewStore.getState().actions;
        setAutoCycleLighting(autoCycle);
        setViewSettings((v) => ({ ...v, timeOfDay: hour, weather }));
      },
      frame: (camera) => applyPreset(camera),
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

  // `[` / `]` and PgUp / PgDn, and the touch walk HUD's clock and floor buttons (#688).
  const advanceTime = useEvent((deltaHours: number) => {
    setView((v) => ({ ...v, timeOfDay: (((v.timeOfDay + deltaHours) % 24) + 24) % 24 }));
  });
  const changeFloor = useEvent((delta: number) => {
    const next = activeFloorIndex + delta;
    if (next < 0 || next >= layout.floors.length) return;
    actions.setActiveFloorIndex(next);
  });
  // Keyboard edits say what they did in the status line (#929); a pointer
  // drag stays silent. Read when the keys settle, from the house as it is.
  const announcePlacement = useEvent((id: string) => {
    announceSettled(() => {
      const { layout: house, activeFloorIndex: index } = layoutStore.getState();
      const floor = house.floors[index];
      const item = floor?.items.find((entry) => entry.id === id);
      if (!floor || !item) return '';
      const collision = collisionMessage(item, floor.items, house.width, house.height, {
        keepOut,
        interiorWalls: floor.interiorWalls,
        storeyHeight: storeyHeight(floor),
      });
      const where = { width: house.width, height: house.height, cutout: house.cutout, porch: entrancePlanOutline(house, index), floorIndex: index };
      return describePlacement(item, where, collision);
    }, { tag: 'placement' });
  });
  // A turn of a multi-selection says how many turned (and how many locked
  // ones stayed), as Lock does; a held R adds its steps up.
  const groupTurnRef = useRef(0);
  const announceGroupTurn = useEvent((ids: ReadonlySet<string>, radians: number) => {
    groupTurnRef.current += radians;
    announceSettled(() => {
      const degrees = (groupTurnRef.current * 180) / Math.PI;
      groupTurnRef.current = 0;
      const { layout: house, activeFloorIndex: index } = layoutStore.getState();
      const members = (house.floors[index]?.items ?? []).filter((entry) => ids.has(entry.id));
      const locked = members.filter((entry) => entry.locked).length;
      return describeGroupTurn(members.length - locked, degrees, locked);
    }, { tag: 'placement' });
  });
  // What a placement or lock line describes goes with the selection: a line
  // still waiting, or still in the region, would talk about what isn't.
  const announcedSelection = selectedItem?.id ?? null;
  useEffect(() => {
    cancelSettledAnnouncement();
    groupTurnRef.current = 0;
    withdrawAnnouncement((tag) => tag === 'placement' || tag === 'lock');
  }, [announcedSelection]);
  const announcedKeys = useMemo(
    () => ({
      moveItem: (id: string, x: number, z: number) => {
        nudgeItem(id, x, z);
        announcePlacement(id);
      },
      rotateItem: (id: string) => {
        const group = allSelectedIds.size > 1 && allSelectedIds.has(id) ? new Set(allSelectedIds) : null;
        if (!rotateItemHandler(id)) return;
        if (group) announceGroupTurn(group, Math.PI / 2);
        else announcePlacement(id);
      },
      rotateItemBy: (id: string, radians: number) => {
        const group = allSelectedIds.size > 1 && allSelectedIds.has(id) ? new Set(allSelectedIds) : null;
        const before = layoutStore.getState();
        rotateItemByHandler(id, radians);
        // A refusal (a lock) changes nothing and has its own notice.
        if (layoutStore.getState().layout === before.layout) return;
        if (group) announceGroupTurn(group, radians);
        else announcePlacement(id);
      },
      toggleLock: (id: string) => {
        const before = layoutStore.getState().layout;
        toggleLock(id);
        const { layout: house, activeFloorIndex: index } = layoutStore.getState();
        if (house === before) return;
        const items = house.floors[index]?.items ?? [];
        const item = items.find((entry) => entry.id === id);
        if (!item) return;
        const count = allSelectedIds.size > 1 && allSelectedIds.has(id) ? allSelectedIds.size : 1;
        announce(describeLock(item.name, count, item.locked === true), { tag: 'lock' });
      },
    }),
    [nudgeItem, rotateItemHandler, rotateItemByHandler, toggleLock, allSelectedIds, announcePlacement, announceGroupTurn]
  );
  const shortcutHandlers = useMemo(
    () => ({
      removeItem: removeItemOrSelection,
      removeRow: removeItem,
      duplicateItem: duplicateSelected,
      copySelection: copySelectionToClipboard,
      pasteClipboard: pasteFromClipboard,
      ...announcedKeys,
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
        // Likewise for the distance tool (#341), once a picked pin is let go (#921).
        if (view.measurementMode && measuredPinId !== null) {
          selectMeasuredPin(null);
          return;
        }
        if (view.measurementMode) {
          toggle('measurementMode');
          return;
        }
        // And for the garden-surface tool (#924), likewise folded away.
        if (getGroundDrawKind()) {
          setGroundDrawKind(null);
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
      // #932: the `?` overlay
      toggleShortcuts: toggleShortcutsOverlay,
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
      announcedKeys,
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
      measuredPinId,
      selectMeasuredPin,
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
  // A house file dropped anywhere on the page opens like Import (#934)...
  const fileDropLock = touring
    ? NOT_WHILE_TOURING
    : exploring
      ? NOT_WHILE_EXPLORING
      : photoActive
        ? 'Leave photo mode first, then try the file again.'
        : null;
  const fileOpening = { lockedReason: fileDropLock, openHouse: stableImport, refuse: (message: string) => notifyRefused(message, playCue) };
  const { dragging: fileDragging, blockedReason: fileDropBlocked } = useFileDrop(fileOpening);
  // ...and so does a .json file the installed app is opened with.
  useLaunchedFiles(fileOpening);
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
      <Announcer />
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
                lamp: walk.lamp,
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
        // Pinning edits the house: not while exploring; and only on the plan, where pins show (#921).
        {...(view.measurementMode && !exploring && view.view2D ? { onPinMeasurement: measure.pin } : {})}
        measurePin={measurePick}
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
          const item = catalogItemFromDrag(FURNITURE_CATALOG, key);
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

      {/* A tour shows the name, the floors and the camera, and nothing that edits (#722). */}
      {touring ? (
        !error && (
          <TourBanner
            name={tourHouse?.name ?? null}
            walking={walkthroughActive}
            plan={view.view2D}
            onTogglePlan={tourTogglePlan}
            onWalk={tourWalk}
            onKeepCopy={keepTourCopyWithCue}
            onBuildOwn={leaveTour}
          />
        )
      ) : (
        <LotBadge
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        />
      )}

      {/* Top-center: live stats */}
      {!touring && (
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
            onShare={stableShareLink}
          />
        </div>
      </div>
      )}

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
          swingNote={swingClearanceNote(selectedItem, activeFloor.items)}
          onRotate={rotateItemHandler}
          onToggleCameraBracket={toggleCameraBracket}
          onDuplicate={duplicateSelected}
          onRemove={removeItem}
          onClose={clearItemSelection}
          onBack={dismissItemPopover}
        />
      )}

      {touring ? (
        isReady && !error && !view.view2D && !walkthroughActive && (
          <div className="pointer-events-none" style={{ position: 'absolute', left: 16, bottom: 16, zIndex: 25 }}>
            <CameraPad onOrbit={orbitByPad} onZoom={zoomByPad} onFit={stableFitToRoom} controlsRef={controlsRef} />
          </div>
        )
      ) : (
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
      )}

      {/* L2 photo (#626): the shutter, the one HUD photo mode keeps. */}
      {photo.active && (
        <Suspense fallback={null}>
          <PhotoBar
            onTake={photo.take}
            onKeep={photo.keep}
            houseId={layout.id}
            houseName={layout.name}
            onDone={photo.leave}
            {...(photo.shoot ? { onShoot: photo.shoot } : {})}
            walking={walkthroughActive}
          />
        </Suspense>
      )}

      {/* The walker card (#906), beside the walker tapped */}
      {walkerCardOpen && (
        <Suspense fallback={null}>
          <WalkerCard cards={walkerCards} />
        </Suspense>
      )}

      {/* Touch mode toggle — visible on mobile only */}
      <TouchModeToggle controlsRef={controlsRef} isReady={isReady} onFit={fitToRoom} />

      {/* Welcome modal — auto-shows once, dismissible. Not over a shared
          house, nor over one just kept from it (#722). */}
      {tourPhase === 'none' && <WelcomeBanner />}
      {/* Getting started (#721): offered once the start chooser is answered;
          never over a shared house or one just kept from it (#722), unless
          Help asked for it (#931). */}
      {(tourPhase === 'none' || (tourPhase === 'kept' && firstStepsAsked)) && (
        <FirstStepsCard
          placeCatalogItem={stablePlaceFromCatalog}
          onShareLink={stableShareLink}
          onSelectedWallChange={setSelectedWall}
        />
      )}

      {/* What's new (#931): after an update or from Help; never in a tour,
          EXPLORE or photo mode (it waits them out). Its lines load on demand. */}
      {whatsNewMounts({ state: whatsNew, tourPhase, ready: isReady && !error, exploring, photo: photoActive }) && (
        <WhatsNewCard />
      )}

      {/* Keyboard-placement key hint (#168) */}
      <PlacementHint
        active={placingId !== null}
        ghost={ghost}
        onCancel={placementGhost.cancel}
        // #915: runs are laid on the ground floor only (use-item-placement).
        {...(ghost && runsRoundLot(ghost.type) && activeFloorY === 0 ? { onRunRoundLot: placementGhost.runRoundLot } : {})}
      />

      {/* Inline zone naming and export/share status (#374) */}
      <ZoneNameChip selectedZoneId={planZoneId} onZoneSelect={setSelectedZoneId} />
      {/* The garden-surface tool's chip (#924) */}
      <GroundDrawChip />
      {/* The challenge checklist (#909): none in a shared-link tour; a kept copy is the player's own */}
      {!touring && <ChallengeChip />}
      <PlanCalibrationChip />
      <StatusToastHost />
      {/* In-app confirm, instead of window.confirm (#649) */}
      <ConfirmDialogHost />
      {/* #932: the `?` shortcut overlay, under a confirm */}
      <ShortcutsOverlayHost />
      {fileDragging && <FileDropOverlay lockedReason={fileDropBlocked} />}

      {/* Achievement toast */}
      <AchievementToast
        drawerOpen={!sidebarCollapsed}
        pending={pendingAchievements}
        onDismiss={dismissAchievements}
      />

      {!touring && (
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
      )}
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

type SceneEffectsProps = Omit<UseSceneEffectsParams, 'view' | 'highlightedIds' | 'lampsOff' | 'tvsOn'>;

// Renders nothing: it owns the scene effects, subscribed to the whole view
// (time of day included) and to the catalog search's highlighted items.
function SceneEffects(props: SceneEffectsProps): null {
  const view = useEditorView((state) => state.view);
  // A string key, so a keystroke that matches the same items keeps the set's
  // identity and leaves the furniture effect alone.
  const highlightKey = useEditorView((state) => catalogHighlightKey(state.catalogQuery, props.activeFloor.items));
  const highlightedIds = useMemo(() => highlightIdsFromKey(highlightKey), [highlightKey]);
  // Lamps switched off in EXPLORE (#910).
  const lampsOff = useEditorView((state) => state.lampsOff);
  // TVs switched on in EXPLORE (#910).
  const tvsOn = useEditorView((state) => state.tvsOn);
  // Ahead of the scene effects (#393); a floor switch glides (#930).
  const { layout, activeFloor, activeFloorIndex, cameraRef, controlsRef, invalidate } = props;
  useCameraTargetOnStorey({
    cameraRef,
    controlsRef,
    targetY: floorElevation(layout.floors, activeFloorIndex) + storeyHeight(activeFloor) / 2,
    floorIndex: activeFloorIndex,
    walkthroughActive: view.walkthroughMode && !view.view2D,
    invalidate,
  });
  useSceneEffects({ ...props, view, highlightedIds, lampsOff, tvsOn });
  return null;
}

export default RoomOrganizer;
