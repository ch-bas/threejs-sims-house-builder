'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RoomEditorProvider, type RoomEditorContextValue } from './contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from './contexts/selection-context';
import { useAchievements } from './hooks/use-achievements';
import { useCameraPresets } from './hooks/use-camera-presets';
import { useCameraVision } from './hooks/use-camera-vision';
import { useCanvas2DInteraction } from './hooks/use-canvas-2d-interaction';
import { useEntranceKeepOut } from './hooks/use-entrance-keep-out';
import { useHistory } from './hooks/use-history';
import { useImportExport } from './hooks/use-import-export';
import { useItemDrag } from './hooks/use-item-drag';
import { useItemPlacement } from './hooks/use-item-placement';
import { useKeyboardPlacement } from './hooks/use-keyboard-placement';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';
import { useLayoutPersistence } from './hooks/use-layout-persistence';
import { useLayoutState } from './hooks/use-layout-state';
import { useNpcs } from './hooks/use-npcs';
import { usePeopleModel } from './hooks/use-people-model';
import { useRecentColors } from './hooks/use-recent-colors';
import { useSceneEffects, measurementDistance } from './hooks/use-scene-effects';
import { useThreeScene } from './hooks/use-three-scene';
import { useWalkthrough } from './hooks/use-walkthrough';
import { useWeather } from './hooks/use-weather';
import { findCatalogEntry } from './lib/catalog-drag';
import { buildPasteItems, copyToClipboard } from './lib/clipboard';
import { CAMERA_BRACKET_ARM, FURNITURE_CATALOG } from './lib/constants';
import { saveCustomSet } from './lib/custom-sets';
import { hasCollisions, totalCost } from './lib/geometry';
import { expandSelection, groupIdsIn, isWholeGroup } from './lib/groups';
import { randomSuffix } from './lib/ids';
import { reseatWallMountedItem, settleWallMountedItem } from './lib/opening-snap';
import { snapshotBeforeReplace } from './lib/restore-point';
import { playSound, type SoundCue } from './lib/sounds';
import { buildingHeight, floorElevation, storeyHeight } from './lib/storeys';
import { snapWallEndpoint } from './lib/wall-snap';
import { AchievementToast } from './panels/achievement-toast';
import { BottomHud } from './panels/bottom-hud';
import { FloorPill } from './panels/floor-pill';
import { HeaderStats } from './panels/header-stats';
import { ItemContextPopover } from './panels/item-context-popover';
import { LotBadge } from './panels/lot-badge';
import { PlacementHint } from './panels/placement-hint';
import { SidebarDrawer } from './panels/sidebar-drawer';
import { TouchModeToggle } from './panels/touch-mode-toggle';
import { Viewport } from './panels/viewport';
import { WallDisplayPill } from './panels/wall-display-pill';
import { WelcomeBanner } from './panels/welcome-banner';
import type { HoverInfo } from './hooks/use-three-scene';
import type { GameMode } from './lib/types';
import type { RoomLayout, ViewSettings, WallId } from './lib/types';

