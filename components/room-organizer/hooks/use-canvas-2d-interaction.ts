import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { canvasToWorld, get2DViewTransform, render2DTopDown } from '../canvas-2d/render';
import { hasCollisions } from '../lib/geometry';
import type { FloorLayout, FurnitureItem, RoomLayout, ViewSettings } from '../lib/types';

// Matches the 3D canvas's click-vs-drag radius (three/drag-handlers.ts).
const DRAG_THRESHOLD_PX = 4;

/**
 * Topmost item under a world-space point, by exact rotated-rect containment.
 * "Topmost" is the last hit in draw order — `render2DTopDown` paints
 * `floor.items` in array order, so later items overdraw earlier ones.
 */
export function hitTest2DItems(
  items: readonly FurnitureItem[],
  worldX: number,
  worldZ: number
): FurnitureItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (!item.position) continue;
    const dx = worldX - item.position.x;
    const dz = worldZ - item.position.z;
    const rotation = item.rotation ?? 0;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    // Project the delta onto the item's oriented axes. Three's rotateY maps
    // local +X to (cos, −sin) in world XZ (see lib/geometry's OBB axes), so
    // the width axis is (cos, −sin) and the depth axis is (sin, cos).
    const alongWidth = dx * cos - dz * sin;
    const alongDepth = dx * sin + dz * cos;
    if (Math.abs(alongWidth) <= item.width / 2 && Math.abs(alongDepth) <= item.depth / 2) {
      return item;
    }
  }
  return null;
}

export interface UseCanvas2DInteractionParams {
  /** Only the visible 2D view listens; the hidden canvas gets no handlers. */
  enabled: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  layout: RoomLayout;
  activeFloor: FloorLayout;
  view: Pick<ViewSettings, 'showMeasurements' | 'showWiFiSignals' | 'showHeatmap'>;
  selectedItemId: string | null;
  extraSelectedIds: ReadonlySet<string>;
  allSelectedIds: ReadonlySet<string>;
  /** 'single' is Alt+click: one member of a group on its own (#154). */
  onItemSelect(id: string, mode: 'replace' | 'toggle' | 'single'): void;
  /** Pointer went down on empty plan space — clear the selection (#219). */
  onDeselect(): void;
  /** The same snap pipeline the 3D drag applies per move (use-item-placement). */
  snapPosition(id: string, x: number, z: number): { x: number; z: number };
  onItemDragStart(id: string): void;
  onItemDrag(id: string, x: number, z: number): void;
  onItemDragEnd(id: string): void;
  onItemDragCancel(id: string): void;
}

export interface UseCanvas2DInteractionResult {
  /** Client coords → world x/z via the renderer's inverse transform, or null off-canvas. */
  clientToWorld2D(clientX: number, clientY: number): { x: number; z: number } | null;
}

/**
 * Pointer interaction for the 2D floor plan (#219): click-to-select
 * (ctrl/meta toggles, matching the 3D canvas), empty-click deselect, and
 * drag-to-move re-using use-item-drag's session — state is dispatched once on
 * release, so undo, locking, wall settling and the keyboard `isDragActive`
 * gate all behave exactly like a 3D drag.
 *
 * Repaint during a drag: the committed React state doesn't change until
 * release, so the hook repaints the plan itself, once per animation frame, by
 * calling `render2DTopDown` with the session's in-flight positions overlaid
 * on the floor's items. A 2D canvas is immediate-mode — a full repaint IS the
 * paint path (the effect in use-scene-effects does the same) — so this is the
 * lightweight "ghost" repaint: no state dispatch, no 3D scene rebuild, no
 * touching the paint effect's dpr/resize plumbing (it already sized the
 * backing store).
 */
