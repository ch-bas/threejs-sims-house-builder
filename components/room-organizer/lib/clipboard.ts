/**
 * In-memory furniture clipboard (#153). Copy normalizes the selection around
 * its centroid; paste rebuilds the arrangement around a target point with
 * fresh ids, clamped to the room, wall-mounted items settled back onto walls
 * via the shared settle rule. Module-level state: survives floor switches
 * (cross-floor paste is the point) but not a reload — deliberate MVP scope.
 */

import { rotatedHalfExtents } from './geometry';
import { settleWallMountedItem } from './opening-snap';
import type { FurnitureItem, InteriorWall, Vec2 } from './types';

interface ClipboardContent {
  /** Deep copies with `position` rewritten as the offset from the centroid. */
  readonly items: readonly FurnitureItem[];
  /** Where the selection was copied from — the default paste lands nearby. */
  readonly sourceCentroid: Vec2;
}

let content: ClipboardContent | null = null;

/** Copy the given items. Returns how many were copied (0 leaves the clipboard untouched). */
export function copyToClipboard(items: readonly FurnitureItem[]): number {
  const positioned = items.filter((item) => item.position);
  if (positioned.length === 0) return 0;
  const cx = positioned.reduce((sum, item) => sum + item.position!.x, 0) / positioned.length;
  const cz = positioned.reduce((sum, item) => sum + item.position!.z, 0) / positioned.length;
  content = {
    sourceCentroid: { x: cx, z: cz },
    items: positioned.map((item) => ({
      ...structuredClone(item),
      position: { x: item.position!.x - cx, z: item.position!.z - cz },
    })),
  };
  return positioned.length;
}

export function clipboardSize(): number {
  return content?.items.length ?? 0;
}

/** Test hook: reset module state between cases. */
export function clearClipboard(): void {
  content = null;
}

export interface PasteOptions {
  roomWidth: number;
  roomDepth: number;
  interiorWalls?: readonly InteriorWall[];
  /** Unique tag mixed into the pasted ids (caller supplies randomness — keeps this pure). */
  idTag: string;
  /**
   * Paste centre. Defaults to the copy centroid shifted +0.5/+0.5 so a
   * same-floor paste lands visibly beside the original.
   */
  target?: Vec2;
}

/**
 * Build the items a paste would add (the caller dispatches `addItems` and
 * selects them). Returns [] when the clipboard is empty.
 *
 * Placement rules mirror duplication (#116): wall-mounted copies settle onto
 * the nearest wall, indoor copies clamp inside the footprint, outdoor copies
 * keep their raw offset (they belong outside). `locked` is stripped so a
 * fresh paste is immediately movable.
 */
export function buildPasteItems(options: PasteOptions): FurnitureItem[] {
  if (!content) return [];
  const { roomWidth, roomDepth, idTag } = options;
  const interiorWalls = options.interiorWalls ?? [];
  const target = options.target ?? {
    x: content.sourceCentroid.x + 0.5,
    z: content.sourceCentroid.z + 0.5,
  };

  return content.items.map((entry, index) => {
    const copy: FurnitureItem = {
      ...structuredClone(entry),
      id: `${entry.type}-paste-${idTag}-${index}`,
      position: { x: target.x + entry.position!.x, z: target.z + entry.position!.z },
    };
    delete copy.locked;

    const settled = settleWallMountedItem(copy, copy.position!, roomWidth, roomDepth, interiorWalls);
    if (settled) return { ...copy, ...settled };
    if (copy.category === 'outdoor') return copy;

    const { halfW, halfD } = rotatedHalfExtents(copy);
    const maxX = Math.max(0, roomWidth / 2 - halfW);
    const maxZ = Math.max(0, roomDepth / 2 - halfD);
    copy.position = {
      x: Math.min(maxX, Math.max(-maxX, copy.position!.x)),
      z: Math.min(maxZ, Math.max(-maxZ, copy.position!.z)),
    };
    return copy;
  });
}
