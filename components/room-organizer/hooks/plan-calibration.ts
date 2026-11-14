import { useSyncExternalStore } from 'react';
import type { Vec2 } from '../lib/types';

/**
 * The traced plan's calibration session (#726), in the 2D plan: pick two
 * points on the image, type the length between them, then drag the image
 * into place. The house only changes when a step commits (the reducer's
 * `setFloorPlanTransform`); this store holds what the steps share.
 */
export type CalibrationPhase = 'points' | 'distance' | 'move';

export interface PlanCalibration {
  phase: CalibrationPhase;
  /** The image's size in pixels, decoded when the session starts. */
  image: { width: number; height: number };
  /** World metres, at most two. */
  points: readonly Vec2[];
}

let current: PlanCalibration | null = null;
const listeners = new Set<() => void>();

function emit(next: PlanCalibration | null): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function getPlanCalibration(): PlanCalibration | null {
  return current;
}

/** Start picking points on an image of this size. */
export function startPlanCalibration(image: { width: number; height: number }, phase: CalibrationPhase = 'points'): void {
  emit({ phase, image, points: [] });
}

export function endPlanCalibration(): void {
  emit(null);
}

/** A press on the plan while picking: the second point moves on to the length. */
export function addCalibrationPoint(point: Vec2): void {
  if (!current || current.phase !== 'points') return;
  const points = [...current.points, point].slice(-2);
  emit({ ...current, points, phase: points.length === 2 ? 'distance' : 'points' });
}

export function setCalibrationPhase(phase: CalibrationPhase): void {
  if (!current || current.phase === phase) return;
  // The points mark the length while it's typed; the other steps clear them.
  emit({ ...current, phase, points: phase === 'distance' ? current.points : [] });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePlanCalibration(): PlanCalibration | null {
  return useSyncExternalStore(subscribe, getPlanCalibration, () => null);
}
