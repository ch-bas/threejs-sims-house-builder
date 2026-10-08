import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { canvasToWorld, get2DViewTransform, render2DTopDown } from '../canvas-2d/render';
import { requestZoneName } from '../lib/editor-notices';
import { floorKeepOut } from '../lib/floor-keep-out';
import { hasCollisions } from '../lib/geometry';
import { isWallMounted } from '../lib/opening-snap';
import { planDrawOrder } from '../lib/plan-order';
import { storeyHeight } from '../lib/storeys';
import { planFloorIndex } from '../lib/street';
import { defaultZoneName, nextZoneColor, zoneFromCorners } from '../lib/zones';
import { dragThresholdPx, keepsSelectionOnPress } from '../three/drag-handlers';
import { useLayoutActions } from './use-layout-store';
import type { DragCancelOptions } from './use-item-drag';
import type { FloorLayout, FurnitureItem, RoomLayout, ViewSettings } from '../lib/types';

/**
 * Extra hit margin (CSS px) around wall-mounted and very small items (#286):
 * a 0.2 m Wi-Fi puck or a 0.12 m-deep window is a 4–8 px target at typical
 * plan scales, so a click a few pixels off its edge should still land.
 */
export const HIT_SLOP_PX = 6;
/** Items whose shorter side is under this (m) get the slop. */
const SMALL_ITEM_MAX_SIDE_M = 0.3;

/**
 * Topmost item under a world-space point, by exact rotated-rect containment.
 * "Topmost" is the last hit in draw order — `render2DTopDown` paints
 * `planDrawOrder(floor.items)` (rugs → floor furniture → tabletop → wall,
 * #286), so this walks the same order in reverse: the sofa over a rug wins
 * the click, matching the 3D raycast. `slop` (world metres, typically
 * HIT_SLOP_PX / scale) widens the target of wall-mounted and sub-0.3 m
 * items only; large furniture keeps its exact footprint.
 */
