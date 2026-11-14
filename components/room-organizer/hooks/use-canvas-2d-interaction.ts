import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { draggedZoneRect, hitInteriorWall, wallEndAt, ZONE_GRIP_CURSORS, zoneAt, zoneGripAt, type ZoneGrip } from '../canvas-2d/plan-edit';
import { NO_PLAN_ZOOM, panPlan, pinchPlan, planZoomOf, setPlanZoom, zoomPlanAbout, type PlanZoom } from '../canvas-2d/plan-zoom';
import { canvasToWorld, get2DViewTransform, render2DTopDown } from '../canvas-2d/render';
import { requestZoneName } from '../lib/editor-notices';
import { floorKeepOut } from '../lib/floor-keep-out';
import { movedFloorPlan } from '../lib/floor-plan-fit';
import { hasCollisions } from '../lib/geometry';
import { isWallMounted } from '../lib/opening-snap';
import { isOnDoorLeaf, type PlacedItem } from '../lib/plan-export/plan-geometry';
import { planDrawOrder } from '../lib/plan-order';
import { boundsSize, hitOffPlanMarker, offPlanMarkers, PLAN_PADDING_PX, planViewFit, type OffPlanItem, type PlanBounds } from '../lib/plan-view-fit';
import { storeyHeight } from '../lib/storeys';
import { entrancePlanOutline, planFloorIndex } from '../lib/street';
import { wallSideAt, type WallSide } from '../lib/wall-sides';
import { defaultZoneName, nextZoneColor, roomAt, zoneFromCorners, zoneFromRoom, zoneInPorch, type ZoneRect } from '../lib/zones';
import { dragThresholdPx, keepsSelectionOnPress, pointerOnCanvas } from '../three/drag-handlers';
import { addCalibrationPoint, getPlanCalibration } from './plan-calibration';
import { PLAN_GESTURE_ATTR, planFit } from './scene-occluders';
import { useLayoutActions } from './use-layout-store';
import type { DragCancelOptions } from './use-item-drag';
import type { WallGrabInfo, WallMovePreview } from './use-wall-edit';
import type { DetectedRoom } from '../lib/room-detect';
import type { Insets, Rect } from '../lib/scene-insets';
import type { EntrancePlanOutline } from '../lib/street';
import type { FloorLayout, FloorPlanTransform, FurnitureItem, RoomLayout, Vec2, ViewSettings } from '../lib/types';
import type { HeldGesture } from '../three/drag-handlers';

/**
 * Extra hit margin (CSS px) around wall-mounted and very small items (#286):
 * a 0.2 m Wi-Fi puck or a 0.12 m-deep window is a 4–8 px target at typical
 * plan scales, so a click a few pixels off its edge should still land.
 */
const HIT_SLOP_PX = 6;
/** Items whose shorter side is under this (m) get the slop. */
const SMALL_ITEM_MAX_SIDE_M = 0.3;
/** Extra hit margin (CSS px) around an interior wall: a thin target, thinner still under a finger. */
const WALL_HIT_SLOP_PX = 6;
const WALL_HIT_SLOP_TOUCH_PX = 14;
/** How far a zone's edges reach, and its handles under a finger: a 44 px target (CSS px). */
const ZONE_GRIP_SLOP_PX = 8;
const ZONE_ON_PORCH = 'The porch is outside the house, so it can’t be a zone.';
const ZONE_IN_CORNER = 'That corner is outside the house, so it can’t be a zone.';
const ZONE_MARK_SLOP_TOUCH_PX = 22;
/** How far a selected wall's end handles reach, the same 44 px under a finger. */
const WALL_END_REACH_PX = 10;
const WALL_END_REACH_TOUCH_PX = 22;
/** Two taps this close in time (ms) and place (CSS px) are a double tap: back to the fit (#678). */
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP_PX = 30;
/** A touch that moved less than this (CSS px) before lifting was a tap. */
const TAP_SLOP_PX = 10;
/** Wheel zoom per pixel of scroll: a notch (100 px) is about 22 %. */
const WHEEL_ZOOM_PER_PX = 0.002;

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
  // Nothing's footprint is there: a door's open leaf, drawn out into the room
  // (#576). After every footprint, so it never takes a click from what it
  // swings over.
  for (let i = ordered.length - 1; i >= 0; i--) {
    const item = ordered[i]!;
    if (item.type === 'door' && item.position && isOnDoorLeaf(item as PlacedItem, worldX, worldZ, slop)) return item;
  }
  return null;
}

/** Where a drag is holding an item: its rotation only when the wall turns it (#601). */
export type GhostPlacement = { x: number; z: number; rotation?: number };

/** The floor's items with a drag's in-flight placements overlaid, for the ghost repaint. */
export function overlayGhostPlacements(
  items: readonly FurnitureItem[],
  latest: ReadonlyMap<string, GhostPlacement>
): FurnitureItem[] {
  return items.map((item) => {
    const held = latest.get(item.id);
    if (!held) return item;
    const { rotation, ...position } = held;
    return { ...item, position, ...(rotation === undefined ? {} : { rotation }) };
  });
}

/** What a plan paint fits, and where (`get2DViewTransform`'s bounds, insets and padding). */
interface PlanFit {
  bounds: PlanBounds | undefined;
  /** Items left out of `bounds`, drawn as edge markers (`planViewFit`). */
  offPlan: readonly OffPlanItem[];
  insets: Insets | undefined;
  padding: number;
  /** The HUD panels over the canvas (`planFit`). */
  hudRects: readonly Rect[];
}

