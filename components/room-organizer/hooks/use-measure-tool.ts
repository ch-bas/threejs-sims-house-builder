import { useCallback, useEffect, useRef, useState } from 'react';
import { snapMeasurePoint, type MeasureSnap } from '../lib/measure-snap';
import type { FloorLayout, RoomLayout, Vec2 } from '../lib/types';

/** How far (metres) a point clicked on the 3D floor reaches to catch on something (#921). */
export const MEASURE_SNAP_3D_M = 0.15;

export interface UseMeasureToolParams {
  layout: RoomLayout;
  activeFloor: FloorLayout;
  activeFloorIndex: number;
  measurementMode: boolean;
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
  /** Forget the points (a whole-house load). */
  clear(): void;
}

/**
 * The distance tool's state (#341, #921): two points, on the 3D floor or on
 * the plan, each snapped to a corner, an item or a wall. Forgotten when the
 * tool is put away or the storey changes, where they would float over a
 * floor they weren't measured on (#224).
 */
export function useMeasureTool({ layout, activeFloor, activeFloorIndex, measurementMode }: UseMeasureToolParams): MeasureTool {
  const [points, setPoints] = useState<readonly Vec2[]>([]);
  const [tip, setTipState] = useState<MeasureSnap | null>(null);
  // A mouse move that lands on the same snapped point re-renders nothing.
  const setTip = useCallback((next: MeasureSnap | null) => {
    setTipState((current) =>
      current === next || (current && next && current.kind === next.kind && current.point.x === next.point.x && current.point.z === next.point.z) ? current : next
    );
  }, []);

  // The points before the last one placed, for `takeBackPoint`.
  const beforeRef = useRef<readonly Vec2[] | null>(null);
  const placePoint = useCallback((snap: MeasureSnap) => {
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

  const clear = useCallback(() => {
    setPoints([]);
    setTipState(null);
  }, []);

  useEffect(() => {
    clear();
  }, [activeFloorIndex, activeFloor.id, clear]);

  useEffect(() => {
    if (!measurementMode) clear();
  }, [measurementMode, clear]);

  return { points, tip, placePoint, takeBackPoint, placeFloorPoint, setTip, clear };
}
