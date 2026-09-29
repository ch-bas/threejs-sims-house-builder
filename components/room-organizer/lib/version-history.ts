import { STORAGE_KEY } from './constants';
import { parseStoredLayout } from './schema';
import type { RoomLayout } from './types';

/**
 * Automatic restore points (#231): a small ring of coarse layout snapshots
 * sitting between the undo stack (seconds, dies with the session) and the
 * saved-layouts library (deliberate, named saves). Recording piggybacks on
 * the autosave in use-layout-persistence.ts; the History section of the
 * library panel lists and restores entries.
 *
 * Pure module — storage and clock are injectable so every code path is
 * unit-testable without a browser.
 */

/** Where the restore-point ring lives (pattern: RECOVERY_STORAGE_KEY). */
export const VERSION_HISTORY_STORAGE_KEY = `${STORAGE_KEY}-versions`;

/** The ring keeps at most this many restore points; the oldest is evicted. */
export const VERSION_HISTORY_LIMIT = 10;

/**
 * Coarse cadence: a new snapshot is accepted only when the newest entry is at
 * least this old, so ten entries span hours of editing rather than seconds.
 * `force` (used on pagehide) bypasses the gate.
 */
export const VERSION_HISTORY_MIN_INTERVAL_MS = 5 * 60 * 1000;

interface VersionEntry {
  savedAt: number;
  layout: RoomLayout;
}

/** Cheap per-entry summary for the History list — no layout blob attached. */
export interface VersionSummary {
  savedAt: number;
  itemCount: number;
  floorCount: number;
}

/** The slice of the Storage API this module needs; injectable for tests. */
export interface VersionHistoryStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface VersionHistoryOptions {
  /** Storage override for tests; defaults to `window.localStorage`. */
  storage?: VersionHistoryStore;
  /** Clock override for tests; defaults to `Date.now`. */
  now?: () => number;
}

function defaultStorage(): VersionHistoryStore | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Accessing localStorage itself can throw (blocked third-party storage).
    return null;
  }
}

/**
 * Read the stored ring, tolerating corrupt or missing data: a blob that isn't
 * a JSON array yields an empty ring, and each entry must carry a finite
 * `savedAt` and a layout that survives `parseStoredLayout` (which also
 * upgrades legacy single-floor snapshots) or it is dropped.
 */
function readEntries(storage: VersionHistoryStore): VersionEntry[] {
  let parsed: unknown;
  try {
    const raw = storage.getItem(VERSION_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: VersionEntry[] = [];
  for (const candidate of parsed) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const { savedAt, layout } = candidate as { savedAt?: unknown; layout?: unknown };
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) continue;
    const validated = parseStoredLayout(layout);
    if (!validated) continue;
    entries.push({ savedAt, layout: validated });
  }
  // Stored oldest-first; keep that invariant even if the blob was reordered.
  return entries.sort((a, b) => a.savedAt - b.savedAt);
}

/**
 * Append a restore point to the ring. Returns true when one was stored.
 *
 * Quota discipline: the base64 floor-plan image can be megabytes on its own
 * and would blow the ring's share of the ~5MB localStorage budget, so
 * snapshots NEVER carry `floorPlanImage` — a restore keeps the CURRENT
 * layout's image instead (the History panel re-attaches it). On a failed
 * write the oldest entry is evicted and the write retried; if even a
 * single-entry ring won't fit, give up silently — restore points must never
 * break the app or the main autosave.
 */
export function recordSnapshot(
  layout: RoomLayout,
  opts: VersionHistoryOptions & { force?: boolean } = {}
): boolean {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return false;
  const clock = opts.now ?? Date.now;
  const entries = readEntries(storage);
  const newest = entries[entries.length - 1];
  const at = clock();
  if (!opts.force && newest && at - newest.savedAt < VERSION_HISTORY_MIN_INTERVAL_MS) {
    return false;
  }

  const snapshotted: RoomLayout = { ...layout };
  delete snapshotted.floorPlanImage;
  // `savedAt` doubles as the lookup key in getSnapshot, so a force-snapshot
  // landing in the same millisecond as the newest entry is nudged forward to
  // keep keys unique.
  entries.push({ savedAt: newest ? Math.max(at, newest.savedAt + 1) : at, layout: snapshotted });
  while (entries.length > VERSION_HISTORY_LIMIT) entries.shift();

  while (entries.length > 0) {
    try {
      storage.setItem(VERSION_HISTORY_STORAGE_KEY, JSON.stringify(entries));
      return true;
    } catch {
      // Quota — drop the oldest restore point and try again.
      entries.shift();
    }
  }
  return false;
}

/** Cheap summaries of the stored restore points, newest first. */
export function listSnapshots(opts: VersionHistoryOptions = {}): VersionSummary[] {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return [];
  return readEntries(storage)
    .map(({ savedAt, layout }) => ({
      savedAt,
      itemCount: layout.floors.reduce((sum, floor) => sum + floor.items.length, 0),
      floorCount: layout.floors.length,
    }))
    .reverse();
}

/** The full layout stored under `savedAt`, or null if it's gone or corrupt. */
export function getSnapshot(savedAt: number, opts: VersionHistoryOptions = {}): RoomLayout | null {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return null;
  const entry = readEntries(storage).find((candidate) => candidate.savedAt === savedAt);
  return entry ? entry.layout : null;
}
