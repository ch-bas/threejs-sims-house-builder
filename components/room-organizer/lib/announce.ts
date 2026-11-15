import { isInsideBuilding, rotatedHalfExtents, shellWalls, type FootprintBuilding, type ShellWall } from './footprint';
import { formatMetres } from './format';
import { isWallMounted } from './opening-snap';
import type { EntrancePlanOutline } from './street';
import type { FurnitureItem } from './types';

/**
 * The editor's one screen-reader voice (#929): a polite status line,
 * rendered once by the orchestrator (`panels/announcer.tsx`), that says what
 * a keyboard edit did — where a nudged item went, what Undo took back, which
 * item Tab selected. Notices (refusals, "Removed Sofa") are live regions of
 * their own, so they are not repeated here. Pointer drags stay silent: they
 * are visual.
 */

export interface Announcement {
  /** What the status line says now ('' for nothing). */
  readonly text: string;
  /** Who said it, so its owner can withdraw it (`withdrawAnnouncement`). */
  readonly tag: string | null;
}

/** The same words again this soon are one announcement, not two. */
export const ANNOUNCE_DEDUPE_MS = 1000;

/**
 * A screen reader speaks a live region when its text changes, so the same
 * words said again after the de-dupe window get a trailing no-break space
 * that alternates, and the node changes.
 */
const REPEAT_MARK = '\u00a0';

const EMPTY: Announcement = { text: '', tag: null };
let current: Announcement = EMPTY;
let lastSaid: { text: string; at: number } | null = null;
const listeners = new Set<() => void>();
/** The line a held key is waiting to say (`announceSettled`). */
let pending: ReturnType<typeof setTimeout> | null = null;

function publish(next: Announcement): void {
  current = next;
  for (const listener of listeners) listener();
}

/**
 * Says `text` in the status line, unless it was just said; `always` says it
 * even then (an undo pressed twice took back two steps). Whatever a held
 * key's line was waiting to say (`announceSettled`) is dropped: this is newer.
 */
export function announce(text: string, options: { tag?: string; now?: number; always?: boolean } = {}): void {
  if (pending !== null) clearTimeout(pending);
  pending = null;
  const words = text.trim();
  if (words === '') return;
  const now = options.now ?? performance.now();
  if (!options.always && lastSaid?.text === words && now - lastSaid.at < ANNOUNCE_DEDUPE_MS) return;
  lastSaid = { text: words, at: now };
  const repeat = current.text === words ? `${words}${REPEAT_MARK}` : words;
  publish({ text: repeat, tag: options.tag ?? null });
}

/** A held key's steps settle this long before the line says where they ended. */
export const ANNOUNCE_SETTLE_MS = 250;

/**
 * Says what `words()` returns once the edits stop for `delayMs`: a held
 * arrow nudges thirty times a second, and a reader queueing every step
 * would still be talking long after the key came up. `words` runs at the
 * end, so it reads the house as it is then; an empty result says nothing.
 */
export function announceSettled(words: () => string, options: { tag?: string; delayMs?: number } = {}): void {
  if (pending !== null) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    announce(words(), options.tag === undefined ? {} : { tag: options.tag });
  }, options.delayMs ?? ANNOUNCE_SETTLE_MS);
}

/** Drops the line a held key was waiting to say, if any. */
export function cancelSettledAnnouncement(): void {
  if (pending !== null) clearTimeout(pending);
  pending = null;
}

/** Clears the status line when what it says came from a tag `stale` matches. */
export function withdrawAnnouncement(stale: (tag: string | null) => boolean): void {
  if (current.text === '' || !stale(current.tag)) return;
  lastSaid = null;
  publish(EMPTY);
}

export function currentAnnouncement(): Announcement {
  return current;
}

