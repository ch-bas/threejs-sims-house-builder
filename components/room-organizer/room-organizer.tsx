'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HoverInfo } from './hooks/use-three-scene';
import { useCameraPresets } from './hooks/use-camera-presets';
import { useAchievements } from './hooks/use-achievements';
import { useHistory } from './hooks/use-history';
import { useRecentColors } from './hooks/use-recent-colors';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';
import { useLayoutPersistence } from './hooks/use-layout-persistence';
import { useLayoutState } from './hooks/use-layout-state';
import { useNpcs } from './hooks/use-npcs';
import { useSceneEffects, measurementDistance } from './hooks/use-scene-effects';
import { useThreeScene } from './hooks/use-three-scene';
import { useWalkthrough } from './hooks/use-walkthrough';
import { GRID_SIZE_METERS } from './lib/constants';
import {
  snapToGrid as snapValueToGrid,
  snapToNeighbors,
  snapToWall as snapPositionToWall,
} from './lib/geometry';
import { isOpening, snapOpeningToWall } from './lib/opening-snap';
import {
  downloadCanvasAsPng,
  downloadSceneAsGlb,
  readLayoutFromFile,
} from './lib/file-io';
import { hasCollisions } from './lib/geometry';
import { FURNITURE_CATALOG } from './lib/constants';
import type { CatalogItem, RoomLayout, ViewSettings } from './lib/types';
import { BottomHud } from './panels/bottom-hud';
import { LotBadge } from './panels/lot-badge';
import { SidebarDrawer } from './panels/sidebar-drawer';
import { HeaderStats } from './panels/header-stats';
import { ItemContextPopover } from './panels/item-context-popover';
import { TouchModeToggle } from './panels/touch-mode-toggle';
import { WelcomeBanner } from './panels/welcome-banner';
import { FloorPill } from './panels/floor-pill';
import { WallDisplayPill } from './panels/wall-display-pill';
import type { GameMode } from './lib/types';
import { Viewport } from './panels/viewport';
import { snapWallEndpoint } from './lib/wall-snap';
import { encodeShareUrl, isShareUrlReasonablySized } from './lib/share';
import { playSound, type SoundCue } from './lib/sounds';
import { FLOOR_HEIGHT_METERS } from './lib/types';
import { RoomEditorProvider, type RoomEditorContextValue } from './contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from './contexts/selection-context';
import { AchievementToast } from './panels/achievement-toast';

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

function formatClock(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
  walkthroughMode: false,
  showOutdoor: true,
  showAllFloors: false,
  wallDisplay: 'cutaway',
  measurementMode: false,
  soundsEnabled: false,
  drawWallMode: false,
  showHeatmap: false,
  showItemLabels: false,
  showNpcs: false,
};

