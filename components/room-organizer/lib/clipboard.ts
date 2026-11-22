/**
 * In-memory furniture clipboard (#153). Copy normalizes the selection around
 * its centroid; paste rebuilds the arrangement around a target point with
 * fresh ids, clamped to the room, wall-mounted items settled back onto walls
 * via the shared settle rule. Module-level state: survives floor switches
 * (cross-floor paste is the point) but not a reload — deliberate MVP scope.
 */

import { clampToFootprint } from './footprint';
import { remapGroupIds } from './groups';
import { settleWallMountedItem } from './opening-snap';
import type { RoomArrangement } from './room-transfer';
import type { FootprintCutout, FurnitureItem, InteriorWall, Vec2 } from './types';

export interface CentroidArrangement {
  /** Deep copies with `position` rewritten as the offset from the centroid. */
  readonly items: readonly FurnitureItem[];
  /** Where the selection was copied from — the default paste lands nearby. */
  readonly sourceCentroid: Vec2;
}

/**
 * Normalise an arrangement around its centroid — the shape both the
 * clipboard and a saved custom set (#302) store. Unplaced items are
 * skipped; returns null when nothing is placed.
 */
export function arrangeAroundCentroid(items: readonly FurnitureItem[]): CentroidArrangement | null {
  const positioned = items.filter((item) => item.position);
  if (positioned.length === 0) return null;
  const cx = positioned.reduce((sum, item) => sum + item.position!.x, 0) / positioned.length;
  const cz = positioned.reduce((sum, item) => sum + item.position!.z, 0) / positioned.length;
  return {
    sourceCentroid: { x: cx, z: cz },
    items: positioned.map((item) => ({
      ...structuredClone(item),
      position: { x: item.position!.x - cx, z: item.position!.z - cz },
    })),
  };
}

let content: CentroidArrangement | null = null;
/** A copied room (#925): its walls, items and zones. One clipboard: the last copy wins. */
let room: RoomArrangement | null = null;
const listeners = new Set<() => void>();

/** Tell whoever shows a Paste button that the clipboard changed. */
function changed(): void {
  for (const listener of listeners) listener();
}

/** Called on every copy and clear (#925): a Paste room button follows the clipboard. Returns the unsubscribe. */
export function subscribeClipboard(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Copy the given items. Returns how many were copied (0 leaves the clipboard untouched). */
export function copyToClipboard(items: readonly FurnitureItem[]): number {
  const arranged = arrangeAroundCentroid(items);
  if (!arranged) return 0;
  content = arranged;
  const hadRoom = room !== null;
  room = null;
  if (hadRoom) changed();
  return arranged.items.length;
}

/** Copy a room with its walls (#925); a paste of items then has nothing to paste. */
export function copyRoomToClipboard(arrangement: RoomArrangement): void {
  room = structuredClone(arrangement);
  content = null;
  changed();
}

/** The room on the clipboard, if the last copy was one. */
export function roomOnClipboard(): RoomArrangement | null {
  return room;
}

export function clipboardSize(): number {
  return content?.items.length ?? 0;
}

/** Test hook: reset module state between cases. */
export function clearClipboard(): void {
  content = null;
  room = null;
  changed();
}

export interface PasteOptions {
  roomWidth: number;
  roomDepth: number;
  interiorWalls?: readonly InteriorWall[];
  /** The corner cut out of the building (#727). */
  cutout?: FootprintCutout | undefined;
  /** Unique tag mixed into the pasted ids (caller supplies randomness — keeps this pure). */
  idTag: string;
  /**
   * Paste centre. Defaults to the copy centroid shifted +0.5/+0.5 so a
   * same-floor paste lands visibly beside the original.
   */
  target?: Vec2;
  /**
   * The floor the paste lands on (0 = ground, the default). Outdoor items
   * are dropped above the ground floor, matching catalog placement (#293).
   */
  floorIndex?: number;
}

/**
 * Build the items a paste would add (the caller dispatches `addItems` and
 * selects them). Returns [] when the clipboard is empty.
 *
 * Placement rules mirror duplication (#116): wall-mounted copies settle onto
 * the nearest wall, indoor copies clamp inside the footprint, outdoor copies
 * keep their raw offset (they belong outside) and are left out of a paste
 * onto an upper floor, where they would float past its walls (#293). `locked` is stripped so a
 * fresh paste is immediately movable. Groups (#154) are remapped to fresh
 * ids, so a pasted group is a new group rather than more members of the
 * source.
 */
export function buildPasteItems(options: PasteOptions): FurnitureItem[] {
  if (!content) return [];
  const { roomWidth, roomDepth, idTag, cutout } = options;
  const interiorWalls = options.interiorWalls ?? [];
  const target = options.target ?? {
    x: content.sourceCentroid.x + 0.5,
    z: content.sourceCentroid.z + 0.5,
  };

  const upperFloor = (options.floorIndex ?? 0) > 0;
  const entries = upperFloor ? content.items.filter((entry) => entry.category !== 'outdoor') : content.items;

  return remapGroupIds(entries, `paste-${idTag}`).map((entry, index) => {
    const copy: FurnitureItem = {
      ...structuredClone(entry),
      id: `${entry.type}-paste-${idTag}-${index}`,
      position: { x: target.x + entry.position!.x, z: target.z + entry.position!.z },
    };
    delete copy.locked;

    const settled = settleWallMountedItem(copy, copy.position!, roomWidth, roomDepth, interiorWalls, null, cutout);
    if (settled) return { ...copy, ...settled };
    if (copy.category === 'outdoor') return copy;

    copy.position = clampToFootprint(copy, copy.position!, roomWidth, roomDepth, cutout);
    return copy;
  });
}
