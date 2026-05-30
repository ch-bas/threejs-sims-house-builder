import type { FurnitureItem, Vec2 } from './types';

export type AlignEdge = 'min-x' | 'center-x' | 'max-x' | 'min-z' | 'center-z' | 'max-z';
export type DistributeAxis = 'x' | 'z';

interface ItemBounds {
  id: string;
  centerX: number;
  centerZ: number;
  halfWidth: number;
  halfDepth: number;
}

function rotatedExtents(rotation: number): { cos: number; sin: number } {
  return { cos: Math.abs(Math.cos(rotation)), sin: Math.abs(Math.sin(rotation)) };
}

function bounds(item: FurnitureItem): ItemBounds | null {
  if (!item.position) return null;
  const { cos, sin } = rotatedExtents(item.rotation ?? 0);
  return {
    id: item.id,
    centerX: item.position.x,
    centerZ: item.position.z,
    halfWidth: (item.width * cos + item.depth * sin) / 2,
    halfDepth: (item.width * sin + item.depth * cos) / 2,
  };
}

/**
 * Align the selection along the requested edge. Returns a map of id → new
 * position. Items without a position are skipped.
 */
export function alignSelection(
  items: readonly FurnitureItem[],
  selectedIds: ReadonlySet<string>,
  edge: AlignEdge
): Map<string, Vec2> {
  const targets = items.filter((item) => selectedIds.has(item.id)).map(bounds).filter(notNull);
  if (targets.length < 2) return new Map();

  let anchorX = 0;
  let anchorZ = 0;
  switch (edge) {
    case 'min-x':
      anchorX = Math.min(...targets.map((t) => t.centerX - t.halfWidth));
      break;
    case 'max-x':
      anchorX = Math.max(...targets.map((t) => t.centerX + t.halfWidth));
      break;
    case 'center-x':
      anchorX = average(targets.map((t) => t.centerX));
      break;
    case 'min-z':
      anchorZ = Math.min(...targets.map((t) => t.centerZ - t.halfDepth));
      break;
    case 'max-z':
      anchorZ = Math.max(...targets.map((t) => t.centerZ + t.halfDepth));
      break;
    case 'center-z':
      anchorZ = average(targets.map((t) => t.centerZ));
      break;
  }

  const result = new Map<string, Vec2>();
  for (const target of targets) {
    let x = target.centerX;
    let z = target.centerZ;
    switch (edge) {
      case 'min-x':
        x = anchorX + target.halfWidth;
        break;
      case 'max-x':
        x = anchorX - target.halfWidth;
        break;
      case 'center-x':
        x = anchorX;
        break;
      case 'min-z':
        z = anchorZ + target.halfDepth;
        break;
      case 'max-z':
        z = anchorZ - target.halfDepth;
        break;
      case 'center-z':
        z = anchorZ;
        break;
    }
    result.set(target.id, { x, z });
  }
  return result;
}

/**
 * Distribute the selection evenly along the chosen axis. The leftmost and
 * rightmost items keep their positions; everything in between is spaced so
 * the gaps between successive centres are equal.
 */
export function distributeSelection(
  items: readonly FurnitureItem[],
  selectedIds: ReadonlySet<string>,
  axis: DistributeAxis
): Map<string, Vec2> {
  const targets = items
    .filter((item) => selectedIds.has(item.id))
    .map(bounds)
    .filter(notNull);
  if (targets.length < 3) return new Map();

  const sorted = [...targets].sort((a, b) =>
    axis === 'x' ? a.centerX - b.centerX : a.centerZ - b.centerZ
  );

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const startValue = axis === 'x' ? first.centerX : first.centerZ;
  const endValue = axis === 'x' ? last.centerX : last.centerZ;
  const step = (endValue - startValue) / (sorted.length - 1);

  const result = new Map<string, Vec2>();
  sorted.forEach((target, index) => {
    if (index === 0 || index === sorted.length - 1) return;
    const next = startValue + step * index;
    result.set(target.id, {
      x: axis === 'x' ? next : target.centerX,
      z: axis === 'z' ? next : target.centerZ,
    });
  });
  return result;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}