export function subscribeAnnouncements(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For tests: an empty line and no memory of what was said. */
export function resetAnnouncements(): void {
  cancelSettledAnnouncement();
  lastSaid = null;
  publish(EMPTY);
}

/** What the line needs of the house: its footprint (the L included) and, on this storey, the porch. */
export interface PlacementHouse extends FootprintBuilding {
  /** The recessed entrance on this storey (`entrancePlanOutline`), or null. */
  readonly porch?: EntrancePlanOutline | null;
  /** Upper storeys have no garden: outside their walls is just outside. */
  readonly floorIndex?: number;
}

interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

/** "the east wall"; a wall of the cut corner is "the inner east wall". */
function wallName(wall: ShellWall): string {
  return `the ${wall.id.startsWith('notch') ? 'inner ' : ''}${wall.side} wall`;
}

/** Whether a wall runs along x (north/south faces) rather than along z. */
const runsAlongX = (wall: ShellWall): boolean => wall.z1 === wall.z2;

/**
 * Inside: per axis, the nearest outer wall the item faces across that axis
 * (one whose run passes the item's centre), and the gap from the item's
 * edge to it. A negative gap means the item crosses that wall.
 */
function nearestAcross(walls: readonly ShellWall[], box: Box, centre: { x: number; z: number }, alongX: boolean): { wall: ShellWall; gap: number } | null {
  let best: { wall: ShellWall; gap: number } | null = null;
  for (const wall of walls) {
    // Walls running along x bound the item in z, and the other way round.
    if (runsAlongX(wall) !== alongX) continue;
    const [runFrom, runTo, at, low, high, middle] = alongX
      ? [wall.x1, wall.x2, wall.z1, box.z0, box.z1, centre.x]
      : [wall.z1, wall.z2, wall.x1, box.x0, box.x1, centre.z];
    if (middle < runFrom || middle > runTo) continue;
    const mid = (low + high) / 2;
    const gap = at <= mid ? low - at : at - high;
    if (!best || gap < best.gap) best = { wall, gap };
  }
  return best;
}

/** Outside: the outer wall nearest the item's footprint, and how far. */
function nearestWall(walls: readonly ShellWall[], box: Box): { wall: ShellWall; distance: number } | null {
  let best: { wall: ShellWall; distance: number } | null = null;
  for (const wall of walls) {
    const dx = Math.max(0, wall.x1 - box.x1, box.x0 - wall.x2);
    const dz = Math.max(0, wall.z1 - box.z1, box.z0 - wall.z2);
    const distance = Math.hypot(dx, dz);
    if (!best || distance < best.distance) best = { wall, distance };
  }
  return best;
}

/**
 * Where a nudged or turned item stands, for the status line: "Sofa, 2.4 m
 * from the west wall, 1.1 m from the north wall, turned 90°." Inside, each
 * distance runs from the item's footprint to the nearest outer wall it faces
 * on that axis, the walls of an L's cut corner included ("the inner east
 * wall"), by compass side (north is the street, as on the plan), so it reads
 * the same from any camera; a door or window is "in the north wall". An item
 * in the cut corner or beyond the walls is "in the garden, 1.2 m from the
 * east wall" (upstairs, "outside"), and one in the recessed entrance is "in
 * the porch". `collision` is why it shows red (`collisionMessage`), said after.
 */
export function describePlacement(item: FurnitureItem, house: PlacementHouse, collision: string | null = null): string {
  if (!item.position) return item.name;
  const { halfW, halfD } = rotatedHalfExtents(item);
  const centre = item.position;
  const box: Box = { x0: centre.x - halfW, x1: centre.x + halfW, z0: centre.z - halfD, z1: centre.z + halfD };
  const walls = shellWalls(house);
  const parts = [item.name];
  const porch = house.porch;
  if (porch && centre.x > porch.x0 && centre.x < porch.x1 && centre.z > Math.min(porch.frontZ, porch.backZ) && centre.z < Math.max(porch.frontZ, porch.backZ)) {
    parts.push('in the porch');
  } else if (isInsideBuilding(house, centre.x, centre.z)) {
    // A door, window or camera belongs in its wall; anything else is through it.
    const across = isWallMounted(item.type) ? 'in' : 'through';
    for (const alongX of [false, true]) {
      const nearest = nearestAcross(walls, box, centre, alongX);
      if (!nearest) continue;
      parts.push(nearest.gap < 0 ? `${across} ${wallName(nearest.wall)}` : `${formatMetres(nearest.gap)} from ${wallName(nearest.wall)}`);
    }
  } else {
    const nearest = nearestWall(walls, box);
    const where = (house.floorIndex ?? 0) > 0 ? 'outside' : 'in the garden';
    parts.push(nearest ? `${where}, ${formatMetres(nearest.distance)} from ${wallName(nearest.wall)}` : where);
  }
  const degrees = Math.round(((((item.rotation ?? 0) * 180) / Math.PI) % 360 + 360) % 360) % 360;
  if (degrees !== 0) parts.push(`turned ${degrees}°`);
  const where = `${parts.join(', ')}.`;
  return collision ? `${where} ${collision}` : where;
}

/** "3 items turned 90°; 1 locked stayed." for a turn of a multi-selection. */
export function describeGroupTurn(turned: number, degrees: number, lockedStayed: number): string {
  const subject = turned === 1 ? '1 item' : `${turned} items`;
  const stayed = lockedStayed > 0 ? `; ${lockedStayed} locked stayed` : '';
  return `${subject} turned ${Math.round(degrees)}°${stayed}.`;
}

/** "Sofa locked." / "3 items unlocked." */
export function describeLock(name: string, count: number, locked: boolean): string {
  const subject = count > 1 ? `${count} items` : name;
  return `${subject} ${locked ? 'locked' : 'unlocked'}.`;
}

/** "Undone: move Sofa on Ground." from the history label (#625). */
export function describeHistoryStep(kind: 'undo' | 'redo', label: string | null): string {
  const done = kind === 'undo' ? 'Undone' : 'Redone';
  return label ? `${done}: ${label}.` : `${done}.`;
}
