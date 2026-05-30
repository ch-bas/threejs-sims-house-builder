import type { FurnitureItem, Vec2 } from './types';

export function boundingRadius(item: Pick<FurnitureItem, 'width' | 'depth'>): number {
  return Math.hypot(item.width / 2, item.depth / 2);
}

export function itemsOverlap(a: FurnitureItem, b: FurnitureItem): boolean {
  if (!a.position || !b.position) return false;
  const distance = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
  return distance < boundingRadius(a) + boundingRadius(b);
}

export function itemInBounds(item: FurnitureItem, roomWidth: number, roomDepth: number): boolean {
  if (!item.position) return false;
  const halfW = item.width / 2;
  const halfD = item.depth / 2;
  return (
    item.position.x - halfW >= -roomWidth / 2 &&
    item.position.x + halfW <= roomWidth / 2 &&
    item.position.z - halfD >= -roomDepth / 2 &&
    item.position.z + halfD <= roomDepth / 2
  );
}

export function hasCollisions(
  item: FurnitureItem,
  allItems: readonly FurnitureItem[],
  roomWidth: number,
  roomDepth: number
): boolean {
  if (!item.position) return false;
  if (!itemInBounds(item, roomWidth, roomDepth)) return true;
  return allItems.some((other) => other.id !== item.id && itemsOverlap(item, other));
}

export type AutoOrganizeStrategy = 'shelf' | 'by-category' | 'by-size';

export function autoOrganize(
  items: readonly FurnitureItem[],
  roomWidth: number,
  roomDepth: number,
  strategy: AutoOrganizeStrategy = 'shelf',
  margin = 0.3
): FurnitureItem[] {
  if (items.length === 0) return [];

  const ordered = orderItemsForStrategy(items, strategy);
  const organized: FurnitureItem[] = [];
  let cursorX = -roomWidth / 2 + margin;
  let cursorZ = -roomDepth / 2 + margin;
  let rowMaxDepth = 0;

  for (const item of ordered) {
    if (cursorX + item.width + margin > roomWidth / 2) {
      cursorX = -roomWidth / 2 + margin;
      cursorZ += rowMaxDepth + margin;
      rowMaxDepth = 0;
    }

    const fits = cursorZ + item.depth + margin <= roomDepth / 2;
    organized.push({
      ...item,
      position: fits ? { x: cursorX + item.width / 2, z: cursorZ + item.depth / 2 } : { x: 0, z: 0 },
      rotation: 0,
    });

    if (fits) {
      cursorX += item.width + margin;
      rowMaxDepth = Math.max(rowMaxDepth, item.depth);
    }
  }

  return organized;
}

function orderItemsForStrategy(items: readonly FurnitureItem[], strategy: AutoOrganizeStrategy): readonly FurnitureItem[] {
  if (strategy === 'shelf') return items;

  if (strategy === 'by-size') {
    return [...items].sort((a, b) => b.width * b.depth - a.width * a.depth);
  }

  // by-category: cluster items with the same category together.
  return [...items].sort((a, b) => (a.category ?? 'zzz').localeCompare(b.category ?? 'zzz'));
}

export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

export interface SnapToWallOptions {
  position: Vec2;
  item: Pick<FurnitureItem, 'width' | 'depth' | 'rotation'>;
  roomWidth: number;
  roomDepth: number;
  /** Maximum distance (m) from the wall at which snapping is applied. */
  threshold?: number;
}

/**
 * Snap a position to the nearest wall when within `threshold`. Returns the
 * adjusted position. Considers the item's axis-aligned half-extent only —
 * rotated bounds are handled with a conservative bounding box.
 */
export function snapToWall({
  position,
  item,
  roomWidth,
  roomDepth,
  threshold = 0.35,
}: SnapToWallOptions): Vec2 {
  const cos = Math.abs(Math.cos(item.rotation ?? 0));
  const sin = Math.abs(Math.sin(item.rotation ?? 0));
  const halfW = (item.width * cos + item.depth * sin) / 2;
  const halfD = (item.width * sin + item.depth * cos) / 2;

  const minX = -roomWidth / 2 + halfW;
  const maxX = roomWidth / 2 - halfW;
  const minZ = -roomDepth / 2 + halfD;
  const maxZ = roomDepth / 2 - halfD;

  let { x, z } = position;
  if (x - minX < threshold) x = minX;
  else if (maxX - x < threshold) x = maxX;
  if (z - minZ < threshold) z = minZ;
  else if (maxZ - z < threshold) z = maxZ;

  return { x, z };
}

export function totalCost(items: readonly FurnitureItem[]): number {
  return items.reduce((sum, item) => sum + (item.price ?? 0), 0);
}

export function footprintArea(items: readonly FurnitureItem[]): number {
  return items.reduce((sum, item) => sum + item.width * item.depth, 0);
}

export function itemCountByCategory(items: readonly FurnitureItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.category ?? 'uncategorized';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface SnapToNeighborOptions {
  position: Vec2;
  movingItem: Pick<FurnitureItem, 'id' | 'width' | 'depth' | 'rotation'>;
  otherItems: readonly FurnitureItem[];
  threshold?: number;
}

/**
 * Snap a candidate position so that the moving item's edges or centers align
 * with the nearest neighbor's edges or centers (within `threshold`). Returns
 * the adjusted position. Works in rotated-bounding-box space.
 */
export function snapToNeighbors({
  position,
  movingItem,
  otherItems,
  threshold = 0.2,
}: SnapToNeighborOptions): Vec2 {
  const { cosAbs, sinAbs } = rotatedExtents(movingItem.rotation ?? 0);
  const halfW = (movingItem.width * cosAbs + movingItem.depth * sinAbs) / 2;
  const halfD = (movingItem.width * sinAbs + movingItem.depth * cosAbs) / 2;

  let bestX = position.x;
  let bestZ = position.z;
  let bestXDelta = threshold;
  let bestZDelta = threshold;

  for (const other of otherItems) {
    if (other.id === movingItem.id || !other.position) continue;
    const otherExtents = rotatedExtents(other.rotation ?? 0);
    const otherHalfW = (other.width * otherExtents.cosAbs + other.depth * otherExtents.sinAbs) / 2;
    const otherHalfD = (other.width * otherExtents.sinAbs + other.depth * otherExtents.cosAbs) / 2;

    const candidatesX = [
      other.position.x,
      other.position.x - otherHalfW + halfW,
      other.position.x + otherHalfW - halfW,
      other.position.x - otherHalfW - halfW,
      other.position.x + otherHalfW + halfW,
    ];
    const candidatesZ = [
      other.position.z,
      other.position.z - otherHalfD + halfD,
      other.position.z + otherHalfD - halfD,
      other.position.z - otherHalfD - halfD,
      other.position.z + otherHalfD + halfD,
    ];

    for (const cx of candidatesX) {
      const delta = Math.abs(cx - position.x);
      if (delta < bestXDelta) {
        bestXDelta = delta;
        bestX = cx;
      }
    }
    for (const cz of candidatesZ) {
      const delta = Math.abs(cz - position.z);
      if (delta < bestZDelta) {
        bestZDelta = delta;
        bestZ = cz;
      }
    }
  }

  return { x: bestX, z: bestZ };
}

function rotatedExtents(rotation: number): { cosAbs: number; sinAbs: number } {
  return { cosAbs: Math.abs(Math.cos(rotation)), sinAbs: Math.abs(Math.sin(rotation)) };
}
