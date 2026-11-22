import { useSyncExternalStore } from 'react';
import type { GroundKind } from '../lib/types';

/**
 * The garden-surface tool (#924): which kind a drag on the 2D plan lays, or
 * null when the tool is off. View state, never part of the house; the plan's
 * pointer hook reads it at each press, the Garden panel and the tool's chip
 * switch it. Like the traced plan's calibration (`plan-calibration.ts`), one
 * editor at a time holds it.
 */
let current: GroundKind | null = null;
const listeners = new Set<() => void>();

export function getGroundDrawKind(): GroundKind | null {
  return current;
}

export function setGroundDrawKind(kind: GroundKind | null): void {
  if (kind === current) return;
  current = kind;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGroundDrawKind(): GroundKind | null {
  return useSyncExternalStore(subscribe, getGroundDrawKind, () => null);
}
