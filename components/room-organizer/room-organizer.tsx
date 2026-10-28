'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { EditorViewProvider, useEditorView } from './contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from './contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from './contexts/selection-context';
import { catalogHighlightKey, createEditorViewStore, highlightIdsFromKey, viewExceptTime } from './hooks/editor-view-store';
import { selectionTurns } from './hooks/layout-reducer';
import { markLayoutLoaded, useAchievements } from './hooks/use-achievements';
import { useCameraPresets } from './hooks/use-camera-presets';
import { useCameraVision } from './hooks/use-camera-vision';
import { useCanvas2DInteraction } from './hooks/use-canvas-2d-interaction';
import { useEdgeVar } from './hooks/use-edge-var';
import { useEvent } from './hooks/use-event';
import { useFloorKeepOut } from './hooks/use-floor-keep-out';
import { useHistory } from './hooks/use-history';
import { useImportExport } from './hooks/use-import-export';
import { useItemDrag } from './hooks/use-item-drag';
import { useItemPlacement } from './hooks/use-item-placement';
import { useKeyboardPlacement } from './hooks/use-keyboard-placement';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';
import { useLayoutPersistence, useSaveStatus, type SaveStatus, type SaveStatusStore } from './hooks/use-layout-persistence';
import { useLayoutState } from './hooks/use-layout-state';
import { layoutStore } from './hooks/use-layout-store';
import { useNpcs } from './hooks/use-npcs';
import { usePeopleModel } from './hooks/use-people-model';
import { usePlacementGhost } from './hooks/use-placement-ghost';
import { useRecentColors } from './hooks/use-recent-colors';
import { useSceneEffects, measurementDistance, type UseSceneEffectsParams } from './hooks/use-scene-effects';
import { useThreeScene } from './hooks/use-three-scene';
import { useWalkthrough, type WalkthroughBuilding } from './hooks/use-walkthrough';
import { useWeather } from './hooks/use-weather';
import { furnitureSpend, purchasePrice, purchaseRefusal } from './lib/budget';
import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR } from './lib/camera-zoom';
import { findCatalogEntry } from './lib/catalog-drag';
import { buildPasteItems, copyToClipboard } from './lib/clipboard';
import { CAMERA_BRACKET_ARM, FURNITURE_CATALOG } from './lib/constants';
import { saveCustomSet } from './lib/custom-sets';
import { ROOF_EAVE_OVERHANG } from './lib/dormers';
import { notify } from './lib/editor-notices';
import { hasCollisions } from './lib/geometry';
import { expandSelection, groupIdsIn, isWholeGroup } from './lib/groups';
import { randomSuffix } from './lib/ids';
import { reseatWallMountedItem, settleWallMountedItem } from './lib/opening-snap';
import { snapshotBeforeReplace } from './lib/restore-point';
import { playSound, type SoundCue } from './lib/sounds';
import { buildingHeight, floorElevation, storeyHeight } from './lib/storeys';
import { entrancePlanOutline } from './lib/street';
import { modeAfterExplore, rememberModeBeforeExplore, sceneWallDisplay } from './lib/walkthrough-view';
import { snapWallEndpoint } from './lib/wall-snap';
import { AchievementToast } from './panels/achievement-toast';
import { BottomHud } from './panels/bottom-hud';
import { DevDiagnostics } from './panels/dev-diagnostics';
import { FloorPill } from './panels/floor-pill';
import { HeaderStats, type HeaderStatsProps } from './panels/header-stats';
import { ItemContextPopover } from './panels/item-context-popover';
import { LotBadge } from './panels/lot-badge';
import { PlacementHint } from './panels/placement-hint';
import { SidebarDrawer } from './panels/sidebar-drawer';
import { StatusToastHost } from './panels/status-toast';
import { TouchModeToggle } from './panels/touch-mode-toggle';
import { Viewport } from './panels/viewport';
import { WallDisplayPill } from './panels/wall-display-pill';
import { WelcomeBanner } from './panels/welcome-banner';
import { ZoneNameChip } from './panels/zone-name-chip';
import { roofPeakHeight } from './three/roof';
import type { HoverInfo } from './hooks/use-three-scene';
import type { CatalogItem, FurnitureItem, GameMode, RoomLayout, ViewSettings, WallId } from './lib/types';

