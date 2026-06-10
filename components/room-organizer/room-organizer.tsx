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
import { useCameraVision } from './hooks/use-camera-vision';
import { useSceneEffects, measurementDistance } from './hooks/use-scene-effects';
import { useThreeScene } from './hooks/use-three-scene';
import { useWalkthrough } from './hooks/use-walkthrough';
import { CAMERA_BRACKET_ARM, GRID_SIZE_METERS } from './lib/constants';
import {
  snapToGrid as snapValueToGrid,
  snapToNeighbors,
  snapToWall as snapPositionToWall,
} from './lib/geometry';
import { isOpening, snapOpeningToWall, snapWallMountedItem, reseatWallMountedItem } from './lib/opening-snap';
import {
  downloadCanvasAsPng,
  downloadSceneAsGlb,
  readLayoutFromFile,
} from './lib/file-io';
import { hasCollisions } from './lib/geometry';
import { FURNITURE_CATALOG } from './lib/constants';
import type { CatalogItem, RoomLayout, ViewSettings, WallId } from './lib/types';
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
  showCameraVision: true,
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

  // useThreeScene is called further down (its options include the drag
  // callbacks below), so its scene ref and invalidate fn are late-bound
  // through these boxes for use in the fast-path helpers.
  const sceneBoxRef = useRef<React.MutableRefObject<import('three').Scene | null> | null>(null);
  const invalidateBoxRef = useRef<() => void>(() => {});

  // Drag fast-path. While a drag is in progress the Three.js groups are moved
  // directly and the single state dispatch is deferred to drag end —
  // dispatching per mousemove (the old behaviour) tore down and rebuilt every
  // furniture mesh on each pointer event. `origins` snapshots the selection's
  // starting positions for group drags; `latest` accumulates in-flight
  // positions and becomes one bulkSetPositions on release (which also gives
  // undo a single entry per gesture instead of one per mousemove).
  const dragSessionRef = useRef<{
    primaryId: string;
    origins: Map<string, { x: number; z: number }>;
    latest: Map<string, { x: number; z: number }>;
  } | null>(null);

  const findFurnitureGroup = useCallback(
    (itemId: string) =>
      sceneBoxRef.current?.current?.children.find(
        (obj) =>
          obj.userData.type === 'furniture' &&
          obj.userData.id === itemId &&
          obj.userData.floorIndex === activeFloorIndex
      ) ?? null,
    [activeFloorIndex]
  );

  // Live collision feedback during the fast-path: tint the dragged group's
  // emissive channel instead of rebuilding its meshes. Original emissive
  // values (lamp glow, TV screens) are stashed on material.userData and
  // restored on release.
  const setDragCollisionTint = useCallback((group: import('three').Object3D, colliding: boolean) => {
    group.traverse((node) => {
      const material = (node as import('three').Mesh).material;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      for (const mat of materials) {
        const std = mat as import('three').MeshStandardMaterial;
        if (!std.emissive) continue;
        if (colliding) {
          if (std.userData.dragTint === undefined) std.userData.dragTint = std.emissive.getHex();
          std.emissive.setHex(0x7f1d1d);
        } else if (std.userData.dragTint !== undefined) {
          std.emissive.setHex(std.userData.dragTint as number);
          delete std.userData.dragTint;
        }
      }
    });
  }, []);

  const handleDragStart = useCallback(
    (primaryId: string) => {
      const ids = allSelectedIds.size > 1 ? allSelectedIds : new Set([primaryId]);
      const origins = new Map<string, { x: number; z: number }>();
      for (const id of ids) {
        const item = activeFloor.items.find((entry) => entry.id === id);
        if (item?.position) origins.set(id, { x: item.position.x, z: item.position.z });
      }
      dragSessionRef.current = { primaryId, origins, latest: new Map(origins) };
    },
    [allSelectedIds, activeFloor.items]
  );

  const handleDrag = useCallback(
    (id: string, x: number, z: number) => {
      const session = dragSessionRef.current;
      if (!session || session.primaryId !== id) {
        // No drag session (programmatic move) — dispatch directly.
        actions.moveItem(id, x, z);
        return;
      }
      session.latest.set(id, { x, z });

      // Group drag: translate every other selected group by the same delta.
      // The primary group was already moved by the canvas drag handler.
      const primaryOrigin = session.origins.get(id);
      if (primaryOrigin && session.origins.size > 1) {
        const dx = x - primaryOrigin.x;
        const dz = z - primaryOrigin.z;
        for (const [otherId, origin] of session.origins) {
          if (otherId === id) continue;
          const next = { x: origin.x + dx, z: origin.z + dz };
          session.latest.set(otherId, next);
          const group = findFurnitureGroup(otherId);
          if (group) {
            group.position.x = next.x;
            group.position.z = next.z;
          }
        }
      }

      const candidateItems = activeFloor.items.map((item) => {
        const moved = session.latest.get(item.id);
        return moved ? { ...item, position: moved } : item;
      });
      const dragged = candidateItems.find((item) => item.id === id);
      const primaryGroup = findFurnitureGroup(id);
      if (dragged && primaryGroup) {
        setDragCollisionTint(primaryGroup, hasCollisions(dragged, candidateItems, layout.width, layout.height));
      }
      invalidateBoxRef.current();
    },
    [actions, activeFloor.items, layout.width, layout.height, findFurnitureGroup, setDragCollisionTint]
  );

  const handleDragEnd = useCallback(
    (id: string) => {
      const session = dragSessionRef.current;
      dragSessionRef.current = null;
      const finalPos = session?.latest.get(id);
      if (session && finalPos) {
        const primaryGroup = findFurnitureGroup(id);
        if (primaryGroup) setDragCollisionTint(primaryGroup, false);
        // Single dispatch for the whole gesture; the rebuild effect runs once.
        actions.bulkSetPositions(session.latest);
      }
      // Lock the item after positioning so it can't be accidentally moved.
      actions.setLocked(id, true);
      // On release, click a security camera onto the nearest wall and turn it to
      // face into the room. Doing this on drop (not per drag frame) keeps the
      // drag itself smooth instead of flipping between walls. Note: read the
      // position from the drag session — state is one dispatch behind here.
      const item = activeFloor.items.find((entry) => entry.id === id);
      const releasePos = finalPos ?? item?.position;
      if (item?.type === 'security-camera' && releasePos) {
        const snapped = snapWallMountedItem({
          position: releasePos,
          itemWidth: item.width,
          itemDepth: item.depth,
          roomWidth: layout.width,
          roomDepth: layout.height,
          interiorWalls: activeFloor.interiorWalls ?? [],
        });
        // Record the wall's inward-normal yaw so rotation can be locked to the
        // in/out axis, then re-seat for the camera's current mount style.
        actions.updateItem(id, { wallRotation: snapped.rotation });
        if (item.cameraBracket) {
          const pos = reseatWallMountedItem({
            position: releasePos,
            itemWidth: item.width,
            itemDepth: item.depth,
            roomWidth: layout.width,
            roomDepth: layout.height,
            interiorWalls: activeFloor.interiorWalls ?? [],
            rotation: item.rotation ?? snapped.rotation,
            bracketArm: CAMERA_BRACKET_ARM,
          });
          actions.moveItem(id, pos.x, pos.z);
        } else {
          actions.moveItem(id, snapped.position.x, snapped.position.z);
          if (Math.abs((item.rotation ?? 0) - snapped.rotation) > 1e-3) {
            actions.setRotation(id, snapped.rotation);
          }
        }
      }
    },
    [activeFloor.items, activeFloor.interiorWalls, layout.width, layout.height, actions, findFurnitureGroup, setDragCollisionTint]
  );

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
    [activeFloor.items, activeFloor.interiorWalls, layout.width, layout.height, actions, findFurnitureGroup, setDragCollisionTint]
  );

  const rotateItemHandler = useCallback(
    (id: string) => {
      if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
        actions.rotateSelection(allSelectedIds, Math.PI / 2);
        return;
      }
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (item?.type === 'security-camera') {
        // A flush camera can only face into the room or straight out, so Rotate
        // flips 180° along its wall's in/out axis. A bracketed camera pans freely.
        const step = item.cameraBracket ? Math.PI / 2 : Math.PI;
        const next = ((item.rotation ?? 0) + step) % (Math.PI * 2);
        actions.setRotation(id, next);
        reseatCamera(id, next);
        return;
      }
      const next = ((item?.rotation ?? 0) + Math.PI / 2) % (Math.PI * 2);
      actions.setRotation(id, next);
    },
    [allSelectedIds, activeFloor.items, actions, reseatCamera]
  );

  // Toggle a camera's stand-off bracket. Enabling it keeps the current facing
  // and lifts the camera onto the arm; disabling it snaps the camera back flush
  // and re-locks facing to the wall's inward normal.
  const toggleCameraBracket = useCallback(
    (id: string) => {
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (item?.type !== 'security-camera') return;
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

      // Security cameras follow the cursor freely while dragging (no per-frame
      // wall-snap — that made them teleport/flip between walls). They snap onto
      // the nearest wall and orient into the room on release, in handleDragEnd.

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
      if (catalogItem.type === 'security-camera') {
        const snapped = snapWallMountedItem({
          position: position ?? { x: 0, z: 0 },
          itemWidth: catalogItem.width,
          itemDepth: catalogItem.depth,
          roomWidth: layout.width,
          roomDepth: layout.height,
          interiorWalls: activeFloor.interiorWalls ?? [],
        });
        const id = actions.addCatalogItem(catalogItem, snapped.position);
        actions.setRotation(id, snapped.rotation);
        actions.updateItem(id, { wallRotation: snapped.rotation });
        return id;
      }
      // Outdoor items belong outside the building — default them just past
      // the south wall instead of the room centre when no position is given.
      if (catalogItem.category === 'outdoor' && !position) {
        const outsidePos = { x: 0, z: layout.height / 2 + catalogItem.depth / 2 + 0.5 };
        return actions.addCatalogItem(catalogItem, outsidePos);
      }
      return actions.addCatalogItem(catalogItem, position);
    },
    [actions, activeFloor.interiorWalls, layout.width, layout.height]
  );

  const { isReady, error, invalidate, threeModuleRef, sceneRef, rendererRef, cameraRef, controlsRef, worldPositionFromClient } =
    useThreeScene({
      canvasRef,
      onItemSelect: handleSelect,
      onItemDragStart: handleDragStart,
      onItemDrag: handleDrag,
      onItemDragEnd: handleDragEnd,
      onItemHover: setHover,
      onEmptyClick: handleEmptyClick,
      onWallSelect: ({ wallId, kind }) => {
        setSelectedWall({ id: wallId, kind });
      },
      onFloorPointerMove: handleFloorPointerMove,
      onFloorPointerLeave: handleFloorPointerLeave,
      snapPosition,
      getDragPlaneY,
    });

  sceneBoxRef.current = sceneRef;
  invalidateBoxRef.current = invalidate;

  useWalkthrough({
    enabled: isReady && view.walkthroughMode && !view.view2D,
    invalidate,
    canvasRef,
    threeModuleRef,
    cameraRef,
    orbitRef: controlsRef,
    eyeHeight: activeFloorY + 1.6,
  });

  useSceneEffects({
    isReady,
    invalidate,
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
    threeModuleRef,
    sceneRef,
    roomWidth: layout.width,
    roomDepth: layout.height,
    floorY: activeFloorY,
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
    buildingHeight: layout.floors.length * FLOOR_HEIGHT_METERS,
  });

  const handleScreenshot = useCallback(() => {
    const canvas = view.view2D ? canvas2DRef.current : canvasRef.current;
    if (!canvas) return;
    // The renderer runs without preserveDrawingBuffer, so render a fresh
    // frame synchronously — the buffer is valid within the same task.
    if (!view.view2D && rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
    downloadCanvasAsPng(canvas, layout.name || 'room-layout');
  }, [view.view2D, layout.name, rendererRef, sceneRef, cameraRef]);

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
      rotateItem: rotateItemHandler,
      rotateItemBy: (id: string, radians: number) => {
        if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
          actions.rotateSelection(allSelectedIds, radians);
          return;
        }
        const item = activeFloor.items.find((entry) => entry.id === id);
        if (!item) return;
        const next = ((item.rotation ?? 0) + radians) % (Math.PI * 2);
        actions.setRotation(id, next);
        reseatCamera(id, next);
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
      removeInteriorWall: (id: string) => {
        actions.removeInteriorWall(id);
        setSelectedWall(null);
      },
      // Keep the selection (and the auto-opened paint panel) after hiding an
      // exterior wall so the Wall Visibility toggles stay reachable to restore it.
      toggleExteriorWall: (id: string) => {
        actions.toggleExteriorWall(id as WallId);
      },
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
      rotateItemHandler,
      reseatCamera,
    ]
  );

  useKeyboardShortcuts({
    selectedItem,
    selectedWall,
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
            rotateItemHandler(id);
            playCue('rotate');
          }}
          onToggleCameraBracket={toggleCameraBracket}
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
        placeCatalogItem={placeCatalogItem}
      />
    </div>
    </SelectionProvider>
    </RoomEditorProvider>
  );
}

export default RoomOrganizer;
