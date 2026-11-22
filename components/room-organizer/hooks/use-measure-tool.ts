import { useCallback, useEffect, useRef, useState } from 'react';
import { announce } from '../lib/announce';
import { notifyRefused, notifyWithUndo, type RefusedCue } from '../lib/editor-notices';
import { formatMetres } from '../lib/format';
import { snapMeasurePoint, type MeasureSnap } from '../lib/measure-snap';
import { MAX_DIMENSIONS_PER_FLOOR, MIN_DIMENSION_LENGTH, defaultPinOffset, dimensionLength } from '../lib/plan-dimensions';
import { layoutStore } from './use-layout-store';
import type { LayoutActions } from './use-layout-state';
import type { FloorLayout, RoomLayout, Vec2 } from '../lib/types';

/** How far (metres) a point clicked on the 3D floor reaches to catch on something (#921). */
export const MEASURE_SNAP_3D_M = 0.15;

export interface UseMeasureToolParams {
  layout: RoomLayout;
  activeFloor: FloorLayout;
  activeFloorIndex: number;
  measurementMode: boolean;
  actions: Pick<LayoutActions, 'addDimension' | 'removeDimension'>;
  /** History's undo, for the Undo on an unpin's notice. */
  undo(): void;
  /** The 2D plan shows: pins are seen, picked and made there only. */
  planShown: boolean;
  playCue: RefusedCue;
}

export interface MeasureTool {
  /** The points placed: none, the first, or both. Floor-plane metres. */
  points: readonly Vec2[];
  /** Where the next point would land under the mouse on the plan, snapped. */
  tip: MeasureSnap | null;
  /** Place a point the plan already snapped; a third starts over. */
  placePoint(snap: MeasureSnap): void;
  /** Take the last placed point back: the first tap of a finger's double tap, which resets the zoom instead. */
  takeBackPoint(): void;
  /** Place a point clicked on the 3D floor, snapped here. */
  placeFloorPoint(x: number, z: number): void;
  setTip(snap: MeasureSnap | null): void;
  /** The pinned dimension picked on the plan, to unpin (#921). */
  selectedPinId: string | null;
  selectPin(id: string | null): void;
  /** Pin the measurement on the active storey; the points go, the pin stays. */
  pin(): void;
  /** Unpin the picked dimension, with an Undo. */
  unpin(): void;
  /** Forget the points and the pick (a whole-house load). */
  clear(): void;
}

/**
 * The distance tool's state (#341, #921): two points, on the 3D floor or on
 * the plan, each snapped to a corner, an item or a wall, and Pin to keep the
 * measurement on the storey as a dimension (reducer-owned, so undoable).
 * Forgotten when the tool is put away or the storey changes, where the
 * points would float over a floor they weren't measured on (#224).
 */
export function useMeasureTool({ layout, activeFloor, activeFloorIndex, measurementMode, actions, undo, planShown, playCue }: UseMeasureToolParams): MeasureTool {
  const [points, setPoints] = useState<readonly Vec2[]>([]);
  const [tip, setTipState] = useState<MeasureSnap | null>(null);
  // A mouse move that lands on the same snapped point re-renders nothing.
  const setTip = useCallback((next: MeasureSnap | null) => {
    setTipState((current) =>
      current === next || (current && next && current.kind === next.kind && current.point.x === next.point.x && current.point.z === next.point.z) ? current : next
    );
  }, []);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  // The points before the last one placed, for `takeBackPoint`.
  const beforeRef = useRef<readonly Vec2[] | null>(null);
  const placePoint = useCallback((snap: MeasureSnap) => {
    setSelectedPinId(null);
    setPoints((current) => {
      beforeRef.current = current;
      return current.length >= 2 ? [snap.point] : [...current, snap.point];
    });
  }, []);
  const takeBackPoint = useCallback(() => {
    const before = beforeRef.current;
    beforeRef.current = null;
    if (before) setPoints(before);
  }, []);

  const placeFloorPoint = useCallback(
    (x: number, z: number) => {
      placePoint(snapMeasurePoint({ x, z }, { floor: activeFloor, building: layout, reach: MEASURE_SNAP_3D_M }));
    },
    [placePoint, activeFloor, layout]
  );

  const selectPin = useCallback((id: string | null) => {
    setSelectedPinId(id);
    if (id !== null) setPoints([]);
  }, []);

  const pin = useCallback(() => {
    const [a, b] = points;
    if (!planShown || !a || !b || dimensionLength({ a, b }) < MIN_DIMENSION_LENGTH) return;
    // The line stands off the points, clear of the edges they snapped to.
    const id = actions.addDimension({ a, b, offset: defaultPinOffset(a, b) });
    const { layout: after, activeFloorIndex: index } = layoutStore.getState();
    const pinned = after.floors[index]?.dimensions ?? [];
    if (!pinned.some((entry) => entry.id === id)) {
      // Refused: the measurement stays, to try again.
      notifyRefused(
        pinned.length >= MAX_DIMENSIONS_PER_FLOOR ? `A floor keeps at most ${MAX_DIMENSIONS_PER_FLOOR} pinned dimensions: unpin one first.` : 'That measurement can’t be pinned.',
        playCue
      );
      return;
    }
    setPoints([]);
    // A string outside React: the display unit's mirror (lib/format).
    announce(`Pinned ${formatMetres(dimensionLength({ a, b }), 2)} on the plan`);
  }, [points, actions, planShown, playCue]);

  const unpin = useCallback(() => {
    if (selectedPinId === null) return;
    actions.removeDimension(selectedPinId);
    setSelectedPinId(null);
    notifyWithUndo('Dimension unpinned.', { current: () => layoutStore.getState().layout, undo });
  }, [selectedPinId, actions, undo]);

  const clear = useCallback(() => {
    setPoints([]);
    setTipState(null);
    setSelectedPinId(null);
  }, []);

  useEffect(() => {
    clear();
  }, [activeFloorIndex, activeFloor.id, clear]);

  useEffect(() => {
    if (!measurementMode) clear();
  }, [measurementMode, clear]);

  // Pins are picked on the plan: leaving it lets go of the pick.
  useEffect(() => {
    if (!planShown) setSelectedPinId(null);
  }, [planShown]);

  // A pin taken away by undo or a load is no longer picked.
  useEffect(() => {
    if (selectedPinId !== null && !activeFloor.dimensions?.some((entry) => entry.id === selectedPinId)) setSelectedPinId(null);
  }, [selectedPinId, activeFloor.dimensions]);

  return { points, tip, placePoint, takeBackPoint, placeFloorPoint, setTip, selectedPinId, selectPin, pin, unpin, clear };
}