function orbitCamera(
  THREE: typeof import('three'),
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
  const factor = direction === '+' ? 0.85 : 1.18;
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

export function RoomOrganizer(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas2DRef = useRef<HTMLCanvasElement>(null);

  const { layout, activeFloor, activeFloorIndex, actions } = useLayoutState();
  const activeFloorY = floorElevation(layout.floors, activeFloorIndex);
  const activeStoreyHeight = storeyHeight(activeFloor);
  const {
    unlocked: unlockedAchievements,
    pending: pendingAchievements,
    dismiss: dismissAchievements,
  } = useAchievements(layout);
  const { recent: recentColors, pushColor } = useRecentColors();
  const [view, setView] = useState<ViewSettings>(INITIAL_VIEW_SETTINGS);

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
  const [autoCycleLighting, setAutoCycleLighting] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [gameMode, setGameMode] = useState<GameMode>('build');
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

  const highlightedIds = useMemo(() => {
    const normalised = catalogQuery.trim().toLowerCase();
    if (!normalised) return new Set<string>();
    const matches = new Set<string>();
    for (const item of activeFloor.items) {
      if (item.name.toLowerCase().includes(normalised) || item.type.toLowerCase().includes(normalised)) {
        matches.add(item.id);
      }
    }
    return matches;
  }, [catalogQuery, activeFloor.items]);

  const keepOut = useEntranceKeepOut(layout, activeFloorIndex);
  const collidingIds = useMemo(() => {
    const matches = new Set<string>();
    for (const item of activeFloor.items) {
      if (hasCollisions(item, activeFloor.items, layout.width, layout.height, keepOut)) {
        matches.add(item.id);
      }
    }
    return matches;
  }, [activeFloor.items, layout.width, layout.height, keepOut]);

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

  // Slide the camera target to mid-height of the active storey — on a floor
  // switch, and when a storey height below or on it changes (#202), without
  // the selection reset above.
  const cameraTargetY = activeFloorY + activeStoreyHeight / 2;
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const newTargetY = cameraTargetY;
    const dy = newTargetY - controls.target.y;
    if (Math.abs(dy) < 0.01) return;
    // Keep the orbit target on the new storey even mid-walkthrough, so the
    // orbit camera aims right after an exit — but never touch the camera or
    // run controls.update() while walkthrough owns it: update() has no
    // `enabled` guard, so it re-aims the first-person camera at the orbit
    // target and clamps it back into the polar cone (#114/#216). Walkthrough
    // owns its own eye height.
    controls.target.y = newTargetY;
    if (!walkthroughActive) {
      camera.position.y += dy;
      controls.update();
    }
    // Defer painting to the next frame via invalidate(): a synchronous
    // renderer.render here ran BEFORE the scene effects rebuilt the new
    // floor, flashing the old floor's contents from the new camera (#216).
    invalidate();
    // The scene refs/invalidate are declared below (useThreeScene) so they
    // can't appear in this dep array without a TDZ error; they're stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraTargetY, walkthroughActive]);

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
  // a name the user picks. Groups inside it are kept and come back as fresh
  // groups when the set is placed.
  const saveSelectionAsSet = useCallback(() => {
    const items = activeFloor.items.filter((item) => allSelectedIds.has(item.id));
    if (items.length < 2) return;
    const name = window.prompt('Name this set:', `${items[0]!.name} set`);
    if (name === null) return;
    if (!name.trim()) {
      window.alert('Please enter a name for this set.');
      return;
    }
    const saved = saveCustomSet(items, name, { idTag: randomSuffix() });
    if (!saved) {
      window.alert('Could not save the set — browser storage is full.');
      return;
    }
    playCue('success');
  }, [activeFloor.items, allSelectedIds, playCue]);

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

  // Returns whether anything actually rotated, so callers only play the
  // rotate cue for a real rotation — a locked item's no-op used to chime
  // anyway, audibly lying about what happened (#209).
  const rotateItemHandler = useCallback(
    (id: string): boolean => {
      if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
        const unlocked = unlockedSelectedIds();
        if (unlocked.size === 0) return false;
        actions.rotateSelection(unlocked, Math.PI / 2);
        return true;
      }
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (!item || item.locked) return false;
      if (item.type === 'security-camera') {
        // A flush camera can only face into the room or straight out, so Rotate
        // flips 180° along its wall's in/out axis. A bracketed camera pans freely.
        const step = item.cameraBracket ? Math.PI / 2 : Math.PI;
        const next = ((item.rotation ?? 0) + step) % (Math.PI * 2);
        actions.setRotation(id, next);
        reseatCamera(id, next);
        return true;
      }
      const next = ((item.rotation ?? 0) + Math.PI / 2) % (Math.PI * 2);
      actions.setRotation(id, next);
      return true;
    },
    [allSelectedIds, unlockedSelectedIds, activeFloor.items, actions, reseatCamera]
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

  // Wrap layout actions with the side-effect of clearing the selection when
  // the targeted item disappears.
  const removeItem = useCallback(
    (id: string) => {
      actions.removeItem(id);
      playCue('remove');
      setSelectedItemId((current) => (current === id ? null : current));
      setExtraSelectedIds((extras) => {
        if (!extras.has(id)) return extras;
        const next = new Set(extras);
        next.delete(id);
        return next;
      });
    },
    [actions, playCue]
  );

  const removeSelected = useCallback(() => {
    if (allSelectedIds.size === 0) return;
    // Locked items survive a group delete — the same immunity the single-item
    // Delete gate gives them (#115).
    const remaining = activeFloor.items.filter((item) => !allSelectedIds.has(item.id) || item.locked);
    if (remaining.length === activeFloor.items.length) return;
    actions.replaceItems(remaining);
    setSelectedItemId(null);
    setExtraSelectedIds(new Set());
  }, [actions, activeFloor.items, allSelectedIds]);

  // Duplicate the current selection. For a multi-select every selected item is
  // copied (each offset by the reducer) and the copies become the new
  // selection, so the result is a clean set of duplicates rather than one new
  // copy mixed in with the stale originals' ids.
  const duplicateSelected = useCallback(
    (primaryId: string) => {
      if (allSelectedIds.size > 1 && allSelectedIds.has(primaryId)) {
        // Duplicate the primary first so it becomes the new primary, then the
        // remaining selected items in a stable order.
        const others = Array.from(allSelectedIds).filter((id) => id !== primaryId);
        const newPrimary = actions.duplicateItem(primaryId);
        const newExtras = others.map((id) => actions.duplicateItem(id));
        setSelectedItemId(newPrimary);
        setExtraSelectedIds(new Set(newExtras));
        return;
      }
      const newId = actions.duplicateItem(primaryId);
      setSelectedItemId(newId);
      // Clear stale extras so the selection is only the fresh copy.
      setExtraSelectedIds(new Set());
    },
    [actions, allSelectedIds]
  );

  const history = useHistory(layout, useCallback(
    (snapshot: RoomLayout) => {
      actions.applyLayout(snapshot);
    },
    [actions]
  ));

  const { lastSavedAt, saving: isSaving, saveError, remoteLayout, clearRemoteLayout } = useLayoutPersistence({
    layout,
    onHydrate: useCallback(
      (saved: RoomLayout) => {
        actions.applyLayout(saved);
        clearTransientSelection();
        history.clear();
      },
      [actions, history, clearTransientSelection]
    ),
  });

  // Adopt the snapshot another tab saved (#123). Deliberately a plain
  // applyLayout, not the hydrate path: it lands as a normal history entry, so
  // switching to the other tab's version is one Ctrl+Z away from being undone.
  const adoptRemoteLayout = useCallback(() => {
    if (!remoteLayout) return;
    snapshotBeforeReplace(layout);
    actions.applyLayout(remoteLayout);
    clearTransientSelection();
    clearRemoteLayout();
  }, [remoteLayout, layout, actions, clearTransientSelection, clearRemoteLayout]);

  const selectedItem = useMemo(
    () => (selectedItemId ? activeFloor.items.find((item) => item.id === selectedItemId) ?? null : null),
    [activeFloor.items, selectedItemId]
  );

  const hasSignalItems = useMemo(
    () => activeFloor.items.some((item) => item.isWiFiAccessPoint || item.isCCTV),
    [activeFloor.items]
  );

  const buildingCost = useMemo(
    () => totalCost(layout.floors.flatMap((floor) => floor.items)),
    [layout.floors]
  );

  const { snapPosition, getDragPlaneY, placeCatalogItem } = useItemPlacement({
    activeFloor,
    activeFloorY,
    roomWidth: layout.width,
    roomDepth: layout.height,
    buildingCost,
    actions,
    view,
  });

  const deselectAll = useCallback(() => selectOnly(null), [selectOnly]);

  // Keyboard placement (#168): Enter on a catalog tile places through the
  // wrapped `placeCatalogItem` and keeps the item unlocked until Enter/Escape.
  const {
    placingId,
    placeCatalogItem: placeFromCatalog,
    confirmPlacement,
    cancelPlacement,
  } = useKeyboardPlacement({ layout, selectedItemId, actions, history, selectOnly, placeCatalogItem });

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
      onItemSelect: handleSelect,
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

  useWalkthrough({
    enabled: isReady && walkthroughActive,
    invalidate,
    canvasRef,
    threeModuleRef,
    cameraRef,
    orbitRef: controlsRef,
    // Eye level, ducking under a low ceiling (a 1.1 m loft, #277).
    eyeHeight: activeFloorY + Math.min(1.6, activeStoreyHeight - 0.2),
    roomWidth: layout.width,
    roomDepth: layout.height,
    items: activeFloor.items,
    ...(activeFloor.interiorWalls ? { interiorWalls: activeFloor.interiorWalls } : {}),
    onExit: useCallback(() => {
      setView((v) => (v.walkthroughMode ? { ...v, walkthroughMode: false } : v));
      setGameMode((mode) => (mode === 'live' ? 'build' : mode));
    }, []),
  });

  // people.glb is fetched only once a person is placed or the walkers are on.
  const layoutHasPeople = useMemo(
    () => layout.floors.some((floor) => floor.items.some((item) => item.type === 'person')),
    [layout.floors]
  );
  const peopleModelReady = usePeopleModel(threeModuleRef, isReady, layoutHasPeople || view.showNpcs);

  useSceneEffects({
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
    view,
    selectedItemId,
    extraSelectedIds,
    highlightedIds,
    selectedWall,
    wallDraft,
    wallSnapResult,
    measurementPoints,
  });

  useNpcs({
    enabled: isReady && view.showNpcs && !view.view2D,
    invalidate,
    requestShadowUpdate,
    threeModuleRef,
    sceneRef,
    roomWidth: layout.width,
    roomDepth: layout.height,
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
  });

  const { applyPreset, focusOn, fitToRoom } = useCameraPresets({
    cameraRef,
    controlsRef,
    invalidate,
    roomSize: Math.max(layout.width, layout.height),
    buildingHeight: buildingHeight(layout.floors),
  });

  const { handleScreenshot, handleExportGlb, handleShareLink, handleImport } = useImportExport({
    layout,
    actions,
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
  }, [autoCycleLighting]);

  // Achievement unlocks ping the success chime.
  useEffect(() => {
    if (pendingAchievements.length > 0) playCue('success');
  }, [pendingAchievements, playCue]);

  // Reset measurements whenever the user exits the mode.
  useEffect(() => {
    if (!view.measurementMode) setMeasurementPoints([]);
  }, [view.measurementMode]);

  const toggle = useCallback(<K extends keyof ViewSettings>(key: K) => {
    setView((previous) => ({ ...previous, [key]: !previous[key] }));
  }, []);

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
    });
    if (built.length === 0) return false;
    actions.addItems(built);
    selectOnly(built[0]!.id);
    if (built.length > 1) {
      setExtraSelectedIds(new Set(built.slice(1).map((item) => item.id)));
    }
    playCue('place');
    return true;
  }, [layout.width, layout.height, activeFloor.interiorWalls, actions, selectOnly, playCue]);

  const shortcutHandlers = useMemo(
    () => ({
      removeItem: (id: string) => {
        // A multi-select delete removes the unlocked members even when the
        // primary is locked; a single locked item can't be deleted from the
        // keyboard, matching 3D drag (#115).
        if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
          removeSelected();
          return;
        }
        const item = activeFloor.items.find((entry) => entry.id === id);
        if (!item?.locked) removeItem(id);
      },
      duplicateItem: duplicateSelected,
      copySelection: copySelectionToClipboard,
      pasteClipboard: pasteFromClipboard,
      rotateItem: rotateItemHandler,
      rotateItemBy: (id: string, radians: number) => {
        if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
          const unlocked = unlockedSelectedIds();
          if (unlocked.size > 0) actions.rotateSelection(unlocked, radians);
          return;
        }
        const item = activeFloor.items.find((entry) => entry.id === id);
        if (!item || item.locked) return;
        const next = ((item.rotation ?? 0) + radians) % (Math.PI * 2);
        actions.setRotation(id, next);
        reseatCamera(id, next);
      },
      moveItem: (id: string, x: number, z: number) => {
        // Arrow nudges settle wall-mounted items back onto their wall the way
        // drag release does — a nudged door slides along its wall instead of
        // translating into the room as a free slab (#116).
        const item = activeFloor.items.find((entry) => entry.id === id);
        const settled = item
          ? settleWallMountedItem(item, { x, z }, layout.width, layout.height, activeFloor.interiorWalls ?? [])
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
    }),
    [
      placingId,
      confirmPlacement,
      cancelPlacement,
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
      toggle,
      history.undo,
      history.redo,
      selectedItem,
      focusOn,
      rotateItemHandler,
      reseatCamera,
      wallDraft,
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



  const roomEditorValue = useMemo<RoomEditorContextValue>(
    () => ({
      layout,
      activeFloor,
      activeFloorIndex,
      actions,
      view,
      setView,
      toggle,
      collidingIds,
      highlightedIds,
      catalogQuery,
      setCatalogQuery,
      recentColors,
      pushColor,
      playCue,
      history,
      isReady,
      error,
      gameMode,
      setGameMode,
      autoCycleLighting,
      setAutoCycleLighting,
    }),
    [
      layout, activeFloor, activeFloorIndex, actions,
      view, setView, toggle,
      collidingIds, highlightedIds, catalogQuery, setCatalogQuery,
      recentColors, pushColor, playCue,
      history, isReady, error,
      gameMode, setGameMode, autoCycleLighting, setAutoCycleLighting,
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
        walkthroughActive={walkthroughActive}
        measurementDistance={measurementDistance(measurementPoints)}
        measurementPointsPlaced={view.measurementMode ? measurementPoints.length : 0}
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
          const newId = placeCatalogItem(item, world ?? undefined);
          if (!newId) return;
          selectOnly(newId);
        }}
      />

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
        <div
          className="pc-glass pc-glass--dark"
          style={{ padding: '8px 12px', pointerEvents: 'auto' }}
        >
          <HeaderStats
            lastSavedAt={lastSavedAt}
            saving={isSaving}
            saveError={saveError}
            remoteChange={remoteLayout !== null}
            onAdoptRemote={adoptRemoteLayout}
            onDismissRemote={clearRemoteLayout}
          />
        </div>
      </div>

      {/* Top-right: floor pill + wall display */}
      <div
        className="pc-top-right"
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
            keepOut
          )}
          onRotate={(id: string) => {
            if (rotateItemHandler(id)) playCue('rotate');
          }}
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
        onOrbit={(direction) => {
          const THREE = threeModuleRef.current;
          const camera = cameraRef.current;
          const controls = controlsRef.current;
          if (THREE && camera && controls)
            orbitCamera(THREE, camera, controls, direction);
        }}
        onZoom={(direction) => {
          const camera = cameraRef.current;
          const controls = controlsRef.current;
          if (camera && controls) zoomCamera(camera, controls, direction);
        }}
        onFit={fitToRoom}
        placeCatalogItem={placeFromCatalog}
      />

      {/* Touch mode toggle — visible on mobile only */}
      <TouchModeToggle controlsRef={controlsRef} isReady={isReady} onFit={fitToRoom} />

      {/* Welcome modal — auto-shows once, dismissible */}
      <WelcomeBanner />

      {/* Keyboard-placement key hint (#168) */}
      <PlacementHint active={placingId !== null} />

      {/* Achievement toast */}
      <AchievementToast
        pending={pendingAchievements}
        onDismiss={dismissAchievements}
      />

      <SidebarDrawer
        collapsed={sidebarCollapsed}
        onCollapse={() => setSidebarCollapsed(true)}
        unlockedAchievements={unlockedAchievements}
        onApplyPreset={applyPreset}
        onFitToRoom={fitToRoom}
        onScreenshot={handleScreenshot}
        onImport={handleImport}
        onExportGlb={handleExportGlb}
        onShareLink={handleShareLink}
        placeCatalogItem={placeFromCatalog}
        removeItem={removeItem}
      />
    </div>
    </SelectionProvider>
    </RoomEditorProvider>
  );
}

export default RoomOrganizer;