function orbitCamera(
  THREE: typeof import('./three/three-runtime'),
  camera: import('three').PerspectiveCamera,
  controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls,
  direction: 'left' | 'right' | 'up' | 'down'
): void {
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  const step = 0.22;
  switch (direction) {
    case 'left':
      spherical.theta += step;
      break;
    case 'right':
      spherical.theta -= step;
      break;
    case 'up':
      spherical.phi = Math.max(0.15, spherical.phi - step / 2);
      break;
    case 'down':
      spherical.phi = Math.min(Math.PI / 2.2, spherical.phi + step / 2);
      break;
  }
  offset.setFromSpherical(spherical);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

function zoomCamera(
  camera: import('three').PerspectiveCamera,
  controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls,
  direction: '+' | '-'
): void {
  const offset = camera.position.clone().sub(controls.target);
  const factor = direction === '+' ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
  offset.multiplyScalar(factor);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

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
  drawWallMode: false,
  drawZoneMode: false,
  showHeatmap: false,
  showItemLabels: false,
  showNpcs: false,
  showCameraVision: true,
};

/** Whether an item landed: the reducer refuses adds and copies on a full floor. */
function itemExists(id: string): boolean {
  return layoutStore.getState().layout.floors.some((floor) => floor.items.some((item) => item.id === id));
}

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
  const { setView, toggle, setGameMode } = viewStore.getState().actions;
  const view = useStore(viewStore, useShallow(viewExceptTime));
  const autoCycleLighting = useStore(viewStore, (state) => state.autoCycleLighting);

  // First-person walkthrough only runs in the 3D view; the 2D top-down renderer
  // has no PointerLockControls. This single signal gates walkthrough-aware
  // behaviour: canvas select/drag/hover, single-key shortcuts and the hook.
  const walkthroughActive = view.walkthroughMode && !view.view2D;

  const playCue = useCallback(
    (cue: SoundCue) => {
      if (view.soundsEnabled) playSound(cue);
    },
    [view.soundsEnabled]
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedWall, setSelectedWall] = useState<{ id: string; kind: 'exterior' | 'interior' } | null>(null);
  const [extraSelectedIds, setExtraSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [measurementPoints, setMeasurementPoints] = useState<ReadonlyArray<{ x: number; z: number }>>([]);
  const [wallDraft, setWallDraft] = useState<{ x: number; z: number } | null>(null);
  const [pointerWorld, setPointerWorld] = useState<{ x: number; z: number } | null>(null);

  const wallSnapResult = useMemo(() => {
    if (!view.drawWallMode || !pointerWorld) return null;
    return snapWallEndpoint({
      point: pointerWorld,
      existingWalls: activeFloor.interiorWalls ?? [],
      fromPoint: wallDraft,
      roomWidth: layout.width,
      roomDepth: layout.height,
    });
  }, [view.drawWallMode, pointerWorld, activeFloor.interiorWalls, wallDraft, layout.width, layout.height]);

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
      if (view.drawWallMode) {
        const snapped = snapWallEndpoint({
          point: { x, z },
          existingWalls: activeFloor.interiorWalls ?? [],
          fromPoint: wallDraft,
          roomWidth: layout.width,
          roomDepth: layout.height,
        });
        if (!wallDraft) {
          setWallDraft(snapped.point);
          return;
        }
        // Reject zero-length walls (two clicks on the same vertex).
        const length = Math.hypot(snapped.point.x - wallDraft.x, snapped.point.z - wallDraft.z);
        if (length < 0.1) {
          setWallDraft(null);
          return;
        }
        const id = `wall-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        actions.addInteriorWall({
          id,
          x1: wallDraft.x,
          z1: wallDraft.z,
          x2: snapped.point.x,
          z2: snapped.point.z,
        });
        // Chain: keep the just-placed endpoint as the start of the next wall.
        setWallDraft(snapped.point);
        return;
      }
      if (view.measurementMode) {
        setMeasurementPoints((current) => {
          if (current.length >= 2) return [{ x, z }];
          return [...current, { x, z }];
        });
      }
    },
    [
      view.measurementMode,
      view.drawWallMode,
      wallDraft,
      actions,
      activeFloor.interiorWalls,
      layout.width,
      layout.height,
    ]
  );

  const handleFloorPointerMove = useCallback((x: number, z: number) => {
    setPointerWorld({ x, z });
  }, []);

  const handleFloorPointerLeave = useCallback(() => {
    setPointerWorld(null);
  }, []);

  // Reset wall draft + wall selection whenever draw mode flips off.
  useEffect(() => {
    if (!view.drawWallMode) {
      setWallDraft(null);
      setSelectedWall(null);
      setPointerWorld(null);
    }
  }, [view.drawWallMode]);

  // Floor switch: drop any in-progress wall draft and selection (those live on
  // the previous floor).
  useEffect(() => {
    setWallDraft(null);
    setSelectedItemId(null);
    setSelectedWall(null);
    setExtraSelectedIds(new Set());
    // Points are floor-plane coordinates; kept, they'd float on the new floor
    // showing a distance measured on the old one (#224).
    setMeasurementPoints([]);
    // activeFloor.id: removing floor 0 (or reordering) can change WHICH floor
    // is active while the index stays 0 — keying on the index alone carried
    // the deleted floor's selection onto its replacement (#117).
  }, [activeFloorIndex, activeFloor.id]);

  // Ghost-selection guard: whenever the floor's items change (undo/redo,
  // import, clear floor, deletes from any path), drop selected ids that no
  // longer exist; a vanished primary promotes the first surviving extra (#117).
  useEffect(() => {
    const ids = new Set(activeFloor.items.map((item) => item.id));
    const primaryGone = selectedItemId !== null && !ids.has(selectedItemId);
    const hasStaleExtras = Array.from(extraSelectedIds).some((id) => !ids.has(id));
    if (!primaryGone && !hasStaleExtras) return;
    const liveExtras = Array.from(extraSelectedIds).filter((id) => ids.has(id));
    if (primaryGone) setSelectedItemId(liveExtras.shift() ?? null);
    setExtraSelectedIds(new Set(liveExtras));
  }, [activeFloor.items, selectedItemId, extraSelectedIds]);

  // Same guard for a selected interior wall: undo/redo past its creation (or
  // any path that removes it) would otherwise leave the paint panel open and
  // dispatching against a wall that no longer exists (#224).
  useEffect(() => {
    if (selectedWall?.kind !== 'interior') return;
    const exists = (activeFloor.interiorWalls ?? []).some((wall) => wall.id === selectedWall.id);
    if (!exists) setSelectedWall(null);
  }, [activeFloor.interiorWalls, selectedWall]);

  // Make `id` the sole selection (null clears). The one way panels set a
  // primary — pairing the two setters at every call site is how stale extras
  // leaked into later group operations (#117).
  const selectOnly = useCallback((id: string | null) => {
    setSelectedItemId(id);
    setExtraSelectedIds((extras) => (extras.size === 0 ? extras : new Set()));
  }, []);

  // A whole-layout replacement (import, share/local hydration, adopting
  // another tab's save) invalidates every piece of transient selection state,
  // not just the item ids (#224).
  const clearTransientSelection = useCallback(() => {
    selectOnly(null);
    setSelectedWall(null);
    setMeasurementPoints([]);
  }, [selectOnly]);

  // Plain reads + flat setter calls. The previous version computed the
  // promotion inside a nested setState updater and read the result back
  // synchronously — that only works on React's eager-evaluation path, and
  // StrictMode's double-invoked updaters ran the toggle twice (#117).
  //
  // Persistent groups (#154) expand HERE, not in the canvas handlers: both
  // the 3D raycast and the 2D hit-test report the clicked id and modifier,
  // and this one place turns a grouped id into its whole group, so the two
  // views can't drift. 'replace' selects the group with the clicked member
  // as primary; 'toggle' adds or removes the whole group; 'single'
  // (Alt+click) is the escape hatch that picks one member on its own.
  const handleSelect = useCallback(
    (id: string, mode: 'replace' | 'toggle' | 'single') => {
      const members = mode === 'single' ? new Set([id]) : expandSelection(activeFloor.items, id);
      if (mode !== 'toggle') {
        if (members.size === 1) {
          selectOnly(id);
          return;
        }
        setSelectedItemId(id);
        const extras = new Set(members);
        extras.delete(id);
        setExtraSelectedIds(extras);
        return;
      }
      if (selectedItemId === null) {
        setSelectedItemId(id);
        const extras = new Set(members);
        extras.delete(id);
        setExtraSelectedIds(extras);
        return;
      }
      const allIn = Array.from(members).every(
        (member) => member === selectedItemId || extraSelectedIds.has(member)
      );
      const next = new Set(extraSelectedIds);
      if (allIn) {
        // Toggling off: drop every member. If the primary was among them,
        // promote a surviving extra (keeping the rest of the multi-select
        // intact) or clear the selection entirely.
        for (const member of members) next.delete(member);
        if (members.has(selectedItemId)) {
          const [promoted] = next;
          if (promoted === undefined) {
            setSelectedItemId(null);
            setExtraSelectedIds(new Set());
            return;
          }
          next.delete(promoted);
          setSelectedItemId(promoted);
        }
        setExtraSelectedIds(next);
        return;
      }
      for (const member of members) {
        if (member !== selectedItemId) next.add(member);
      }
      setExtraSelectedIds(next);
    },
    [activeFloor.items, selectedItemId, extraSelectedIds, selectOnly]
  );

  const allSelectedIds = useMemo(() => {
    const set = new Set(extraSelectedIds);
    if (selectedItemId) set.add(selectedItemId);
    return set;
  }, [selectedItemId, extraSelectedIds]);

  // Persistent groups (#154). Group merges whatever is selected — members of
  // other groups included — into one fresh group; Ungroup frees every
  // selected item. The selection itself is untouched either way, so a
  // freshly grouped set stays selected and draggable.
  const selectionIsGroup = useMemo(
    () => isWholeGroup(activeFloor.items, allSelectedIds),
    [activeFloor.items, allSelectedIds]
  );
  const selectionHasGroups = useMemo(
    () => groupIdsIn(activeFloor.items, allSelectedIds).size > 0,
    [activeFloor.items, allSelectedIds]
  );
  const groupSelection = useCallback(() => {
    if (allSelectedIds.size < 2) return;
    actions.setGroup(allSelectedIds);
  }, [actions, allSelectedIds]);
  const ungroupSelection = useCallback(() => {
    actions.clearGroup(allSelectedIds);
  }, [actions, allSelectedIds]);

  // Custom sets (#302): the selection, normalised around its centroid, under
  // a name the user picks — typed into the selection chip (#374). Groups
  // inside it are kept and come back as fresh groups when the set is placed.
  const saveSelectionAsSet = useCallback((name: string) => {
    const items = activeFloor.items.filter((item) => allSelectedIds.has(item.id));
    if (items.length < 2 || !name.trim()) return false;
    const saved = saveCustomSet(items, name, { idTag: randomSuffix() });
    if (!saved) {
      notify('Could not save the set — browser storage is full.', 'error');
      return false;
    }
    notify(`Saved “${saved.name}” to Furniture Sets.`, 'success');
    playCue('success');
    return true;
  }, [activeFloor.items, allSelectedIds, playCue]);

  // The recess's span of the front wall on this storey; openings settle on
  // its piers (#394). Memoised on what the recess is fitted to.
  const { width: lotWidth, height: lotDepth, terrain, entrance, floors } = layout;
  const frontGap = useMemo(
    () => entrancePlanOutline({ width: lotWidth, height: lotDepth, terrain, entrance, floors }, activeFloorIndex),
    [lotWidth, lotDepth, terrain, entrance, floors, activeFloorIndex]
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
    actions,
    allSelectedIds,
  });

  // Re-seat a wall-mounted camera against its wall. A flush camera's body moves
  // to whichever side it faces (so the body + cone start at the wall surface
  // instead of passing through it); a bracketed camera stands off the wall by a
  // fixed arm, independent of facing, so it can pan freely. `bracket` overrides
  // the stored flag for the moment a user toggles the mount style.
  const reseatCamera = useCallback(
    (id: string, rotation: number, bracket?: boolean) => {
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (item?.type !== 'security-camera' || !item.position) return;
      const bracketed = bracket ?? item.cameraBracket ?? false;
      const pos = reseatWallMountedItem({
        position: item.position,
        itemWidth: item.width,
        itemDepth: item.depth,
        roomWidth: layout.width,
        roomDepth: layout.height,
        interiorWalls: activeFloor.interiorWalls ?? [],
        rotation,
        ...(bracketed ? { bracketArm: CAMERA_BRACKET_ARM } : {}),
      });
      actions.moveItem(id, pos.x, pos.z);
    },
    [activeFloor.items, activeFloor.interiorWalls, layout.width, layout.height, actions]
  );

  // Locked items are immune to rotation — group rotates orbit items around
  // the centroid, so rotating a set containing a locked item would move it
  // (#115). The unlocked subset still rotates about its own centroid.
  const unlockedSelectedIds = useCallback(() => {
    const lockedIds = new Set(activeFloor.items.filter((item) => item.locked).map((item) => item.id));
    return new Set(Array.from(allSelectedIds).filter((id) => !lockedIds.has(id)));
  }, [activeFloor.items, allSelectedIds]);

  // Returns whether anything actually rotated. A real rotation plays the
  // rotate cue, a refused one (locked) the refused cue: a locked item's no-op
  // used to chime anyway, audibly lying about what happened (#209, #460).
  const rotateItemHandler = useCallback(
    (id: string): boolean => {
      if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
        const unlocked = unlockedSelectedIds();
        // Doors and windows stay on their walls (#583): a selection of only
        // those turns nothing, so the cue must not say it did.
        if (!selectionTurns(activeFloor.items, unlocked)) {
          playCue('refused');
          return false;
        }
        actions.rotateSelection(unlocked, Math.PI / 2);
        playCue('rotate');
        return true;
      }
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (!item) return false;
      if (item.locked) {
        playCue('refused');
        return false;
      }
      if (item.type === 'security-camera') {
        // A flush camera can only face into the room or straight out, so Rotate
        // flips 180° along its wall's in/out axis. A bracketed camera pans freely.
        const step = item.cameraBracket ? Math.PI / 2 : Math.PI;
        const next = ((item.rotation ?? 0) + step) % (Math.PI * 2);
        actions.setRotation(id, next);
        reseatCamera(id, next);
        playCue('rotate');
        return true;
      }
      const next = ((item.rotation ?? 0) + Math.PI / 2) % (Math.PI * 2);
      actions.setRotation(id, next);
      playCue('rotate');
      return true;
    },
    [allSelectedIds, unlockedSelectedIds, activeFloor.items, actions, reseatCamera, playCue]
  );

  // Toggle a camera's stand-off bracket. Enabling it keeps the current facing
  // and lifts the camera onto the arm; disabling it snaps the camera back flush
  // and re-locks facing to the wall's inward normal.
  const toggleCameraBracket = useCallback(
    (id: string) => {
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (item?.type !== 'security-camera') return;
      // The toggle moves the camera on/off its arm; a locked camera must not
      // move — and the reducer would now refuse the setRotation/moveItem half
      // anyway, leaving the bracket flag desynced from the position (#209).
      if (item.locked) return;
      const next = !item.cameraBracket;
      actions.updateItem(id, { cameraBracket: next });
      const rotation = next ? item.rotation ?? 0 : item.wallRotation ?? item.rotation ?? 0;
      if (!next) actions.setRotation(id, rotation);
      reseatCamera(id, rotation, next);
    },
    [activeFloor.items, actions, reseatCamera]
  );

  const history = useHistory(layout, useCallback(
    (snapshot: RoomLayout) => {
      // On the storey the undone change was on (#578).
      actions.restoreLayout(snapshot);
      // An undo or redo restores a house; it earns nothing (#450).
      markLayoutLoaded();
    },
    [actions]
  ));
  // The stable callbacks, so the wrappers below don't change identity every
  // time canUndo/canRedo flips.
  const { commitNow: commitHistoryNow, clear: clearHistory } = history;

  /**
   * Hard budget (#463e): true, after telling the player, when a buy costing
   * `price` is over what's left. The selection is left alone and the
   * refused cue plays instead of the place one: nothing was bought.
   */
  const refuseOverBudget = useCallback((price: number): boolean => {
    const refusal = purchaseRefusal(layoutStore.getState().layout, price);
    if (refusal === null) return false;
    playCue('refused');
    notify(refusal, 'error');
    return true;
  }, [playCue]);

  // Wrap layout actions with the side-effect of clearing the selection when
  // the targeted item disappears. Discrete actions (delete, duplicate, add,
  // paste) each get an undo step of their own (#425).
  const removeItem = useCallback(
    (id: string) => {
      commitHistoryNow();
      // Demolish sells back: 80 % refunded under the hard budget (#463e).
      actions.sellItems([id]);
      playCue('remove');
      setSelectedItemId((current) => (current === id ? null : current));
      setExtraSelectedIds((extras) => {
        if (!extras.has(id)) return extras;
        const next = new Set(extras);
        next.delete(id);
        return next;
      });
    },
    [actions, commitHistoryNow, playCue]
  );

  const removeSelected = useCallback(() => {
    if (allSelectedIds.size === 0) return;
    // A lock pins position, not existence: every placed item is locked after
    // placement and drag, so deletion ignores it like Demolish does (#358).
    if (!activeFloor.items.some((item) => allSelectedIds.has(item.id))) return;
    commitHistoryNow();
    actions.sellItems([...allSelectedIds]);
    playCue('remove');
    setSelectedItemId(null);
    setExtraSelectedIds(new Set());
  }, [actions, commitHistoryNow, activeFloor.items, allSelectedIds, playCue]);

  // Duplicate the current selection. For a multi-select every selected item is
  // copied (each offset by the reducer) and the copies become the new
  // selection, so the result is a clean set of duplicates rather than one new
  // copy mixed in with the stale originals' ids.
  // The reducer refuses a copy on a full floor; only copies that landed are
  // selected and chimed for, and a refusal sounds as one (#460).
  const duplicateSelected = useCallback(
    (primaryId: string) => {
      // Hard budget (#463e): all the copies or none, and say why — the
      // reducer would refuse an unaffordable copy silently.
      const copying =
        allSelectedIds.size > 1 && allSelectedIds.has(primaryId)
          ? activeFloor.items.filter((item) => allSelectedIds.has(item.id))
          : activeFloor.items.filter((item) => item.id === primaryId);
      if (refuseOverBudget(purchasePrice(copying))) return;
      commitHistoryNow();
      const multi = allSelectedIds.size > 1 && allSelectedIds.has(primaryId);
      // Duplicate the primary first so it becomes the new primary, then the
      // remaining selected items in a stable order.
      const others = multi ? Array.from(allSelectedIds).filter((id) => id !== primaryId) : [];
      const copies = [primaryId, ...others].map((id) => actions.duplicateItem(id)).filter(itemExists);
      const [newPrimary, ...newExtras] = copies;
      if (newPrimary === undefined) {
        playCue('refused');
        return;
      }
      playCue('place');
      setSelectedItemId(newPrimary);
      // A single copy clears stale extras, so the selection is only the copy.
      setExtraSelectedIds(new Set(newExtras));
    },
    [actions, commitHistoryNow, allSelectedIds, activeFloor.items, refuseOverBudget, playCue]
  );

  const { saveStatus, remoteLayout, clearRemoteLayout } = useLayoutPersistence({
    layout,
    onHydrate: useCallback(
      (saved: RoomLayout) => {
        actions.applyLayout(saved);
        // The saved or shared house the session opens on earns nothing (#450).
        markLayoutLoaded();
        clearTransientSelection();
        // The store dispatch is synchronous, so this is the exact (normalised)
        // layout the next render shows — an explicit baseline (#354).
        clearHistory(layoutStore.getState().layout);
      },
      [actions, clearHistory, clearTransientSelection]
    ),
  });

  // Adopt the snapshot another tab saved (#123). Deliberately a plain
  // applyLayout, not the hydrate path: it lands as a normal history entry, so
  // switching to the other tab's version is one Ctrl+Z away from being undone.
  const adoptRemoteLayout = useCallback(() => {
    if (!remoteLayout) return;
    snapshotBeforeReplace(layout);
    // An edit still in the debounce window keeps its own undo step (#555).
    commitHistoryNow();
    actions.applyLayout(remoteLayout);
    markLayoutLoaded();
    clearTransientSelection();
    clearRemoteLayout();
  }, [remoteLayout, layout, actions, commitHistoryNow, clearTransientSelection, clearRemoteLayout]);

  const selectedItem = useMemo(
    () => (selectedItemId ? activeFloor.items.find((item) => item.id === selectedItemId) ?? null : null),
    [activeFloor.items, selectedItemId]
  );

  const hasSignalItems = useMemo(
    () => activeFloor.items.some((item) => item.isWiFiAccessPoint || item.isCCTV),
    [activeFloor.items]
  );

  // What the header counts: the porch door is free (#600). The soft-budget
  // confirm reads it, so the hard budget's write-off doesn't matter here.
  const buildingCost = useMemo(() => furnitureSpend({ floors: layout.floors }), [layout.floors]);

  const { snapPosition, getDragPlaneY, snapCatalogPlacement, placeCatalogItem } = useItemPlacement({
    activeFloor,
    activeFloorY,
    roomWidth: layout.width,
    roomDepth: layout.height,
    buildingCost,
    actions,
    view,
    allSelectedIds,
    frontGap,
    refusePurchase: refuseOverBudget,
  });

  const deselectAll = useCallback(() => selectOnly(null), [selectOnly]);

  // Every catalog add (tile click, keyboard, drag-drop) comes through here,
  // so each chimes once (#460). '' = declined or refused: nothing was added.
  const placeDiscrete = useCallback(
    (catalogItem: CatalogItem, position?: { x: number; z: number }, rotation?: number): string => {
      commitHistoryNow();
      const id = placeCatalogItem(catalogItem, position, rotation);
      if (!id) return id;
      // The reducer refuses an add on a full floor.
      if (!itemExists(id)) {
        playCue('refused');
        return '';
      }
      playCue('place');
      return id;
    },
    [commitHistoryNow, placeCatalogItem, playCue]
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

  // 2D plan select/drag (#219). Reuses use-item-drag's session, so the commit
  // semantics (single dispatch, lock-on-release, wall settling, isDragActive
  // keyboard gate) are identical to a 3D drag.
  const { clientToWorld2D } = useCanvas2DInteraction({
    enabled: view.view2D,
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
    onItemDragStart: handleDragStart,
    onItemDrag: handleDrag,
    onItemDragEnd: handleDragEnd,
    onItemDragCancel: handleDragCancel,
  });

  const { isReady, error, invalidate, requestShadowUpdate, threeModuleRef, sceneRef, rendererRef, cameraRef, controlsRef, worldPositionFromClient } =
    useThreeScene({
      canvasRef,
      walkthroughActive,
      // The distance tool measures across furniture, so its clicks go to the floor (#341).
      floorPickOnly: view.drawWallMode || view.measurementMode,
      onItemSelect: handleSelect,
      selectedIds: allSelectedIds,
      onItemDragStart: handleDragStart,
      onItemDrag: handleDrag,
      onItemDragEnd: handleDragEnd,
      onItemDragCancel: handleDragCancel,
      onItemHover: setHover,
      onEmptyClick: handleEmptyClick,
      onWallSelect: ({ wallId, kind }) => {
        setSelectedWall({ id: wallId, kind });
      },
      // Only track the floor pointer while wall-draw mode consumes it — the
      // handler writes React state per mousemove, re-rendering the whole tree,
      // and the hook skips the floor raycast when the handler is absent.
      ...(view.drawWallMode ? { onFloorPointerMove: handleFloorPointerMove } : {}),
      onFloorPointerLeave: handleFloorPointerLeave,
      snapPosition,
      getDragPlaneY,
    });

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
    storeyHeight: activeStoreyHeight,
  });
  // A mode switch (Design, Furnish, Explore) puts the ghost down too.
  const gameMode = useStore(viewStore, (state) => state.gameMode);
  useEffect(() => endGhost(), [gameMode, endGhost]);


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
      ...(layout.neighbours ? { neighbours: layout.neighbours } : {}),
      ...(walkRoofStyle ? { roof: { style: walkRoofStyle, ...(walkRoofColor ? { color: walkRoofColor } : {}) } } : {}),
    }),
    [layout.width, layout.height, layout.floors, layout.terrain, layout.entrance, layout.frontage, layout.neighbours, walkRoofStyle, walkRoofColor]
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
    onFloorChange: actions.setActiveFloorIndex,
    onExit: exitWalkthrough,
  });

  // people.glb is fetched only once a person is placed or the walkers are on.
  const layoutHasPeople = useMemo(
    () => layout.floors.some((floor) => floor.items.some((item) => item.type === 'person')),
    [layout.floors]
  );
  const peopleModelReady = usePeopleModel(threeModuleRef, isReady, layoutHasPeople || view.showNpcs);

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
    wallDraft,
    wallSnapResult,
    measurementPoints,
    walkIndoors: walkthroughActive && !walk.outside,
    walkNearStairs: walk.nearStairs,
    walkLampStorey: walk.lampStorey,
  };

  useNpcs({
    enabled: isReady && view.showNpcs && !view.view2D,
    invalidate,
    requestShadowUpdate,
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

  useWeather({
    weather: view.weather,
    enabled: isReady && !view.view2D,
    invalidate,
    threeModuleRef,
    sceneRef,
    roomWidth: layout.width,
    roomDepth: layout.height,
  });

  useCameraVision({
    enabled: isReady && view.showCameraVision && !view.view2D,
    invalidate,
    threeModuleRef,
    sceneRef,
    // Cones don't see through walls (#590).
    building: walkBuilding,
  });

  // The roof as camera framing sees it: on screen only with the walls up,
  // on the top storey or with every storey shown (as the roof effect shows it;
  // the walkthrough shows every storey, #446).
  const roofStyle = layout.roof?.style ?? 'none';
  const roofShows =
    roofStyle !== 'none' &&
    sceneWallDisplay(view.wallDisplay, walkthroughActive) === 'up' &&
    (view.showAllFloors || walkthroughActive || activeFloorIndex === layout.floors.length - 1);
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

  // Furniture clipboard (#153): copy normalizes the selection around its
  // centroid; paste rebuilds it on the ACTIVE floor (cross-floor paste is the
  // point), settled/clamped, unlocked, and selected — one undo entry.
  const copySelectionToClipboard = useCallback(() => {
    const items = activeFloor.items.filter((item) => allSelectedIds.has(item.id));
    return copyToClipboard(items) > 0;
  }, [activeFloor.items, allSelectedIds]);

  const pasteFromClipboard = useCallback(() => {
    const built = buildPasteItems({
      roomWidth: layout.width,
      roomDepth: layout.height,
      interiorWalls: activeFloor.interiorWalls ?? [],
      idTag: randomSuffix(),
      floorIndex: activeFloorIndex,
    });
    if (built.length === 0) return false;
    if (refuseOverBudget(purchasePrice(built))) return false;
    commitHistoryNow();
    actions.addItems(built);
    selectOnly(built[0]!.id);
    if (built.length > 1) {
      setExtraSelectedIds(new Set(built.slice(1).map((item) => item.id)));
    }
    playCue('place');
    return true;
  }, [layout.width, layout.height, activeFloor.interiorWalls, activeFloorIndex, actions, commitHistoryNow, selectOnly, playCue, refuseOverBudget]);

  const shortcutHandlers = useMemo(
    () => ({
      removeItem: (id: string) => {
        if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
          removeSelected();
          return;
        }
        removeItem(id);
      },
      duplicateItem: duplicateSelected,
      copySelection: copySelectionToClipboard,
      pasteClipboard: pasteFromClipboard,
      rotateItem: rotateItemHandler,
      rotateItemBy: (id: string, radians: number) => {
        if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
          const unlocked = unlockedSelectedIds();
          if (!selectionTurns(activeFloor.items, unlocked)) {
            playCue('refused');
            return;
          }
          actions.rotateSelection(unlocked, radians);
          playCue('rotate');
          return;
        }
        const item = activeFloor.items.find((entry) => entry.id === id);
        if (!item) return;
        if (item.locked) {
          playCue('refused');
          return;
        }
        const next = ((item.rotation ?? 0) + radians) % (Math.PI * 2);
        actions.setRotation(id, next);
        reseatCamera(id, next);
        playCue('rotate');
      },
      moveItem: (id: string, x: number, z: number) => {
        // Arrow nudges settle wall-mounted items back onto their wall the way
        // drag release does — a nudged door slides along its wall instead of
        // translating into the room as a free slab (#116).
        const item = activeFloor.items.find((entry) => entry.id === id);
        const settled = item
          ? settleWallMountedItem(
              item,
              { x, z },
              layout.width,
              layout.height,
              activeFloor.interiorWalls ?? [],
              frontGap
            )
          : null;
        if (settled) actions.updateItem(id, settled);
        else actions.moveItem(id, x, z);
      },
      toggle2D: () => toggle('view2D'),
      toggleMeasurements: () => toggle('showMeasurements'),
      toggleSnap: () => toggle('snapToGrid'),
      toggleSignals: () => toggle('showWiFiSignals'),
      undo: history.undo,
      redo: history.redo,
      deselect: () => {
        if (wallDraft) {
          setWallDraft(null);
          return;
        }
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
        setSelectedItemId(null);
        setExtraSelectedIds(new Set());
      },
      focusOnSelection: () => {
        if (selectedItem?.position) focusOn(selectedItem.position, undefined, activeFloorY);
      },
      advanceTime: (deltaHours: number) => {
        setView((v) => ({ ...v, timeOfDay: (((v.timeOfDay + deltaHours) % 24) + 24) % 24 }));
      },
      changeFloor: (delta: number) => {
        const next = activeFloorIndex + delta;
        if (next < 0 || next >= layout.floors.length) return;
        actions.setActiveFloorIndex(next);
      },
      toggleSidebar: () => setSidebarCollapsed((c) => !c),
      removeInteriorWall: (id: string) => {
        actions.removeInteriorWall(id);
        setSelectedWall(null);
      },
      // Keep the selection (and the auto-opened paint panel) after hiding an
      // exterior wall so the Wall Visibility toggles stay reachable to restore it.
      toggleExteriorWall: (id: string) => {
        actions.toggleExteriorWall(id as WallId);
      },
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
      frontGap,
      removeItem,
      removeSelected,
      duplicateSelected,
      copySelectionToClipboard,
      pasteFromClipboard,
      allSelectedIds,
      actions,
      activeFloor.items,
      activeFloor.interiorWalls,
      activeFloorIndex,
      activeFloorY,
      layout.floors.length,
      layout.width,
      layout.height,
      unlockedSelectedIds,
      setView,
      toggle,
      history.undo,
      history.redo,
      selectedItem,
      focusOn,
      rotateItemHandler,
      reseatCamera,
      playCue,
      wallDraft,
      view.drawWallMode,
      view.measurementMode,
      view.drawZoneMode,
    ]
  );

  useKeyboardShortcuts({
    selectedItem,
    selectedWall,
    hasSignalItems,
    walkthroughActive,
    isDragActive,
    handlers: shortcutHandlers,
  });



  // Stable identities for the memoised drawer and HUD (#3): these handlers
  // close over the layout, so they change on every edit.
  const collapseSidebar = useCallback(() => setSidebarCollapsed(true), []);
  const stableApplyPreset = useEvent(applyPreset);
  const stableFitToRoom = useEvent(fitToRoom);
  const stableScreenshot = useEvent(handleScreenshot);
  const stableImport = useEvent(handleImport);
  const stableExportGlb = useEvent(handleExportGlb);
  const stableShareLink = useEvent(handleShareLink);
  const stablePlaceFromCatalog = useEvent(placeFromCatalog);
  const stableRemoveItem = useEvent(removeItem);
  const stableDuplicateItem = useEvent(duplicateSelected);
  const orbitByPad = useEvent((direction: 'left' | 'right' | 'up' | 'down') => {
    const THREE = threeModuleRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!THREE || !camera || !controls) return;
    orbitCamera(THREE, camera, controls, direction);
    // controls.update() above consumes the move, so the RAF loop won't
    // see it; mark the frame dirty explicitly (#337).
    invalidate();
  });
  const zoomByPad = useEvent((direction: '+' | '-') => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    zoomCamera(camera, controls, direction);
    invalidate();
  });

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

  const selectionValue = useMemo<SelectionContextValue>(
    () => ({
      selectedItemId,
      setSelectedItemId,
      selectedItem,
      extraSelectedIds,
      setExtraSelectedIds,
      allSelectedIds,
      selectOnly,
    }),
    [selectedItemId, setSelectedItemId, selectedItem, extraSelectedIds, setExtraSelectedIds, allSelectedIds, selectOnly]
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
        error={error}
        view2D={view.view2D}
        layout={layout}
        activeFloor={activeFloor}
        selectedItem={selectedItem}
        selectionCount={allSelectedIds.size}
        onCopySelection={copySelectionToClipboard}
        selectionGrouped={selectionIsGroup}
        onGroupSelection={selectionIsGroup ? undefined : groupSelection}
        onUngroupSelection={selectionHasGroups ? ungroupSelection : undefined}
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
                onStick: walk.setStick,
                onToggleSit: walk.toggleSit,
                onExit: exitWalkthrough,
              }
            : null
        }
        measurementDistance={measurementDistance(measurementPoints)}
        {...(view.measurementMode ? { measurementPointsPlaced: measurementPoints.length } : {})}
        wallDrawStatus={
          view.drawWallMode
            ? {
                hasAnchor: wallDraft !== null,
                ...(wallSnapResult ? { snapKind: wallSnapResult.kind } : {}),
                currentLength:
                  wallDraft && wallSnapResult
                    ? Math.hypot(
                        wallSnapResult.point.x - wallDraft.x,
                        wallSnapResult.point.z - wallDraft.z
                      )
                    : null,
              }
            : null
        }
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
          hasCollision={hasCollisions(
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
          onClose={() => {
            setSelectedItemId(null);
            setExtraSelectedIds(new Set());
          }}
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
      />

      {/* Touch mode toggle — visible on mobile only */}
      <TouchModeToggle controlsRef={controlsRef} isReady={isReady} onFit={fitToRoom} />

      {/* Welcome modal — auto-shows once, dismissible */}
      <WelcomeBanner />

      {/* Keyboard-placement key hint (#168) */}
      <PlacementHint active={placingId !== null} ghost={ghost} onCancel={placementGhost.cancel} />

      {/* Inline zone naming and export/share status (#374) */}
      <ZoneNameChip />
      <StatusToastHost />

      {/* Achievement toast */}
      <AchievementToast
        drawerOpen={!sidebarCollapsed}
        pending={pendingAchievements}
        onDismiss={dismissAchievements}
      />

      <SidebarDrawer
        collapsed={sidebarCollapsed}
        onCollapse={collapseSidebar}
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
