import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

type ThreeModule = typeof import('three');

export interface HoverInfo {
  id: string;
  clientX: number;
  clientY: number;
}

/**
 * 'replace' / 'toggle' select the clicked item's whole group when it has
 * one; 'single' (Alt+click) picks that one member on its own (#154).
 */
export type SelectionMode = 'replace' | 'toggle' | 'single';

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
  /**
   * Wall-draw mode: every press is a floor point for onEmptyClick — furniture
   * and walls don't claim it, and furniture shows no hover affordance (#349).
   */
  floorPickOnly?: boolean;
  onItemSelect: (id: string, mode: SelectionMode) => void;
  /**
   * The current selection. A plain press on a member of a multi-selection
   * keeps it so the drag moves the whole set; a release without a drag then
   * narrows to the pressed item, as file managers do (#291).
   */
  selectedIds?: ReadonlySet<string>;
  onItemDragStart?: (id: string) => void;
  onItemDrag: (id: string, x: number, z: number) => void;
  onItemDragEnd?: (id: string) => void;
  /**
   * The gesture was aborted without a commit — the furniture set was rebuilt
   * under the live drag (cross-tab adopt, library load) and the captured
   * group no longer exists (#207 follow-up), or the browser cancelled the
   * pointer (`restore`: move the groups back to where they started, #292).
   * The React side must discard its drag session so nothing is committed.
   */
  onItemDragCancel?: (id: string, options?: { restore?: boolean }) => void;
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
// tap/click never re-locks the item or writes an undo entry. Finger jitter
// routinely exceeds the mouse radius, so touch gets a wider one (#292).
const DRAG_THRESHOLD_PX = 4;
const TOUCH_DRAG_THRESHOLD_PX = 10;

/** Click-vs-drag radius for a pointer type — shared with the 2D plan. */
export function dragThresholdPx(pointerType: string): number {
  return pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
}

/**
 * Whether a press on `id` should keep the current selection instead of
 * selecting on pointerdown (#291): a plain press on a member of a
 * multi-selection. The narrowing click happens on release instead.
 */