export interface UseCanvas2DInteractionParams {
  /** Only the visible 2D view listens; the hidden canvas gets no handlers. */
  enabled: boolean;
  /**
   * EXPLORE never edits the house (#643, #699): a press selects, nothing
   * drags and zone drawing is off. Read at press time.
   */
  exploring?: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  layout: RoomLayout;
  activeFloor: FloorLayout;
  view: Pick<ViewSettings, 'showMeasurements' | 'showWiFiSignals' | 'showHeatmap' | 'showFloorBelow' | 'drawZoneMode'> & {
    drawWallMode?: boolean;
  };
  selectedItemId: string | null;
  extraSelectedIds: ReadonlySet<string>;
  allSelectedIds: ReadonlySet<string>;
  /** 'single' is Alt+click: one member of a group on its own (#154). */
  onItemSelect(id: string, mode: 'replace' | 'toggle' | 'single'): void;
  /** Pointer went down on empty plan space — clear the selection (#219). */
  onDeselect(): void;
  /** The same snap pipeline the 3D drag applies per move (use-item-placement). */
  snapPosition(id: string, x: number, z: number): GhostPlacement;
  onItemDragStart(id: string): void;
  onItemDrag(id: string, x: number, z: number): void;
  onItemDragEnd(id: string): void;
  onItemDragCancel(id: string, options?: DragCancelOptions): void;
  /** A drag began on a locked item: say why it stays put (#635). */
  onLockedDrag?(id: string): void;
  /** A zone drawn wholly on the porch: say why nothing was added (#582). */
  onZoneRefused?(message: string): void;
  /** The wall tool placed a point on the plan (#564). Snapping is the handler's. */
  onWallPoint?(x: number, z: number): void;
  /** The pointer moved over the plan with the wall tool on. */
  onWallPointerMove?(x: number, z: number): void;
  onWallPointerLeave?(): void;
  /** The wall tool's press: a room stamp in hand starts sizing here (#724). */
  onWallPress?(x: number, z: number): void;
  /** That press ended with no point: the room stamp forgets it. */
  onWallPressCancel?(): void;
  /** A press picked an interior wall, or something else (null). Not in EXPLORE. */
  onInteriorWallSelect?(id: string | null, side?: WallSide): void;
  /** The wall with handles (#718). */
  selectedWallId?: string | null;
  /** A press on the selected wall or an end: the gesture to feed, or null. */
  onWallGrab?(info: WallGrabInfo): HeldGesture | null;
  /** What the held wall gesture shows, for the ghost repaint. */
  wallMovePreview?(): WallMovePreview | null;
  /** The zone showing handles (#628): zone mode only, the orchestrator clears it. */
  selectedZoneId?: string | null;
  onZoneSelect?(id: string | null): void;
  /** Detected rooms with no zone, in zone mode: a tap on one names it (#719). */
  roomsToName?: readonly DetectedRoom[];
}