export function useCanvas2DInteraction(
  params: UseCanvas2DInteractionParams
): UseCanvas2DInteractionResult {
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const clientToWorld2D = useCallback((clientX: number, clientY: number) => {
    const canvas = paramsRef.current.canvasRef.current;
    if (!canvas) return null;
    const { layout } = paramsRef.current;
    const transform = get2DViewTransform(canvas.clientWidth, canvas.clientHeight, layout);
    if (!Number.isFinite(transform.scale) || transform.scale <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    return canvasToWorld(clientX - rect.left, clientY - rect.top, transform, layout);
  }, []);

  useEffect(() => {
    if (!params.enabled) return undefined;
    const canvas = params.canvasRef.current;
    if (!canvas) return undefined;

    interface Gesture {
      pointerId: number;
      itemId: string;
      downClientX: number;
      downClientY: number;
      /** True once the pointer crossed DRAG_THRESHOLD_PX and the session opened. */
      started: boolean;
      /** Overlay members' start positions — mirrors use-item-drag's session. */
      origins: Map<string, { x: number; z: number }>;
      /** In-flight positions for the ghost repaint. */
      latest: Map<string, { x: number; z: number }>;
    }
    let gesture: Gesture | null = null;
    let rafId: number | null = null;

    const paintGhost = (): void => {
      rafId = null;
      if (!gesture?.started) return;
      const { layout, activeFloor, view, selectedItemId, extraSelectedIds } = paramsRef.current;
      const session = gesture;
      const items = activeFloor.items.map((item) => {
        const moved = session.latest.get(item.id);
        return moved ? { ...item, position: moved } : item;
      });
      render2DTopDown({
        canvas,
        layout,
        floor: { ...activeFloor, items },
        selectedItemId,
        extraSelectedIds,
        showMeasurements: view.showMeasurements,
        showWiFiSignals: view.showWiFiSignals,
        showHeatmap: view.showHeatmap,
        hasCollision: (item) => hasCollisions(item, items, layout.width, layout.height),
      });
    };
    const schedulePaint = (): void => {
      if (rafId === null) rafId = requestAnimationFrame(paintGhost);
    };

    const beginDrag = (event: PointerEvent): void => {
      const session = gesture;
      if (!session) return;
      const p = paramsRef.current;
      session.started = true;
      // Capture so moves/up keep flowing even off-canvas mid-drag.
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Capture can throw if the pointer is already gone; safe to ignore.
      }
      p.onItemDragStart(session.itemId);
      // Membership mirrors use-item-drag's session: the whole multi-select
      // when >1, with locked co-selected members left in place (#115).
      const ids = p.allSelectedIds.size > 1 ? p.allSelectedIds : new Set([session.itemId]);
      for (const id of ids) {
        const item = p.activeFloor.items.find((entry) => entry.id === id);
        if (!item?.position) continue;
        if (item.locked && id !== session.itemId) continue;
        session.origins.set(id, { x: item.position.x, z: item.position.z });
        session.latest.set(id, { x: item.position.x, z: item.position.z });
      }
    };

    const abortGesture = (): void => {
      const session = gesture;
      gesture = null;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (!session?.started) return;
      try {
        canvas.releasePointerCapture(session.pointerId);
      } catch {
        // Ignore if capture was never held or already released.
      }
      paramsRef.current.onItemDragCancel(session.itemId);
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || gesture !== null) return;
      const p = paramsRef.current;
      const world = clientToWorld2D(event.clientX, event.clientY);
      if (!world) return;
      const hit = hitTest2DItems(p.activeFloor.items, world.x, world.z);
      if (!hit) {
        p.onDeselect();
        return;
      }
      const mode = event.altKey ? 'single' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
      p.onItemSelect(hit.id, mode);
      // Locked items select but never drag; a toggle click is selection
      // surgery, not a move — both mirror the 3D canvas (drag-handlers).
      if (hit.locked === true || mode === 'toggle') return;
      gesture = {
        pointerId: event.pointerId,
        itemId: hit.id,
        downClientX: event.clientX,
        downClientY: event.clientY,
        started: false,
        origins: new Map(),
        latest: new Map(),
      };
    };

    const onPointerMove = (event: PointerEvent): void => {
      const session = gesture;
      if (!session || event.pointerId !== session.pointerId) return;
      if (!session.started) {
        const dx = event.clientX - session.downClientX;
        const dy = event.clientY - session.downClientY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        beginDrag(event);
      }
      const p = paramsRef.current;
      // The floor's item set can be replaced under a live drag (cross-tab
      // adopt, library load) — abort instead of committing stale positions
      // on release, matching the 3D orphan guard (#207 follow-up).
      if (!p.activeFloor.items.some((item) => item.id === session.itemId)) {
        abortGesture();
        return;
      }
      const world = clientToWorld2D(event.clientX, event.clientY);
      if (!world) return;
      const snapped = p.snapPosition(session.itemId, world.x, world.z);
      // Defers the state dispatch to release (use-item-drag's fast path).
      p.onItemDrag(session.itemId, snapped.x, snapped.z);
      const origin = session.origins.get(session.itemId);
      session.latest.set(session.itemId, snapped);
      if (origin) {
        const dx = snapped.x - origin.x;
        const dz = snapped.z - origin.z;
        for (const [id, memberOrigin] of session.origins) {
          if (id === session.itemId) continue;
          session.latest.set(id, { x: memberOrigin.x + dx, z: memberOrigin.z + dz });
        }
      }
      schedulePaint();
    };

    const endGesture = (event: PointerEvent): void => {
      const session = gesture;
      if (!session || event.pointerId !== session.pointerId) return;
      gesture = null;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      // A release inside the threshold was a select-only click (#65).
      if (!session.started) return;
      try {
        canvas.releasePointerCapture(session.pointerId);
      } catch {
        // Ignore if capture was never held or already released.
      }
      // Commits once, locks, settles wall-mounted items; the state change
      // re-runs the 2D paint effect for the final frame.
      paramsRef.current.onItemDragEnd(session.itemId);
    };

    const onPointerLeave = (): void => {
      // A started drag holds pointer capture and stays alive off-canvas;
      // only an armed-but-unstarted gesture is abandoned here.
      if (gesture && !gesture.started) gesture = null;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endGesture);
    canvas.addEventListener('pointercancel', endGesture);
    canvas.addEventListener('pointerleave', onPointerLeave);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endGesture);
      canvas.removeEventListener('pointercancel', endGesture);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      // Disabled (view switch) or unmounted mid-drag: discard the session so
      // nothing stale is committed on a later pointerup.
      abortGesture();
    };
  }, [params.enabled, params.canvasRef, clientToWorld2D]);

  return { clientToWorld2D };
}
