import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

type ThreeModule = typeof import('three');

export interface HoverInfo {
  id: string;
  clientX: number;
  clientY: number;
}

export type SelectionMode = 'replace' | 'toggle';

/**
 * The React-side callbacks the canvas event handlers feed into. Read through a
 * `{ current }` box so the latest render's closures are always used without
 * re-attaching DOM listeners.
 */
export interface SceneEventHandlers {
  /**
   * When true, first-person walkthrough owns the canvas (PointerLockControls).
   * Select / drag / hover must no-op so the lock-engaging click doesn't select
   * furniture, open a popover or start a zero-distance drag (see #67).
   */
  walkthroughActive?: boolean;
  onItemSelect: (id: string, mode: SelectionMode) => void;
  onItemDragStart?: (id: string) => void;
  onItemDrag: (id: string, x: number, z: number) => void;
  onItemDragEnd?: (id: string) => void;
  onItemHover?: (info: HoverInfo | null) => void;
  onEmptyClick?: (x: number, z: number) => void;
  onWallSelect?: (info: { wallId: string; kind: 'exterior' | 'interior' }) => void;
  onFloorPointerMove?: (x: number, z: number) => void;
  onFloorPointerLeave?: () => void;
  snapPosition: (id: string, x: number, z: number) => { x: number; z: number };
  getDragPlaneY?: () => number;
}

export interface DragHandlersOptions {
  THREE: ThreeModule;
  canvas: HTMLCanvasElement;
  camera: ThreeNS.PerspectiveCamera;
  scene: ThreeNS.Scene;
  controls: OrbitControlsType;
  markDirty: () => void;
  /** Recompute the (static) shadow map — the dragged item is a shadow caster. */
  requestShadowUpdate?: () => void;
  handlersRef: { readonly current: SceneEventHandlers };
}

/**
 * `useSceneEffects` bumps this scene-level revision whenever it rebuilds the
 * furniture set, letting the raycast pre-filter cache below rebuild its list
 * only when the set actually changed — not on every pointermove.
 */
export const FURNITURE_REVISION_KEY = 'furnitureRevision';

// A pointerdown that never travels past this radius (in CSS pixels) is a click,
// not a drag: it selects the item without opening a drag session, so a plain
// tap/click never re-locks the item or writes an undo entry. Real drags cross
// the threshold and behave exactly as before.
const DRAG_THRESHOLD_PX = 4;

/**
 * Wires the canvas pointer events for select / drag / hover / wall-pick /
 * empty-click. Pointer events unify mouse, touch and pen — the same code path
 * drives desktop and touch. Pure Three.js + DOM — no React. Returns a cleanup
 * that removes every listener.
 */