export function keepsSelectionOnPress(
  mode: SelectionMode,
  id: string,
  selectedIds: ReadonlySet<string> | undefined
): boolean {
  return mode === 'replace' && selectedIds !== undefined && selectedIds.size > 1 && selectedIds.has(id);
}

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
  // three's default 1 m line threshold turns any line under a furniture group
  // into a metre-wide pick target (#333); lines are never meant to be picked.
  raycaster.params.Line.threshold = 0;
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
  let dragThreshold = DRAG_THRESHOLD_PX;
  // Item position minus the floor point under the press: added to every
  // move so the item keeps its place under the pointer (#292).
  let grabOffsetX = 0;
  let grabOffsetZ = 0;
  // The press kept a multi-selection (#291); a release without a drag
  // narrows it to the pressed item.
  let selectOnRelease = false;

  const setPointerFromEvent = (event: { clientX: number; clientY: number }): void => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  const resetDragState = (): void => {
    dragTarget = null;
    dragStarted = false;
    activePointerId = null;
    selectOnRelease = false;
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
    const floorPickOnly = handlersRef.current.floorPickOnly === true;
    const furniture = furnitureList();
    const hits = floorPickOnly ? [] : raycaster.intersectObjects(furniture, true);
    if (hits.length === 0) {
      // Walls get a chance to claim the click before we fall through to the
      // floor's onEmptyClick handler. Required for "pick a wall to
      // paint it" interaction.
      if (!floorPickOnly && handlersRef.current.onWallSelect) {
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

    const mode: SelectionMode = event.altKey
      ? 'single'
      : event.ctrlKey || event.metaKey
        ? 'toggle'
        : 'replace';
    const itemId = target.userData.id as string;
    const locked = target.userData.locked === true;
    const keepSelection = !locked && keepsSelectionOnPress(mode, itemId, handlersRef.current.selectedIds);
    if (!keepSelection) handlersRef.current.onItemSelect(itemId, mode);

    if (locked || mode === 'toggle') return;

    // Arm a potential drag, but don't open the session yet: the drag only
    // begins once the pointer travels past the threshold (see onPointerMove).
    dragTarget = target;
    dragStarted = false;
    activePointerId = event.pointerId;
    downClientX = event.clientX;
    downClientY = event.clientY;
    dragThreshold = dragThresholdPx(event.pointerType);
    selectOnRelease = keepSelection;
    grabOffsetX = 0;
    grabOffsetZ = 0;
    dragPlane.constant = -(handlersRef.current.getDragPlaneY?.() ?? 0);
    if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
      grabOffsetX = target.position.x - intersection.x;
      grabOffsetZ = target.position.z - intersection.z;
    }
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
    const hits = handlersRef.current.floorPickOnly ? [] : raycaster.intersectObjects(furniture, true);
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
      if (dx * dx + dy * dy < dragThreshold * dragThreshold) return;
      beginDragSession(event);
    }

    // The furniture set can be rebuilt under a live drag despite the keyboard
    // gate (#245): a cross-tab adopt, library load, or any other state-driven
    // rebuild disposes the captured group and detaches it from the scene.
    // Dragging it then paints nothing, while the release would still commit
    // the stale in-flight positions over the fresh state. A detached group
    // has no parent — abort the gesture; state is already authoritative.
    if (dragTarget.parent === null) {
      abortGesture(false);
      return;
    }

    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    dragPlane.constant = -(handlersRef.current.getDragPlaneY?.() ?? 0);
    // A ray at or above the horizon misses the plane — hold the last frame.
    if (!raycaster.ray.intersectPlane(dragPlane, intersection)) return;

    const itemId = dragTarget.userData.id as string;
    const snapped = handlersRef.current.snapPosition(
      itemId,
      intersection.x + grabOffsetX,
      intersection.z + grabOffsetZ
    );

    dragTarget.position.x = snapped.x;
    dragTarget.position.z = snapped.z;
    markDirty();
    // The item is a shadow caster; recompute the static shadow map so its cast
    // shadow tracks the drag instead of freezing at the drag-start position.
    requestShadowUpdate?.();
    handlersRef.current.onItemDrag(itemId, snapped.x, snapped.z);
  };

  // Like endGesture, but for a gesture that died under us: no commit — the
  // React side is told to throw its session away instead. `restore` moves
  // the dragged groups back (a pointercancel); a rebuilt set needs nothing.
  const abortGesture = (restore: boolean): void => {
    const target = dragTarget;
    const started = dragStarted;
    if (activePointerId !== null) {
      try {
        canvas.releasePointerCapture(activePointerId);
      } catch {
        // Ignore if capture was never held or already released.
      }
    }
    resetDragState();
    controls.enabled = true;
    if (!target || !started) return;
    handlersRef.current.onItemDragCancel?.(target.userData.id as string, { restore });
    if (restore) {
      markDirty();
      requestShadowUpdate?.();
    }
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
    const narrow = selectOnRelease;
    resetDragState();
    if (!target) return;
    // A pointerup that never crossed the drag threshold was a select-only
    // click: no session was opened, so there is nothing to end (see #65).
    // A press that kept a multi-selection selects the item now (#291).
    if (!started) {
      if (narrow) handlersRef.current.onItemSelect(target.userData.id as string, 'replace');
      return;
    }
    controls.enabled = true;
    handlersRef.current.onItemDragEnd?.(target.userData.id as string);
  };

  const onPointerUp = (event: PointerEvent): void => {
    endGesture(event);
  };

  // The browser took the pointer (OS gesture, palm rejection, a system
  // dialog): undo the drag rather than commit and lock it (#292).
  const onPointerCancel = (event: PointerEvent): void => {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    abortGesture(true);
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