export interface UseCanvas2DInteractionResult {
  /** Client coords → world x/z via the renderer's inverse transform, or null off-canvas. */
  clientToWorld2D(clientX: number, clientY: number): { x: number; z: number } | null;
  /** Repaint in the next frame: something a gesture previewed was called off from outside. */
  repaintPlan(): void;
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
 *
 * Wall drawing (#564): while `view.drawWallMode` is on, every release on the
 * plan is a wall point, as a click is on the 3D floor. Items don't claim it.
 * The draft lives in the orchestrator's state, which also feeds the 3D view,
 * so this hook only reports the pointer. There is no threshold: a finger that
 * slides before lifting places the point where it lifts.
 *
 * Zone editing (#628): in zone mode a tap on a zone selects it, and a press on
 * the selected zone's edges, corners or body resizes or moves it; a drag
 * anywhere else still draws, even inside another zone. Like an item drag it
 * repaints the ghost per frame and dispatches once, on release.
 *
 * Wall editing (#718): a press on a wall slides it and a press on the selected
 * wall's end handle moves that end. The gesture is `useWallEdit`'s, which says
 * whether a wall not yet selected may move: this hook feeds it and repaints
 * what it previews.
 */
export function useCanvas2DInteraction(
  params: UseCanvas2DInteractionParams
): UseCanvas2DInteractionResult {
  const paramsRef = useRef(params);
  paramsRef.current = params;
  // Stable for the store's lifetime (use-layout-store), so the effect below
  // can close over it without re-subscribing.
  const layoutActions = useLayoutActions();
  const repaintRef = useRef<() => void>(() => {});

  /**
   * Client coords → world x/z through the renderer's own transform. `fit`
   * is what the plan was painted to fit and `insets` the HUD-covered edges
   * it was painted with (`planViewBounds`, `planInsets`, #381).
   */
  const toWorld = useCallback((clientX: number, clientY: number, fit: PlanFit) => {
    const canvas = paramsRef.current.canvasRef.current;
    if (!canvas) return null;
    const { layout } = paramsRef.current;
    const transform = get2DViewTransform(canvas.clientWidth, canvas.clientHeight, layout, fit.padding, fit.insets, fit.bounds, planZoomOf(canvas));
    if (!Number.isFinite(transform.scale) || transform.scale <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    return canvasToWorld(clientX - rect.left, clientY - rect.top, transform, layout);
  }, []);

  /** The fit the plan is painted with now, from committed state (use-scene-effects). */
  const measureFit = useCallback((canvas: HTMLCanvasElement): PlanFit => {
    const { bounds, offPlan } = planViewFit(paramsRef.current.layout, paramsRef.current.activeFloor);
    return { bounds, offPlan, ...planFit(canvas, boundsSize(bounds)) };
  }, []);

  const clientToWorld2D = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = paramsRef.current.canvasRef.current;
      return canvas ? toWorld(clientX, clientY, measureFit(canvas)) : null;
    },
    [toWorld, measureFit]
  );

  /** A hit margin in world metres at the plan's current scale (#286). */
  const hitSlopWorld = useCallback((fit: PlanFit, slopPx = HIT_SLOP_PX): number => {
    const canvas = paramsRef.current.canvasRef.current;
    if (!canvas) return 0;
    const { scale } = get2DViewTransform(canvas.clientWidth, canvas.clientHeight, paramsRef.current.layout, fit.padding, fit.insets, fit.bounds, planZoomOf(canvas));
    return Number.isFinite(scale) && scale > 0 ? slopPx / scale : 0;
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
      /** In-flight placements for the ghost repaint. */
      latest: Map<string, GhostPlacement>;
    }
    let gesture: Gesture | null = null;
    /** A press on a locked item, watched only to explain the drag it can't start (#635). */
    let lockedPress: { id: string; pointerId: number; x: number; y: number; threshold: number } | null = null;
    let rafId: number | null = null;
    /**
     * Calibrating the traced plan (#726): the image follows the pointer and
     * the plan repaints it per frame; the release commits it in one dispatch.
     */
    let imageDrag: { pointerId: number; start: Vec2; from: FloorPlanTransform; latest: FloorPlanTransform } | null = null;
    /** Ends an image drag, committing where it was let go, or putting it back. */
    const endImageDrag = (commit: boolean): void => {
      const drag = imageDrag;
      if (!drag) return;
      imageDrag = null;
      releaseCapture(drag.pointerId);
      if (commit && drag.latest !== drag.from) layoutActions.setFloorPlanTransform(drag.latest);
      else schedulePaint();
    };

    /** A zone rectangle being dragged out (#155); world corners, room-centred. */
    interface ZoneGesture {
      pointerId: number;
      downClientX: number;
      downClientY: number;
      threshold: number;
      started: boolean;
      start: { x: number; z: number };
      latest: { x: number; z: number };
      /** The zone a tap here selects, or null to clear the selection (#628). */
      tapZoneId: string | null;
    }
    let zoneGesture: ZoneGesture | null = null;
    /** The selected zone being moved or resized (#628). */
    interface ZoneEdit {
      pointerId: number;
      zoneId: string;
      grip: ZoneGrip;
      downClientX: number;
      downClientY: number;
      threshold: number;
      started: boolean;
      grabbedAt: { x: number; z: number };
      origin: ZoneRect;
      latest: ZoneRect;
      /** The storey's porch, read at the press. */
      recess: EntrancePlanOutline | null;
      /** The pointer is where the zone would be on the porch: the ghost holds. */
      overPorch: boolean;
    }
    let zoneEdit: ZoneEdit | null = null;
    /** The press of a wall point, placed on release (#564). */
    let wallPress: { pointerId: number } | null = null;
    /** A press on the selected wall (#718); `started` past the threshold. */
    interface WallHold {
      pointerId: number;
      gesture: HeldGesture;
      downClientX: number;
      downClientY: number;
      threshold: number;
      started: boolean;
      /**
       * A wall this press is only now selecting, selected at the release
       * (#786): selecting opens the paint sheet, which on a phone covers the
       * finger, and the drag would go on over the HUD and be called off.
       */
      select?: { id: string; side: WallSide };
    }
    let wallHold: WallHold | null = null;
    const holdWall = (gesture: HeldGesture, event: PointerEvent, select?: WallHold['select']): void => {
      wallHold = {
        pointerId: event.pointerId,
        gesture,
        downClientX: event.clientX,
        downClientY: event.clientY,
        threshold: dragThresholdPx(event.pointerType),
        started: false,
        ...(select ? { select } : {}),
      };
    };
    // The fit, measured at each press: the gesture maps the pointer and
    // repaints with the transform the plan was painted with, so dragging an
    // item past the walls doesn't rescale the plan under the pointer; the
    // committed drop refits it (#381).
    let fit: PlanFit = { bounds: undefined, offPlan: [], insets: undefined, padding: PLAN_PADDING_PX, hudRects: [] };
    const worldAt = (event: PointerEvent) => toWorld(event.clientX, event.clientY, fit);

    // View zoom and pan (#678): two fingers pinch and pan, one finger on
    // empty floor pans once zoomed in, a double tap on empty floor goes back
    // to the fit, a wheel zooms about the pointer. None of it touches the
    // house. The plan's own paint, overlays and all, follows the zoom
    // (`onPlanZoom` in use-scene-effects), as does the placement ghost.
    type Point = { x: number; y: number };
    const local = (event: { clientX: number; clientY: number }): Point => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    /** Fingers down on the plan, where they are now (canvas px). */
    const touches = new Map<number, Point>();
    let pinch: { a: number; b: number; from: { a: Point; b: Point }; start: PlanZoom } | null = null;
    /**
     * A press on empty floor. Released where it came down it is a tap, which
     * clears the selection (and a second one soon after, by a finger, goes
     * back to the fit); dragged on a zoomed plan it pans, and keeps the
     * selection.
     */
    let pan: {
      pointerId: number;
      last: Point;
      down: Point;
      threshold: number;
      started: boolean;
      /** The tap on empty floor just before this press, for the double tap. */
      tapBefore: (Point & { time: number }) | null;
      touch: boolean;
      /** Pressed while calibrating the traced plan (#726): a tap picks a point, not the selection. */
      calibrating?: boolean;
    } | null = null;
    /** The last tap on empty floor by a finger; any other press forgets it. */
    let lastTap: (Point & { time: number }) | null = null;
    /** A gesture of the house's (an item, a zone, a wall) is held. */
    const houseGestureHeld = (): boolean => (gesture ?? zoneGesture ?? wallPress ?? zoneEdit ?? wallHold) !== null;
    const size = () => ({ width: canvas.clientWidth, height: canvas.clientHeight });
    /** The plain fit the zoom sits on, as `fit` measured it. */
    const fitted = () => get2DViewTransform(canvas.clientWidth, canvas.clientHeight, paramsRef.current.layout, fit.padding, fit.insets, fit.bounds);
    const startPinch = (): void => {
      const [a, b] = [...touches.keys()];
      if (a === undefined || b === undefined) return;
      if (houseGestureHeld()) abortGesture(true);
      endImageDrag(false);
      if (pan) releaseCapture(pan.pointerId);
      pan = null;
      lastTap = null;
      lockedPress = null;
      fit = measureFit(canvas);
      pinch = { a, b, from: { a: touches.get(a)!, b: touches.get(b)! }, start: planZoomOf(canvas) };
    };
    /** The release of a press on empty floor that didn't pan: a tap. */
    const tapEmptyFloor = (press: NonNullable<typeof pan>, event: PointerEvent): void => {
      const p = paramsRef.current;
      p.onDeselect();
      p.onInteriorWallSelect?.(null);
      if (!press.touch || event.type !== 'pointerup') return;
      const at = local(event);
      if (Math.hypot(at.x - press.down.x, at.y - press.down.y) > TAP_SLOP_PX) return;
      const now = event.timeStamp || performance.now();
      const before = press.tapBefore;
      const double = before !== null && now - before.time < DOUBLE_TAP_MS && Math.hypot(at.x - before.x, at.y - before.y) < DOUBLE_TAP_SLOP_PX;
      lastTap = double ? null : { ...at, time: now };
      if (double) setPlanZoom(canvas, NO_PLAN_ZOOM);
    };

    const paintGhost = (): void => {
      rafId = null;
      const { layout: committed, activeFloor, view, selectedItemId, extraSelectedIds, selectedZoneId, selectedWallId, roomsToName } = paramsRef.current;
      const layout = imageDrag ? { ...committed, floorPlanTransform: imageDrag.latest } : committed;
      const session = gesture?.started ? gesture : null;
      const wallMove = wallHold?.started ? paramsRef.current.wallMovePreview?.() : null;
      const items = session ? overlayGhostPlacements(activeFloor.items, session.latest) : (wallMove?.items ?? activeFloor.items);
      const keepOut = floorKeepOut(layout, planFloorIndex(layout.floors, activeFloor));
      const draft = zoneGesture?.started
        ? zoneFromCorners(zoneGesture.start, zoneGesture.latest, layout.width, layout.height, layout.cutout)
        : null;
      const edit = zoneEdit?.started ? zoneEdit : null;
      const zones = edit
        ? { zones: (activeFloor.zones ?? []).map((zone) => (zone.id === edit.zoneId ? { ...zone, ...edit.latest } : zone)) }
        : {};
      render2DTopDown({
        canvas,
        layout,
        floor: session || edit || wallMove ? { ...activeFloor, items, ...zones, ...(wallMove ? { interiorWalls: wallMove.walls } : {}) } : activeFloor,
        selectedItemId,
        extraSelectedIds,
        showMeasurements: view.showMeasurements,
        showWiFiSignals: view.showWiFiSignals,
        showHeatmap: view.showHeatmap,
        showFloorBelow: view.showFloorBelow,
        zoneDraft: draft,
        roomsToName,
        selectedZoneId,
        selectedWallId,
        selectedWallRefused: (wallMove?.refusal ?? null) !== null,
        calibrationPoints: getPlanCalibration()?.points,
        floorPlanUnclipped: getPlanCalibration() !== null,
        fitBounds: fit.bounds,
        offPlan: fit.offPlan,
        insets: fit.insets,
        padding: fit.padding,
        hudRects: fit.hudRects,
        zoom: planZoomOf(canvas),
        hasCollision: (item) =>
          hasCollisions(item, items, layout.width, layout.height, { keepOut, interiorWalls: wallMove?.walls ?? activeFloor.interiorWalls, storeyHeight: storeyHeight(activeFloor) }),
      });
    };
    const schedulePaint = (): void => {
      if (rafId === null) rafId = requestAnimationFrame(paintGhost);
    };
    repaintRef.current = schedulePaint;

    const releaseCapture = (pointerId: number): void => {
      try {
        canvas.releasePointerCapture(pointerId);
      } catch {
        // Ignore if capture was never held or already released.
      }
    };

    /** A selected zone takes the item selection's place, or Delete would sell the item. */
    const selectZone = (id: string | null): void => {
      const p = paramsRef.current;
      if (id !== null) p.onDeselect();
      p.onZoneSelect?.(id);
    };

    /**
     * Release of a zone drag: add the rectangle under a default name and ask
     * for a better one inline (#374). A too-small rectangle adds nothing, so
     * the plan is repainted here to clear the dashed draft (no state change
     * will do it).
     */
    const finishZone = (session: ZoneGesture, commit: boolean): void => {
      zoneGesture = null;
      const p = paramsRef.current;
      if (!session.started) {
        const room = commit && !session.tapZoneId ? roomAt(p.roomsToName ?? [], session.start.x, session.start.z) : null;
        if (room) {
          const zones = p.activeFloor.zones ?? [];
          requestZoneName(layoutActions.addZone(zoneFromRoom(room, defaultZoneName(zones), nextZoneColor(zones))));
        } else if (commit) {
          selectZone(session.tapZoneId);
        }
        return;
      }
      releaseCapture(session.pointerId);
      const { layout, activeFloor, onZoneRefused } = p;
      const rect = commit ? zoneFromCorners(session.start, session.latest, layout.width, layout.height, layout.cutout) : null;
      // Big enough, had the corner been there: say why it adds nothing.
      if (commit && !rect && zoneFromCorners(session.start, session.latest, layout.width, layout.height)) onZoneRefused?.(ZONE_IN_CORNER);
      const onPorch = rect !== null && zoneInPorch(rect, entrancePlanOutline(layout, planFloorIndex(layout.floors, activeFloor)));
      if (onPorch) onZoneRefused?.(ZONE_ON_PORCH);
      if (rect && !onPorch) {
        const zones = activeFloor.zones ?? [];
        const fallback = defaultZoneName(zones);
        const id = layoutActions.addZone({ name: fallback, color: nextZoneColor(zones), ...rect });
        requestZoneName(id);
        // Not selected: the next room usually starts at this one's corner,
        // where a handle would take the press.
        return;
      }
      schedulePaint();
    };

    /** Release of a zone move or resize: one dispatch, or nothing if it was called off. */
    const finishZoneEdit = (edit: ZoneEdit, commit: boolean): void => {
      zoneEdit = null;
      if (!edit.started) {
        // A tap on the selected zone's body steps down to the zone under it,
        // then off, so an overlapped zone can be reached.
        if (commit && edit.grip === 'move') {
          const zones = paramsRef.current.activeFloor.zones ?? [];
          selectZone(zoneAt(zones, edit.grabbedAt.x, edit.grabbedAt.z, edit.zoneId)?.id ?? null);
        }
        return;
      }
      releaseCapture(edit.pointerId);
      // The reducer refuses this silently (#582): say why, and the zone goes back.
      const onPorch = edit.overPorch || (zoneInPorch(edit.latest, edit.recess) && !zoneInPorch(edit.origin, edit.recess));
      if (commit && onPorch) paramsRef.current.onZoneRefused?.(ZONE_ON_PORCH);
      else if (commit) layoutActions.updateZone(edit.zoneId, edit.latest);
      // Called off, or fitted back to where it was: no state change repaints.
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
      if (wallPress) {
        releaseCapture(wallPress.pointerId);
        wallPress = null;
        paramsRef.current.onWallPressCancel?.();
      }
      if (wallHold) {
        const hold = wallHold;
        wallHold = null;
        releaseCapture(hold.pointerId);
        hold.gesture.end(false);
        if (restore) schedulePaint();
      }
      if (zoneEdit) finishZoneEdit(zoneEdit, false);
      if (zoneGesture) {
        const zone = zoneGesture;
        zoneGesture = null;
        if (zone.started) {
          releaseCapture(zone.pointerId);
          // Clear the dashed draft: no state change will.
          if (restore) schedulePaint();
        }
      }
      if (!session?.started) return;
      releaseCapture(session.pointerId);
      paramsRef.current.onItemDragCancel(session.itemId, { restore });
      if (restore) schedulePaint();
    };

    const onPointerDown = (event: PointerEvent): void => {
      // Only a tap on empty floor right after another makes a double tap.
      const tapBefore = lastTap;
      lastTap = null;
      if (event.pointerType === 'touch') {
        touches.set(event.pointerId, local(event));
        if (pinch) return;
        // A second finger is a pinch: whatever the first one held is called
        // off (the item goes back, the zone draft goes), as on the 3D canvas.
        if (touches.size >= 2) {
          startPinch();
          return;
        }
      }
      if (pan) {
        if (event.pointerId !== pan.pointerId) {
          releaseCapture(pan.pointerId);
          pan = null;
        }
        return;
      }
      // Another pointer while one holds a gesture of the house: drop it.
      const held = gesture ?? zoneGesture ?? wallPress ?? zoneEdit ?? wallHold;
      if (held) {
        if (event.pointerId !== held.pointerId) abortGesture(true);
        return;
      }
      if (imageDrag) {
        if (event.pointerId !== imageDrag.pointerId) endImageDrag(false);
        return;
      }
      // A later finger of a multi-touch gesture never selects or drags.
      if (event.button !== 0 || event.isPrimary === false) return;
      const p = paramsRef.current;
      fit = measureFit(canvas);
      const world = worldAt(event);
      if (!world) return;
      // Calibrating the traced plan (#726) claims every press: nothing is
      // selected underneath. Picking, a press is a view press that becomes a
      // point if it is a tap; placing, it takes the image.
      const calibration = getPlanCalibration();
      if (calibration && !p.exploring) {
        const transform = p.layout.floorPlanTransform;
        if (calibration.phase !== 'move' || !transform) {
          const at = local(event);
          pan = { pointerId: event.pointerId, last: at, down: at, threshold: dragThresholdPx(event.pointerType), started: false, tapBefore: null, touch: event.pointerType === 'touch', calibrating: true };
          return;
        }
        imageDrag = { pointerId: event.pointerId, start: world, from: transform, latest: transform };
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {
          // Capture can throw if the pointer is already gone; safe to ignore.
        }
        return;
      }
      // The Walls tool claims the press, as on the 3D floor (#349). It comes
      // before zones: arming zones parks it, so if both are on it is the
      // later pick.
      if (p.view.drawWallMode && !p.exploring) {
        wallPress = { pointerId: event.pointerId };
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {
          // Capture can throw if the pointer is already gone; safe to ignore.
        }
        p.onWallPointerMove?.(world.x, world.z);
        p.onWallPress?.(world.x, world.z);
        return;
      }
      // Zone-draw mode (#155) claims the press: the rectangle starts here
      // and no item is selected or moved underneath it.
      if (p.view.drawZoneMode && !p.exploring) {
        p.onInteriorWallSelect?.(null);
        const press = {
          pointerId: event.pointerId,
          downClientX: event.clientX,
          downClientY: event.clientY,
          threshold: dragThresholdPx(event.pointerType),
          started: false,
        };
        const zones = p.activeFloor.zones ?? [];
        const selected = zones.find((zone) => zone.id === p.selectedZoneId);
        const slop = hitSlopWorld(fit, ZONE_GRIP_SLOP_PX);
        const markSlop = event.pointerType === 'touch' ? hitSlopWorld(fit, ZONE_MARK_SLOP_TOUCH_PX) : slop;
        const grip = selected ? zoneGripAt(selected, world.x, world.z, slop, markSlop) : null;
        if (selected && grip) {
          const origin = { x: selected.x, z: selected.z, w: selected.w, d: selected.d };
          const recess = entrancePlanOutline(p.layout, planFloorIndex(p.layout.floors, p.activeFloor));
          zoneEdit = { ...press, zoneId: selected.id, grip, grabbedAt: world, origin, latest: origin, recess, overPorch: false };
          return;
        }
        // A tap on a selected polygon zone steps down, as one on a rectangle's body does.
        const below = selected?.outline ? selected.id : undefined;
        zoneGesture = { ...press, start: world, latest: world, tapZoneId: zoneAt(zones, world.x, world.z, below)?.id ?? null };
        return;
      }
      // The selected wall's ends sit on top of whatever is under them (#718).
      const selectedWall = p.exploring ? undefined : p.activeFloor.interiorWalls?.find((wall) => wall.id === p.selectedWallId);
      if (selectedWall) {
        const reach = hitSlopWorld(fit, event.pointerType === 'touch' ? WALL_END_REACH_TOUCH_PX : WALL_END_REACH_PX);
        const grip = wallEndAt(selectedWall, world.x, world.z, reach);
        const end = grip && p.onWallGrab?.({ wallId: selectedWall.id, grip, x: world.x, z: world.z });
        if (end) {
          holdWall(end, event);
          return;
        }
      }
      // An off-plan marker selects the far item it points to (#381): its
      // sheet or popover carries Centre to bring it back. No drag.
      if (fit.bounds && fit.offPlan.length > 0) {
        const transform = get2DViewTransform(canvas.clientWidth, canvas.clientHeight, p.layout, fit.padding, fit.insets, fit.bounds, planZoomOf(canvas));
        const rect = canvas.getBoundingClientRect();
        const marker = hitOffPlanMarker(
          offPlanMarkers(transform, p.layout, fit.bounds, fit.offPlan),
          event.clientX - rect.left,
          event.clientY - rect.top
        );
        if (marker) {
          p.onInteriorWallSelect?.(null);
          p.onItemSelect(marker.item.id, 'replace');
          return;
        }
      }
      const hit = hitTest2DItems(p.activeFloor.items, world.x, world.z, hitSlopWorld(fit));
      const wallSlop = hitSlopWorld(fit, event.pointerType === 'touch' ? WALL_HIT_SLOP_TOUCH_PX : WALL_HIT_SLOP_PX);
      const wall = hit || p.exploring ? null : hitInteriorWall(p.activeFloor.interiorWalls ?? [], world.x, world.z, wallSlop);
      if (!hit && !wall) {
        // Empty floor: the release decides (a tap clears the selection, a
        // drag on a zoomed plan pans and keeps it, #678).
        const at = local(event);
        pan = { pointerId: event.pointerId, last: at, down: at, threshold: dragThresholdPx(event.pointerType), started: false, tapBefore, touch: event.pointerType === 'touch' };
        return;
      }
      if (!hit && wall) {
        p.onDeselect();
        // The panel a new selection opens refits the plan. On a press that
        // also holds the wall the fit is frozen till the release, so the wall
        // stays under the pointer.
        const fresh = wall !== null && wall.id !== p.selectedWallId;
        const slide = wall && p.onWallGrab?.({ wallId: wall.id, grip: 'body', x: world.x, z: world.z, fresh });
        // The side of the line the press landed on is the face to paint (#720).
        const side = wall ? wallSideAt(wall, world) : null;
        if (slide && fresh && wall && side) {
          // Selected at the release, under a finger that is done (#786).
          holdWall(slide, event, { id: wall.id, side });
          return;
        }
        if (side) p.onInteriorWallSelect?.(wall.id, side);
        if (slide) holdWall(slide, event);
        return;
      }
      if (!hit) return;
      p.onInteriorWallSelect?.(null);
      const mode = event.altKey ? 'single' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
      const locked = hit.locked === true;
      // A plain press on a member of a multi-selection keeps it, so the drag
      // moves the whole set (#291) — mirrors the 3D canvas (drag-handlers).
      // In EXPLORE there is no drag to keep it for: the press selects.
      const keepSelection = !locked && !p.exploring && keepsSelectionOnPress(mode, hit.id, p.allSelectedIds);
      if (!keepSelection) p.onItemSelect(hit.id, mode);
      // Locked items select but never drag; a toggle click is selection
      // surgery, not a move — both mirror the 3D canvas (drag-handlers).
      // EXPLORE selects only (#699).
      if (locked && mode === 'replace' && !p.exploring) {
        lockedPress = { id: hit.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, threshold: dragThresholdPx(event.pointerType) };
      }
      if (locked || mode === 'toggle' || p.exploring) return;
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

    // Tracked here: the placement ghost owns the canvas cursor outside zone mode.
    let zoneCursor = '';
    const setZoneCursor = (cursor: string): void => {
      if (cursor === zoneCursor) return;
      zoneCursor = cursor;
      canvas.style.cursor = cursor;
    };

    /** A mouse over the selected zone shows what a press there would do. */
    const showZoneCursor = (event: PointerEvent): void => {
      const p = paramsRef.current;
      const selected = p.view.drawZoneMode ? p.activeFloor.zones?.find((zone) => zone.id === p.selectedZoneId) : undefined;
      const hoverFit = selected ? measureFit(canvas) : null;
      const world = hoverFit && toWorld(event.clientX, event.clientY, hoverFit);
      const grip = selected && hoverFit && world ? zoneGripAt(selected, world.x, world.z, hitSlopWorld(hoverFit, ZONE_GRIP_SLOP_PX)) : null;
      if (grip) {
        setZoneCursor(ZONE_GRIP_CURSORS[grip]);
        return;
      }
      // Likewise the selected wall: its ends take the press, its body slides (#718).
      const wall = p.exploring ? undefined : p.activeFloor.interiorWalls?.find((entry) => entry.id === p.selectedWallId);
      const wallFit = wall ? measureFit(canvas) : null;
      const at = wallFit && toWorld(event.clientX, event.clientY, wallFit);
      const near = wall && wallFit && at ? hitInteriorWall([wall], at.x, at.z, hitSlopWorld(wallFit, WALL_HIT_SLOP_PX)) : null;
      setZoneCursor(near ? 'move' : '');
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (touches.has(event.pointerId)) touches.set(event.pointerId, local(event));
      if (imageDrag && event.pointerId === imageDrag.pointerId) {
        const world = worldAt(event);
        if (world) {
          imageDrag.latest = movedFloorPlan(imageDrag.from, world.x - imageDrag.start.x, world.z - imageDrag.start.z);
          schedulePaint();
        }
        return;
      }
      if (pinch) {
        const a = touches.get(pinch.a);
        const b = touches.get(pinch.b);
        if (a && b && (event.pointerId === pinch.a || event.pointerId === pinch.b)) {
          setPlanZoom(canvas, pinchPlan(fitted(), pinch.start, pinch.from, { a, b }, size()));
        }
        return;
      }
      if (pan && event.pointerId === pan.pointerId) {
        const at = local(event);
        if (!pan.started) {
          // At the fit there is nothing to pan: the release is still a tap.
          if (planZoomOf(canvas).zoom === 1) return;
          if (Math.hypot(at.x - pan.down.x, at.y - pan.down.y) < pan.threshold) return;
          pan.started = true;
          try {
            canvas.setPointerCapture(event.pointerId);
          } catch {
            // Capture can throw if the pointer is already gone; safe to ignore.
          }
        }
        const zoom = panPlan(fitted(), planZoomOf(canvas), at.x - pan.last.x, at.y - pan.last.y, size());
        pan.last = at;
        setPlanZoom(canvas, zoom);
        return;
      }
      const hold = wallHold;
      if (hold && event.pointerId === hold.pointerId) {
        if (!hold.started) {
          const dx = event.clientX - hold.downClientX;
          const dy = event.clientY - hold.downClientY;
          if (dx * dx + dy * dy < hold.threshold * hold.threshold) return;
          hold.started = true;
          try {
            canvas.setPointerCapture(event.pointerId);
          } catch {
            // Capture can throw if the pointer is already gone; safe to ignore.
          }
        }
        // Over the HUD the wall holds; a release there calls it off (#511).
        if (!pointerOnCanvas(canvas, event.clientX, event.clientY)) return;
        const world = worldAt(event);
        if (!world) return;
        hold.gesture.move(world.x, world.z, event.shiftKey);
        schedulePaint();
        return;
      }
      if (wallPress ? event.pointerId === wallPress.pointerId : paramsRef.current.view.drawWallMode && !paramsRef.current.exploring) {
        if (!pointerOnCanvas(canvas, event.clientX, event.clientY)) return;
        // Between presses nothing measured the fit: read it now.
        const world = wallPress ? worldAt(event) : toWorld(event.clientX, event.clientY, measureFit(canvas));
        if (world) paramsRef.current.onWallPointerMove?.(world.x, world.z);
        return;
      }
      const edit = zoneEdit;
      if (edit && event.pointerId === edit.pointerId) {
        if (!edit.started) {
          const dx = event.clientX - edit.downClientX;
          const dy = event.clientY - edit.downClientY;
          if (dx * dx + dy * dy < edit.threshold * edit.threshold) return;
          edit.started = true;
          try {
            canvas.setPointerCapture(event.pointerId);
          } catch {
            // Capture can throw if the pointer is already gone; safe to ignore.
          }
        }
        // Over the HUD the zone holds; a release there calls it off (#511).
        if (!pointerOnCanvas(canvas, event.clientX, event.clientY)) return;
        const world = worldAt(event);
        if (!world) return;
        const { layout } = paramsRef.current;
        const rect = draggedZoneRect(edit.origin, edit.grip, world.x - edit.grabbedAt.x, world.z - edit.grabbedAt.z, layout.width, layout.height, edit.recess, layout.cutout);
        edit.overPorch = rect === null && edit.recess !== null;
        if (rect) edit.latest = rect;
        schedulePaint();
        return;
      }
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
        const world = worldAt(event);
        if (!world) return;
        zone.latest = world;
        schedulePaint();
        return;
      }
      if (lockedPress?.pointerId === event.pointerId) {
        const { id, x, y, threshold } = lockedPress;
        const dx = event.clientX - x;
        const dy = event.clientY - y;
        if (dx * dx + dy * dy >= threshold * threshold) {
          lockedPress = null;
          paramsRef.current.onLockedDrag?.(id);
        }
        return;
      }
      const session = gesture;
      if (!session) showZoneCursor(event);
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
      // Over the HUD the item holds its last place on the plan; a release
      // there undoes the drag (endGesture, #511).
      if (!pointerOnCanvas(canvas, event.clientX, event.clientY)) return;
      const world = worldAt(event);
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

    /** A pointer of the view's own gestures lifted or was taken away. True if it was one of theirs. */
    const endViewGesture = (event: PointerEvent): boolean => {
      touches.delete(event.pointerId);
      if (pinch) {
        if (event.pointerId === pinch.a || event.pointerId === pinch.b) pinch = null;
        return true;
      }
      if (pan && event.pointerId === pan.pointerId) {
        const press = pan;
        pan = null;
        releaseCapture(press.pointerId);
        // A cancelled press changes nothing.
        if (press.started || event.type !== 'pointerup') return true;
        if (!press.calibrating) {
          tapEmptyFloor(press, event);
          return true;
        }
        // A calibration point is a tap (#726): placed where it lifts, and only
        // if it stayed put, so a pan or a pinch never drops one.
        const at = local(event);
        const world = Math.hypot(at.x - press.down.x, at.y - press.down.y) <= TAP_SLOP_PX ? worldAt(event) : null;
        if (world && !paramsRef.current.exploring) addCalibrationPoint(world);
        return true;
      }
      return false;
    };

    const endGesture = (event: PointerEvent): void => {
      if (imageDrag && event.pointerId === imageDrag.pointerId) {
        touches.delete(event.pointerId);
        // Let go over the HUD, or cancelled: the image goes back.
        endImageDrag(event.type === 'pointerup' && pointerOnCanvas(canvas, event.clientX, event.clientY));
        return;
      }
      if (endViewGesture(event)) return;
      lockedPress = null;
      if (wallHold && event.pointerId === wallHold.pointerId) {
        const { gesture: wallGesture, started, select } = wallHold;
        wallHold = null;
        // Before the gesture ends: the move it commits keeps the wall selected.
        if (select && event.type === 'pointerup') paramsRef.current.onInteriorWallSelect?.(select.id, select.side);
        releaseCapture(event.pointerId);
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        const commit = started && event.type === 'pointerup' && pointerOnCanvas(canvas, event.clientX, event.clientY);
        wallGesture.end(commit);
        // Called off, or refused: no state change repaints.
        if (started) schedulePaint();
        return;
      }
      if (wallPress && event.pointerId === wallPress.pointerId) {
        wallPress = null;
        releaseCapture(event.pointerId);
        // Released over the HUD: no place on the floor, so no point (#511).
        if (!pointerOnCanvas(canvas, event.clientX, event.clientY)) {
          paramsRef.current.onWallPressCancel?.();
          return;
        }
        const world = worldAt(event);
        if (world && paramsRef.current.view.drawWallMode) paramsRef.current.onWallPoint?.(world.x, world.z);
        return;
      }
      if (zoneEdit && event.pointerId === zoneEdit.pointerId) {
        const edit = zoneEdit;
        // A release over the HUD, or after Esc left zone mode, changes nothing.
        const onPlan = pointerOnCanvas(canvas, event.clientX, event.clientY);
        finishZoneEdit(edit, event.type === 'pointerup' && onPlan && paramsRef.current.view.drawZoneMode);
        return;
      }
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
      // Released over the HUD or off the plan: the drop has no place on the
      // floor, so the drag is undone, not committed (#511).
      if (session.started && !pointerOnCanvas(canvas, event.clientX, event.clientY)) {
        abortGesture(true);
        return;
      }
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
      if (imageDrag && event.pointerId === imageDrag.pointerId) {
        touches.delete(event.pointerId);
        endImageDrag(false);
        return;
      }
      if (endViewGesture(event)) return;
      lockedPress = null;
      if (wallPress && event.pointerId === wallPress.pointerId) {
        abortGesture();
        return;
      }
      // A zone draft or edit is discarded by endGesture (it checks the event type).
      if ((zoneGesture ?? zoneEdit ?? wallHold)?.pointerId === event.pointerId) {
        endGesture(event);
        return;
      }
      // The browser took the pointer mid-drag (OS gesture, palm rejection):
      // undo the drag instead of committing and locking it (#292).
      if (gesture && event.pointerId === gesture.pointerId) abortGesture(true);
    };

    const onPointerLeave = (event: PointerEvent): void => {
      // Only the pointer that left counts: a mouse the page thinks is over
      // the plan leaves it when a sheet opens there, mid-touch (#786).
      const own = (held: { pointerId: number } | null): boolean => held !== null && held.pointerId === event.pointerId;
      if (lockedPress?.pointerId === event.pointerId) lockedPress = null;
      // A started drag holds pointer capture and stays alive off-canvas;
      // only an armed-but-unstarted gesture is abandoned here.
      if (own(gesture) && !gesture!.started) gesture = null;
      if (own(zoneGesture) && !zoneGesture!.started) zoneGesture = null;
      if (own(zoneEdit) && !zoneEdit!.started) zoneEdit = null;
      if (own(pan) && !pan!.started) {
        // The press still landed on empty floor.
        const press = pan!;
        pan = null;
        tapEmptyFloor(press, event);
      }
      if (own(wallHold) && !wallHold!.started) {
        const { select } = wallHold!;
        wallHold!.gesture.end(false);
        wallHold = null;
        // The press still picked the wall.
        if (select) paramsRef.current.onInteriorWallSelect?.(select.id, select.side);
      }
      if (!zoneEdit?.started) setZoneCursor('');
      if (!wallPress && paramsRef.current.view.drawWallMode) paramsRef.current.onWallPointerLeave?.();
    };

    // The gesture flag (no text selection, frozen insets; PLAN_GESTURE_ATTR)
    // follows the gesture state after every event.
    const root = document.documentElement;
    const syncGestureFlag = (): void => {
      root.toggleAttribute(PLAN_GESTURE_ATTR, houseGestureHeld() || imageDrag !== null || pinch !== null || pan?.started === true);
    };
    const synced = (handler: (event: PointerEvent) => void) => (event: PointerEvent): void => {
      handler(event);
      syncGestureFlag();
    };
    const onDown = synced(onPointerDown);
    // A no-op toggle while nothing changes; catches the orphan abort.
    const onMove = synced(onPointerMove);
    const onUp = synced(endGesture);
    const onCancel = synced(onPointerCancel);
    const onLeave = synced(onPointerLeave);

    // A pointerup the page never sees (the window lost focus mid-drag, the
    // capture was taken away) must not leave the gesture armed: page-wide
    // text selection would stay off and the fit frozen. Undo the drag.
    const onLost = (): void => {
      touches.clear();
      pinch = null;
      pan = null;
      endImageDrag(false);
      if (houseGestureHeld()) abortGesture(true);
      syncGestureFlag();
    };
    const onLostCapture = (event: PointerEvent): void => {
      const held = gesture ?? zoneGesture ?? wallPress ?? zoneEdit ?? wallHold ?? pan ?? imageDrag;
      if (held && held.pointerId === event.pointerId) onLost();
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (houseGestureHeld() || imageDrag || pinch || pan) return;
      const at = local(event);
      // Lines scroll in rows of about 16 px.
      const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      fit = measureFit(canvas);
      setPlanZoom(canvas, zoomPlanAbout(fitted(), planZoomOf(canvas), Math.exp(-pixels * WHEEL_ZOOM_PER_PX), at, size()));
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('lostpointercapture', onLostCapture);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('blur', onLost);

    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('lostpointercapture', onLostCapture);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('blur', onLost);
      // The zoom is the visit's: back in the plan, it is fitted again.
      setPlanZoom(canvas, NO_PLAN_ZOOM);
      // Disabled (view switch) or unmounted mid-drag: discard the session so
      // nothing stale is committed on a later pointerup.
      imageDrag = null;
      abortGesture();
      setZoneCursor('');
      syncGestureFlag();
    };
  }, [params.enabled, params.canvasRef, toWorld, measureFit, hitSlopWorld, layoutActions]);

  const repaintPlan = useCallback(() => repaintRef.current(), []);
  return { clientToWorld2D, repaintPlan };
}