export function hitTest2DItems(
  items: readonly FurnitureItem[],
  worldX: number,
  worldZ: number,
  slop = 0
): FurnitureItem | null {
  const ordered = planDrawOrder(items);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const item = ordered[i]!;
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
    const margin =
      isWallMounted(item.type) || Math.min(item.width, item.depth) < SMALL_ITEM_MAX_SIDE_M ? slop : 0;
    if (Math.abs(alongWidth) <= item.width / 2 + margin && Math.abs(alongDepth) <= item.depth / 2 + margin) {
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
  view: Pick<ViewSettings, 'showMeasurements' | 'showWiFiSignals' | 'showHeatmap' | 'drawZoneMode'>;
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
  onItemDragCancel(id: string, options?: DragCancelOptions): void;
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
 *
 * Zone drawing (#155): while `view.drawZoneMode` is on, a press on the plan
 * drags out a rectangle instead of selecting — the same ghost repaint shows
 * it snapped and sized — and the release names it and adds it to the active
 * floor through the store, so the mode needs no wiring from the orchestrator.
 */
export function useCanvas2DInteraction(
  params: UseCanvas2DInteractionParams
): UseCanvas2DInteractionResult {
  const paramsRef = useRef(params);
  paramsRef.current = params;
  // Stable for the store's lifetime (use-layout-store), so the effect below
  // can close over it without re-subscribing.
  const layoutActions = useLayoutActions();

  const clientToWorld2D = useCallback((clientX: number, clientY: number) => {
    const canvas = paramsRef.current.canvasRef.current;
    if (!canvas) return null;
    const { layout } = paramsRef.current;
    const transform = get2DViewTransform(canvas.clientWidth, canvas.clientHeight, layout);
    if (!Number.isFinite(transform.scale) || transform.scale <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    return canvasToWorld(clientX - rect.left, clientY - rect.top, transform, layout);
  }, []);

  /** HIT_SLOP_PX in world metres at the plan's current scale (#286). */
  const hitSlopWorld = useCallback((): number => {
    const canvas = paramsRef.current.canvasRef.current;
    if (!canvas) return 0;
    const { scale } = get2DViewTransform(canvas.clientWidth, canvas.clientHeight, paramsRef.current.layout);
    return Number.isFinite(scale) && scale > 0 ? HIT_SLOP_PX / scale : 0;
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
      /** Click-vs-drag radius for this pointer type (#292). */
      threshold: number;
      /** Item centre minus the press point, kept through the drag (#292). */
      grabOffset: { x: number; z: number };
      /** The press kept a multi-selection; a release without a drag narrows it (#291). */
      selectOnRelease: boolean;
      /** True once the pointer crossed the threshold and the session opened. */
      started: boolean;
      /** Overlay members' start positions — mirrors use-item-drag's session. */
      origins: Map<string, { x: number; z: number }>;
      /** In-flight positions for the ghost repaint. */
      latest: Map<string, { x: number; z: number }>;
    }
    let gesture: Gesture | null = null;
    let rafId: number | null = null;

    /** A zone rectangle being dragged out (#155); world corners, room-centred. */
    interface ZoneGesture {
      pointerId: number;
      downClientX: number;
      downClientY: number;
      threshold: number;
      started: boolean;
      start: { x: number; z: number };
      latest: { x: number; z: number };
    }
    let zoneGesture: ZoneGesture | null = null;

    const paintGhost = (): void => {
      rafId = null;
      const { layout, activeFloor, view, selectedItemId, extraSelectedIds } = paramsRef.current;
      const session = gesture?.started ? gesture : null;
      const items = session
        ? activeFloor.items.map((item) => {
            const moved = session.latest.get(item.id);
            return moved ? { ...item, position: moved } : item;
          })
        : activeFloor.items;
      const keepOut = floorKeepOut(layout, planFloorIndex(layout.floors, activeFloor));
      const draft = zoneGesture?.started
        ? zoneFromCorners(zoneGesture.start, zoneGesture.latest, layout.width, layout.height)
        : null;
      render2DTopDown({
        canvas,
        layout,
        floor: session ? { ...activeFloor, items } : activeFloor,
        selectedItemId,
        extraSelectedIds,
        showMeasurements: view.showMeasurements,
        showWiFiSignals: view.showWiFiSignals,
        showHeatmap: view.showHeatmap,
        zoneDraft: draft,
        hasCollision: (item) =>
          hasCollisions(item, items, layout.width, layout.height, { keepOut, interiorWalls: activeFloor.interiorWalls, storeyHeight: storeyHeight(activeFloor) }),
      });
    };
    const schedulePaint = (): void => {
      if (rafId === null) rafId = requestAnimationFrame(paintGhost);
    };

    const releaseCapture = (pointerId: number): void => {
      try {
        canvas.releasePointerCapture(pointerId);
      } catch {
        // Ignore if capture was never held or already released.
      }
    };

    /**
     * Release of a zone drag: add the rectangle under a default name and ask
     * for a better one inline (#374). A too-small rectangle adds nothing, so
     * the plan is repainted here to clear the dashed draft (no state change
     * will do it).
     */
    const finishZone = (session: ZoneGesture, commit: boolean): void => {
      zoneGesture = null;
      if (!session.started) return;
      releaseCapture(session.pointerId);
      const { layout, activeFloor } = paramsRef.current;
      const rect = commit ? zoneFromCorners(session.start, session.latest, layout.width, layout.height) : null;
      if (rect) {
        const zones = activeFloor.zones ?? [];
        const fallback = defaultZoneName(zones);
        requestZoneName(layoutActions.addZone({ name: fallback, color: nextZoneColor(zones), ...rect }));
        return;
      }
      schedulePaint();
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

    /**
     * Drop the gesture without committing. `restore` (a pointercancel, #292)
     * also repaints from committed state — no state change will clear the
     * ghost frame — and tells the drag session to put the 3D groups back.
     */
    const abortGesture = (restore = false): void => {
      const session = gesture;
      gesture = null;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (zoneGesture) {
        const zone = zoneGesture;
        zoneGesture = null;
        if (zone.started) releaseCapture(zone.pointerId);
      }
      if (!session?.started) return;
      releaseCapture(session.pointerId);
      paramsRef.current.onItemDragCancel(session.itemId, { restore });
      if (restore) schedulePaint();
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || gesture !== null || zoneGesture !== null) return;
      const p = paramsRef.current;
      const world = clientToWorld2D(event.clientX, event.clientY);
      if (!world) return;
      // Zone-draw mode (#155) claims the press: the rectangle starts here
      // and no item is selected or moved underneath it.
      if (p.view.drawZoneMode) {
        zoneGesture = {
          pointerId: event.pointerId,
          downClientX: event.clientX,
          downClientY: event.clientY,
          threshold: dragThresholdPx(event.pointerType),
          started: false,
          start: world,
          latest: world,
        };
        return;
      }
      const hit = hitTest2DItems(p.activeFloor.items, world.x, world.z, hitSlopWorld());
      if (!hit) {
        p.onDeselect();
        return;
      }
      const mode = event.altKey ? 'single' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
      const locked = hit.locked === true;
      // A plain press on a member of a multi-selection keeps it, so the drag
      // moves the whole set (#291) — mirrors the 3D canvas (drag-handlers).
      const keepSelection = !locked && keepsSelectionOnPress(mode, hit.id, p.allSelectedIds);
      if (!keepSelection) p.onItemSelect(hit.id, mode);
      // Locked items select but never drag; a toggle click is selection
      // surgery, not a move — both mirror the 3D canvas (drag-handlers).
      if (locked || mode === 'toggle') return;
      const position = hit.position ?? world;
      gesture = {
        pointerId: event.pointerId,
        itemId: hit.id,
        downClientX: event.clientX,
        downClientY: event.clientY,
        threshold: dragThresholdPx(event.pointerType),
        grabOffset: { x: position.x - world.x, z: position.z - world.z },
        selectOnRelease: keepSelection,
        started: false,
        origins: new Map(),
        latest: new Map(),
      };
    };

    const onPointerMove = (event: PointerEvent): void => {
      const zone = zoneGesture;
      if (zone && event.pointerId === zone.pointerId) {
        if (!zone.started) {
          const dx = event.clientX - zone.downClientX;
          const dy = event.clientY - zone.downClientY;
          if (dx * dx + dy * dy < zone.threshold * zone.threshold) return;
          zone.started = true;
          try {
            canvas.setPointerCapture(event.pointerId);
          } catch {
            // Capture can throw if the pointer is already gone; safe to ignore.
          }
        }
        const world = clientToWorld2D(event.clientX, event.clientY);
        if (!world) return;
        zone.latest = world;
        schedulePaint();
        return;
      }
      const session = gesture;
      if (!session || event.pointerId !== session.pointerId) return;
      if (!session.started) {
        const dx = event.clientX - session.downClientX;
        const dy = event.clientY - session.downClientY;
        if (dx * dx + dy * dy < session.threshold * session.threshold) return;
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
      const snapped = p.snapPosition(
        session.itemId,
        world.x + session.grabOffset.x,
        world.z + session.grabOffset.z
      );
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
      const zone = zoneGesture;
      if (zone && event.pointerId === zone.pointerId) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        // pointercancel (the browser took the pointer for a scroll or a
        // touch gesture) discards the rectangle rather than naming it.
        finishZone(zone, event.type === 'pointerup');
        return;
      }
      const session = gesture;
      if (!session || event.pointerId !== session.pointerId) return;
      gesture = null;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      // A release inside the threshold was a select-only click (#65); a
      // press that kept a multi-selection selects the item now (#291).
      if (!session.started) {
        if (session.selectOnRelease) paramsRef.current.onItemSelect(session.itemId, 'replace');
        return;
      }
      releaseCapture(session.pointerId);
      // Commits once, locks, settles wall-mounted items; the state change
      // re-runs the 2D paint effect for the final frame.
      paramsRef.current.onItemDragEnd(session.itemId);
    };

    const onPointerCancel = (event: PointerEvent): void => {
      // A zone draft is discarded by endGesture (it checks the event type).
      if (zoneGesture && event.pointerId === zoneGesture.pointerId) {
        endGesture(event);
        return;
      }
      // The browser took the pointer mid-drag (OS gesture, palm rejection):
      // undo the drag instead of committing and locking it (#292).
      if (gesture && event.pointerId === gesture.pointerId) abortGesture(true);
    };

    const onPointerLeave = (): void => {
      // A started drag holds pointer capture and stays alive off-canvas;
      // only an armed-but-unstarted gesture is abandoned here.
      if (gesture && !gesture.started) gesture = null;
      if (zoneGesture && !zoneGesture.started) zoneGesture = null;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endGesture);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', onPointerLeave);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endGesture);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      // Disabled (view switch) or unmounted mid-drag: discard the session so
      // nothing stale is committed on a later pointerup.
      abortGesture();
    };
  }, [params.enabled, params.canvasRef, clientToWorld2D, hitSlopWorld, layoutActions]);

  return { clientToWorld2D };
}