export function attachDragHandlers({
  THREE,
  canvas,
  camera,
  scene,
  controls,
  markDirty,
  requestShadowUpdate,
  handlersRef,
}: DragHandlersOptions): () => void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const intersection = new THREE.Vector3();

  // Raycast pre-filter cache. `scene.children.filter(...)` allocated a fresh
  // array on every pointermove (hover) and every pointerdown. The furniture set
  // only changes on a rebuild, which bumps scene.userData[FURNITURE_REVISION_KEY];
  // rebuild the cached list lazily when that revision moves.
  let furnitureCache: ThreeNS.Object3D[] = [];
  let furnitureCacheRevision = Number.NaN;
  const furnitureList = (): ThreeNS.Object3D[] => {
    const revision = (scene.userData[FURNITURE_REVISION_KEY] as number | undefined) ?? 0;
    if (revision !== furnitureCacheRevision) {
      // Ghosted furniture on inactive floors (show-all-floors mode) is
      // scenery, not a pointer target: clicking it silently dropped the
      // current selection and the hover cursor reacted to it (#122).
      furnitureCache = scene.children.filter(
        (obj) => obj.userData.type === 'furniture' && obj.userData.ghostFloor !== true
      );
      furnitureCacheRevision = revision;
    }
    return furnitureCache;
  };

  // A "pending" drag is a pointerdown that landed on a movable item but hasn't
  // yet travelled past DRAG_THRESHOLD_PX. Until it does, no drag session is
  // opened (see #65) — a release while still pending is a select-only click.
  let dragTarget: ThreeNS.Object3D | null = null;
  let dragStarted = false;
  let activePointerId: number | null = null;
  let downClientX = 0;
  let downClientY = 0;

  const setPointerFromEvent = (event: { clientX: number; clientY: number }): void => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  const resetDragState = (): void => {
    dragTarget = null;
    dragStarted = false;
    activePointerId = null;
  };

  const beginDragSession = (event: PointerEvent): void => {
    if (!dragTarget) return;
    dragStarted = true;
    // Take pointer capture so moves/up keep flowing to us even if the pointer
    // slides off the canvas mid-drag (important for touch), and stop
    // OrbitControls from panning/rotating the camera under the drag.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture can throw if the pointer is already gone; safe to ignore.
    }
    controls.enabled = false;
    handlersRef.current.onItemDragStart?.(dragTarget.userData.id as string);
  };

  const onPointerDown = (event: PointerEvent): void => {
    // In walkthrough mode the canvas click only engages pointer lock — it must
    // not select furniture, open a popover or start a drag (see #67).
    if (handlersRef.current.walkthroughActive) return;
    // Only track a single primary pointer at a time. A second finger arriving
    // mid-gesture is ignored here so it can drive OrbitControls' pinch.
    if (activePointerId !== null) return;

    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    const furniture = furnitureList();
    const hits = raycaster.intersectObjects(furniture, true);
    if (hits.length === 0) {
      // Walls get a chance to claim the click before we fall through to the
      // floor's onEmptyClick handler. Required for "pick a wall to
      // paint it" interaction.
      if (handlersRef.current.onWallSelect) {
        const wallObjects = scene.children.filter(
          (obj) =>
            obj.userData.type === 'wall' || obj.userData.type === 'interior-wall'
        );
        const wallHits = raycaster.intersectObjects(wallObjects, false);
        const wallHit = wallHits.find((h) => h.object.visible);
        if (wallHit) {
          const id = wallHit.object.userData.wallId as string | undefined;
          if (id) {
            handlersRef.current.onWallSelect({
              wallId: id,
              kind: wallHit.object.userData.type === 'interior-wall'
                ? 'interior'
                : 'exterior',
            });
            return;
          }
        }
      }
      if (handlersRef.current.onEmptyClick) {
        dragPlane.constant = -(handlersRef.current.getDragPlaneY?.() ?? 0);
        if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
          handlersRef.current.onEmptyClick(intersection.x, intersection.z);
        }
      }
      return;
    }

    const target = ascendToFurniture(hits[0]?.object);
    if (!target) return;

    const mode: SelectionMode = event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
    const itemId = target.userData.id as string;
    handlersRef.current.onItemSelect(itemId, mode);

    if (target.userData.locked === true || mode === 'toggle') return;

    // Arm a potential drag, but don't open the session yet: the drag only
    // begins once the pointer travels past DRAG_THRESHOLD_PX (see onPointerMove).
    dragTarget = target;
    dragStarted = false;
    activePointerId = event.pointerId;
    downClientX = event.clientX;
    downClientY = event.clientY;
  };

  let lastHoverId: string | null = null;
  const updateHover = (event: PointerEvent): void => {
    // No hover affordance while walkthrough owns the camera (see #67).
    if (handlersRef.current.walkthroughActive) return;
    const hoverCallback = handlersRef.current.onItemHover;
    if (!hoverCallback) return;
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    const furniture = furnitureList();
    const hits = raycaster.intersectObjects(furniture, true);
    const target = ascendToFurniture(hits[0]?.object);
    const id = target ? (target.userData.id as string) : null;

    // Only notify on hover changes — a fresh payload per move would
    // re-render React for every pixel of travel. The tooltip anchors at the
    // point where the hover began.
    if (id === lastHoverId) return;
    lastHoverId = id;
    canvas.style.cursor = id ? 'pointer' : '';
    hoverCallback(id ? { id, clientX: event.clientX, clientY: event.clientY } : null);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragTarget) {
      // Hover + tooltip is a mouse/pen affordance only. Skipping it for touch
      // avoids per-frame React re-renders while a finger drags.
      if (event.pointerType !== 'touch') {
        updateHover(event);
      }
      if (handlersRef.current.onFloorPointerMove) {
        setPointerFromEvent(event);
        raycaster.setFromCamera(pointer, camera);
        dragPlane.constant = -(handlersRef.current.getDragPlaneY?.() ?? 0);
        if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
          handlersRef.current.onFloorPointerMove(intersection.x, intersection.z);
        }
      }
      return;
    }

    // A drag is armed on this item but the session hasn't opened yet: wait for
    // the pointer to travel past the threshold before treating it as a drag.
    if (!dragStarted) {
      if (event.pointerId !== activePointerId) return;
      const dx = event.clientX - downClientX;
      const dy = event.clientY - downClientY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      beginDragSession(event);
    }

    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    dragPlane.constant = -(handlersRef.current.getDragPlaneY?.() ?? 0);
    raycaster.ray.intersectPlane(dragPlane, intersection);

    const itemId = dragTarget.userData.id as string;
    const snapped = handlersRef.current.snapPosition(itemId, intersection.x, intersection.z);

    dragTarget.position.x = snapped.x;
    dragTarget.position.z = snapped.z;
    markDirty();
    // The item is a shadow caster; recompute the static shadow map so its cast
    // shadow tracks the drag instead of freezing at the drag-start position.
    requestShadowUpdate?.();
    handlersRef.current.onItemDrag(itemId, snapped.x, snapped.z);
  };

  const endGesture = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId && activePointerId !== null) return;
    const started = dragStarted;
    const target = dragTarget;
    if (activePointerId !== null) {
      try {
        canvas.releasePointerCapture(activePointerId);
      } catch {
        // Ignore if capture was never held or already released.
      }
    }
    resetDragState();
    if (!target) return;
    // A pointerup that never crossed the drag threshold was a select-only
    // click: no session was opened, so there is nothing to end (see #65).
    if (!started) return;
    controls.enabled = true;
    handlersRef.current.onItemDragEnd?.(target.userData.id as string);
  };

  const onPointerUp = (event: PointerEvent): void => {
    endGesture(event);
  };

  const onPointerCancel = (event: PointerEvent): void => {
    endGesture(event);
  };

  const onPointerLeave = (event: PointerEvent): void => {
    // Hover teardown is a mouse affordance; touch never sets hover state.
    if (event.pointerType !== 'touch') {
      handlersRef.current.onItemHover?.(null);
      lastHoverId = null;
      canvas.style.cursor = '';
    }
    handlersRef.current.onFloorPointerLeave?.();
    // If a real drag is under way we keep it alive: pointer capture routes the
    // remaining move/up events back to us even outside the canvas. Only a
    // still-armed (not yet started) drag is abandoned here.
    if (dragTarget && !dragStarted) {
      resetDragState();
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('pointerleave', onPointerLeave);
  };
}

function ascendToFurniture(node: ThreeNS.Object3D | undefined): ThreeNS.Object3D | null {
  let current: ThreeNS.Object3D | null = node ?? null;
  while (current && current.userData?.type !== 'furniture') {
    current = current.parent;
  }
  return current && current.userData?.type === 'furniture' ? current : null;
}