export function RoomOrganizer(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas2DRef = useRef<HTMLCanvasElement>(null);

  const { layout, activeFloor, activeFloorIndex, actions } = useLayoutState();
  const activeFloorY = activeFloorIndex * FLOOR_HEIGHT_METERS;
  const {
    unlocked: unlockedAchievements,
    pending: pendingAchievements,
    dismiss: dismissAchievements,
  } = useAchievements(layout);
  const { recent: recentColors, pushColor } = useRecentColors();
  const [view, setView] = useState<ViewSettings>(INITIAL_VIEW_SETTINGS);

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

  const collidingIds = useMemo(() => {
    const matches = new Set<string>();
    for (const item of activeFloor.items) {
      if (hasCollisions(item, activeFloor.items, layout.width, layout.height)) {
        matches.add(item.id);
      }
    }
    return matches;
  }, [activeFloor.items, layout.width, layout.height]);

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
    }
  }, [view.drawWallMode]);

  // Floor switch: drop any in-progress wall draft and selection (those live on
  // the previous floor) and slide the camera target up/down to the new floor.
  useEffect(() => {
    setWallDraft(null);
    setSelectedItemId(null);
    setSelectedWall(null);
    setExtraSelectedIds(new Set());
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const newTargetY = activeFloorIndex * FLOOR_HEIGHT_METERS + FLOOR_HEIGHT_METERS / 2;
    const dy = newTargetY - controls.target.y;
    if (Math.abs(dy) < 0.01) return;
    controls.target.y = newTargetY;
    camera.position.y += dy;
    controls.update();
    const renderer = rendererRef.current;
    if (renderer) renderer.render(sceneRef.current!, camera);
  }, [activeFloorIndex]);

  const handleSelect = useCallback((id: string, mode: 'replace' | 'toggle') => {
    if (mode === 'replace') {
      setSelectedItemId(id);
      setExtraSelectedIds(new Set());
      return;
    }
    setSelectedItemId((current) => {
      if (current === null) {
        return id;
      }
      if (current === id) return current;
      setExtraSelectedIds((extras) => {
        const next = new Set(extras);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return current;
    });
  }, []);

  const allSelectedIds = useMemo(() => {
    const set = new Set(extraSelectedIds);
    if (selectedItemId) set.add(selectedItemId);
    return set;
  }, [selectedItemId, extraSelectedIds]);

  // Per-drag snapshot of every selected item's starting position, used to
  // translate the whole selection by the same delta during a group drag.
  const dragOriginsRef = useRef<{ primaryId: string; positions: Map<string, { x: number; z: number }> } | null>(null);

  const handleDragStart = useCallback(
    (primaryId: string) => {
      if (allSelectedIds.size <= 1) {
        dragOriginsRef.current = null;
        return;
      }
      const positions = new Map<string, { x: number; z: number }>();
      for (const id of allSelectedIds) {
        const item = activeFloor.items.find((entry) => entry.id === id);
        if (item?.position) positions.set(id, { x: item.position.x, z: item.position.z });
      }
      dragOriginsRef.current = { primaryId, positions };
    },
    [allSelectedIds, activeFloor.items]
  );

  const handleDrag = useCallback(
    (id: string, x: number, z: number) => {
      const origins = dragOriginsRef.current;
      if (origins && origins.primaryId === id && origins.positions.size > 1) {
        const primaryOrigin = origins.positions.get(id);
        if (!primaryOrigin) {
          actions.moveItem(id, x, z);
          return;
        }
        const dx = x - primaryOrigin.x;
        const dz = z - primaryOrigin.z;
        const updates = new Map<string, { x: number; z: number }>();
        for (const [otherId, origin] of origins.positions) {
          updates.set(otherId, { x: origin.x + dx, z: origin.z + dz });
        }
        actions.bulkSetPositions(updates);
        return;
      }
      actions.moveItem(id, x, z);
    },
    [actions]
  );

  const handleDragEnd = useCallback(() => {
    dragOriginsRef.current = null;
  }, []);

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
    const ids = Array.from(allSelectedIds);
    if (ids.length === 0) return;
    const remaining = activeFloor.items.filter((item) => !allSelectedIds.has(item.id));
    actions.replaceItems(remaining);
    setSelectedItemId(null);
    setExtraSelectedIds(new Set());
  }, [actions, activeFloor.items, allSelectedIds]);

  const history = useHistory(layout, useCallback(
    (snapshot: RoomLayout) => {
      actions.applyLayout(snapshot);
    },
    [actions]
  ));

  const { lastSavedAt, saving: isSaving } = useLayoutPersistence({
    layout,
    onHydrate: useCallback(
      (saved: RoomLayout) => {
        actions.applyLayout(saved);
        setSelectedItemId(null);
        history.clear();
      },
      [actions, history]
    ),
  });

  const selectedItem = useMemo(
    () => (selectedItemId ? activeFloor.items.find((item) => item.id === selectedItemId) ?? null : null),
    [activeFloor.items, selectedItemId]
  );

  const hasSignalItems = useMemo(
    () => activeFloor.items.some((item) => item.isWiFiAccessPoint || item.isCCTV),
    [activeFloor.items]
  );

  const snapPosition = useCallback(
    (itemId: string, x: number, z: number) => {
      let result = { x, z };
      const item = activeFloor.items.find((entry) => entry.id === itemId);

      // Doors and windows have to live on a wall — there's no such thing as
      // a "free-floating" opening. Force-snap them regardless of the toggle.
      if (item && isOpening(item.type)) {
        const snapped = snapOpeningToWall({
          position: result,
          itemWidth: item.width,
          roomWidth: layout.width,
          roomDepth: layout.height,
          interiorWalls: activeFloor.interiorWalls ?? [],
        });
        return snapped.position;
      }

      if (view.snapToGrid) {
        result = {
          x: snapValueToGrid(result.x, GRID_SIZE_METERS),
          z: snapValueToGrid(result.z, GRID_SIZE_METERS),
        };
      }
      if (view.snapToItems && item) {
        result = snapToNeighbors({
          position: result,
          movingItem: item,
          otherItems: activeFloor.items,
        });
      }
      if (view.snapToWall && item) {
        result = snapPositionToWall({
          position: result,
          item,
          roomWidth: layout.width,
          roomDepth: layout.height,
        });
      }
      return result;
    },
    [
      view.snapToGrid,
      view.snapToWall,
      view.snapToItems,
      activeFloor.items,
      activeFloor.interiorWalls,
      layout.width,
      layout.height,
    ]
  );

  const getDragPlaneY = useCallback(() => activeFloorY, [activeFloorY]);

  /**
   * Add an item from the catalog. For doors and windows, the requested
   * position is force-snapped to the nearest wall (exterior or interior)
   * and a default rotation aligned with that wall is applied — these
   * openings only make sense embedded in a wall.
   */
  const placeCatalogItem = useCallback(
    (catalogItem: CatalogItem, position?: { x: number; z: number }) => {
      if (isOpening(catalogItem.type)) {
        const snapped = snapOpeningToWall({
          position: position ?? { x: 0, z: 0 },
          itemWidth: catalogItem.width,
          roomWidth: layout.width,
          roomDepth: layout.height,
          interiorWalls: activeFloor.interiorWalls ?? [],
        });
        const id = actions.addCatalogItem(catalogItem, snapped.position);
        actions.setRotation(id, snapped.rotation);
        return id;
      }
      return actions.addCatalogItem(catalogItem, position);
    },
    [actions, activeFloor.interiorWalls, layout.width, layout.height]
  );

  const { isReady, error, threeModuleRef, sceneRef, rendererRef, cameraRef, controlsRef, worldPositionFromClient } =
    useThreeScene({
      canvasRef,
      onItemSelect: handleSelect,
      onItemDragStart: handleDragStart,
      onItemDrag: handleDrag,
      onItemDragEnd: handleDragEnd,
      onItemHover: setHover,
      onEmptyClick: handleEmptyClick,
      onWallSelect: ({ wallId, kind }) => {
        if (!view.drawWallMode) return;
        setSelectedWall({ id: wallId, kind });
      },
      onFloorPointerMove: handleFloorPointerMove,
      onFloorPointerLeave: handleFloorPointerLeave,
      snapPosition,
      getDragPlaneY,
    });

  useWalkthrough({
    enabled: isReady && view.walkthroughMode && !view.view2D,
    canvasRef,
    threeModuleRef,
    cameraRef,
    orbitRef: controlsRef,
    eyeHeight: activeFloorY + 1.6,
  });

  useSceneEffects({
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
  });

  useNpcs({
    enabled: isReady && view.showNpcs && !view.view2D,
    threeModuleRef,
    sceneRef,
    roomWidth: layout.width,
    roomDepth: layout.height,
    floorY: activeFloorY,
  });

  const { applyPreset, focusOn, fitToRoom } = useCameraPresets({
    cameraRef,
    controlsRef,
    roomSize: Math.max(layout.width, layout.height),
    buildingHeight: layout.floors.length * FLOOR_HEIGHT_METERS,
  });

  const handleScreenshot = useCallback(() => {
    const canvas = view.view2D ? canvas2DRef.current : canvasRef.current;
    if (!canvas) return;
    downloadCanvasAsPng(canvas, layout.name || 'room-layout');
  }, [view.view2D, layout.name]);

  const handleExportGlb = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene) return;
    try {
      await downloadSceneAsGlb(scene, layout.name || 'room-layout');
    } catch (exportError) {
      window.alert(exportError instanceof Error ? exportError.message : 'GLB export failed.');
    }
  }, [sceneRef, layout.name]);

  const handleShareLink = useCallback(async () => {
    const origin = window.location.origin + window.location.pathname;
    const { url, strippedFloorPlan } = encodeShareUrl(layout, origin);

    if (!isShareUrlReasonablySized(url)) {
      window.alert(
        'This layout is too large to fit in a share link. Try exporting it as JSON and sharing the file instead.'
      );
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      const note = strippedFloorPlan
        ? '\n\n(The floor-plan image was removed from the link to keep it short.)'
        : '';
      window.alert(`Share link copied to clipboard.${note}`);
    } catch {
      window.prompt('Copy this share link:', url);
    }
  }, [layout]);

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

  const shortcutHandlers = useMemo(
    () => ({
      removeItem: (id: string) => {
        if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
          removeSelected();
        } else {
          removeItem(id);
        }
      },
      duplicateItem: (id: string) => {
        const newId = actions.duplicateItem(id);
        setSelectedItemId(newId);
      },
      rotateItem: (id: string) => {
        if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
          actions.rotateSelection(allSelectedIds, Math.PI / 2);
        } else {
          actions.rotateItem(id);
        }
      },
      rotateItemBy: (id: string, radians: number) => {
        if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
          actions.rotateSelection(allSelectedIds, radians);
          return;
        }
        const item = activeFloor.items.find((entry) => entry.id === id);
        if (!item) return;
        const next = ((item.rotation ?? 0) + radians) % (Math.PI * 2);
        actions.setRotation(id, next);
      },
      moveItem: actions.moveItem,
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
        if (selectedItem?.position) focusOn(selectedItem.position);
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
    }),
    [
      removeItem,
      removeSelected,
      allSelectedIds,
      actions,
      activeFloor.items,
      activeFloorIndex,
      layout.floors.length,
      toggle,
      history.undo,
      history.redo,
      selectedItem,
      focusOn,
    ]
  );

  useKeyboardShortcuts({
    selectedItem,
    hasSignalItems,
    handlers: shortcutHandlers,
  });

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const next = await readLayoutFromFile(file);
        actions.applyLayout(next);
        setSelectedItemId(null);
      } catch (importError) {
        const message =
          importError instanceof Error
            ? importError.message
            : 'Failed to import layout. Please check the file format.';
        window.alert(message);
      }
    },
    [actions]
  );


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
    }),
    [selectedItemId, setSelectedItemId, selectedItem, extraSelectedIds, setExtraSelectedIds, allSelectedIds]
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
        showMeasurements={view.showMeasurements}
        showMinimap={view.showMinimap}
        walkthroughActive={view.walkthroughMode && !view.view2D}
        measurementDistance={measurementDistance(measurementPoints)}
        measurementPointsPlaced={view.measurementMode ? measurementPoints.length : 0}
        wallDrawStatus={
          view.drawWallMode
            ? {
                hasAnchor: wallDraft !== null,
                snapKind: wallSnapResult?.kind,
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
        onCatalogDrop={(clientX, clientY, type) => {
          const item = FURNITURE_CATALOG.find((entry) => entry.type === type);
          if (!item) return;
          const world = worldPositionFromClient(clientX, clientY);
          const newId = placeCatalogItem(item, world ?? undefined);
          setSelectedItemId(newId);
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
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 30,
          maxWidth: 'calc(100vw - 480px)',
        }}
      >
        <div
          className="pc-glass pc-glass--dark"
          style={{ padding: '8px 12px' }}
        >
          <HeaderStats
            lastSavedAt={lastSavedAt}
            saving={isSaving}
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
            layout.height
          )}
          onRotate={(id: string) => {
            actions.rotateItem(id);
            playCue('rotate');
          }}
          onDuplicate={(id: string) => {
            const newId = actions.duplicateItem(id);
            setSelectedItemId(newId);
          }}
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
        placeCatalogItem={placeCatalogItem}
      />

      {/* Touch mode toggle — visible on mobile only */}
      <TouchModeToggle controlsRef={controlsRef} onFit={fitToRoom} />

      {/* Welcome modal — auto-shows once, dismissible */}
      <WelcomeBanner />

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
      />
    </div>
    </SelectionProvider>
    </RoomEditorProvider>
  );
}

export default RoomOrganizer;
