/**
 * Custom furniture sets (#302): a selection saved as a named, reusable set
 * that appears beside the built-in ones. Each set stores full item
 * snapshots normalised around the arrangement's centroid (the clipboard's
 * shape), so colour, size and shape overrides — and any groups (#154) —
 * survive. Persisted under its own localStorage key, validated on read with
 * the same discipline as lib/schema.ts, and written through
 * `setItemEvictingSnapshots` so a full store gives way before a save fails.
 */

import { arrangeAroundCentroid } from './clipboard';
import { isFurnitureItem } from './schema';
import { setItemEvictingSnapshots, type VersionHistoryStore } from './version-history';
import type { FurnitureSet } from './furniture-sets';
import type { FurnitureItem } from './types';

export const CUSTOM_SETS_STORAGE_KEY = 'standalone-room-organizer-custom-sets';

/** Prefix on the `FurnitureSet.key` of every custom set — see `isCustomSetKey`. */
const CUSTOM_KEY_PREFIX = 'custom:';

/** Sets are small (a handful of items each); the cap keeps the panel usable. */
export const MAX_CUSTOM_SETS = 50;
export const MAX_CUSTOM_SET_NAME_LENGTH = 40;

export interface CustomFurnitureSet {
  id: string;
  name: string;
  savedAt: number;
  /** Item snapshots; `position` is each piece's offset from the centroid. */
  items: readonly FurnitureItem[];
}

export interface CustomSetsOptions {
  /** Storage override for tests; defaults to `window.localStorage`. */
  storage?: VersionHistoryStore;
  /** Clock override for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Unique tag mixed into the new set's id (caller supplies randomness). */
  idTag?: string;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One set, or null. Every item must pass the item schema AND carry a
 * position (its offset) — a set whose pieces can't be placed is useless.
 */
export function parseCustomSet(value: unknown): CustomFurnitureSet | null {
  if (!isPlainObject(value)) return null;
  const v = value;
  if (typeof v.id !== 'string' || v.id === '') return null;
  if (typeof v.name !== 'string' || v.name === '') return null;
  if (typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt)) return null;
  if (!Array.isArray(v.items) || v.items.length === 0) return null;
  const items: FurnitureItem[] = [];
  for (const item of v.items) {
    if (!isFurnitureItem(item) || !item.position) return null;
    items.push(item);
  }
  return { id: v.id, name: v.name, savedAt: v.savedAt, items };
}

interface StoredSets {
  sets: CustomFurnitureSet[];
  /**
   * Stored values the current schema rejects, kept verbatim (#340): every
   * rewrite carries them through, so a schema tightening hides an old set
   * instead of deleting it, and a later loosening or migration shows it again
   * on the next read. A blob of the wrong shape is kept as one such value
   * (the raw string when it isn't even JSON).
   */
  unreadable: unknown[];
  /** Other top-level fields of the stored object, written back untouched. */
  rest: Record<string, unknown>;
}

function splitCustomSets(value: unknown): StoredSets {
  if (value === null || value === undefined) return { sets: [], unreadable: [], rest: {} };
  if (!isPlainObject(value) || !Array.isArray(value.sets)) {
    return { sets: [], unreadable: [value], rest: {} };
  }
  const { sets: stored, ...rest } = value;
  const sets: CustomFurnitureSet[] = [];
  const unreadable: unknown[] = [];
  const seen = new Set<string>();
  for (const entry of stored as unknown[]) {
    const set = parseCustomSet(entry);
    if (!set || seen.has(set.id)) {
      unreadable.push(entry);
      continue;
    }
    seen.add(set.id);
    sets.push(set);
  }
  return { sets, unreadable, rest };
}

/**
 * The stored list. A corrupt entry (or a second copy of an id) is left out
 * on its own rather than costing the whole list; anything that isn't a list
 * at all reads as empty.
 */
export function parseCustomSets(value: unknown): CustomFurnitureSet[] {
  return splitCustomSets(value).sets;
}

function readSets(storage: VersionHistoryStore): StoredSets {
  let raw: string | null;
  try {
    raw = storage.getItem(CUSTOM_SETS_STORAGE_KEY);
  } catch {
    return { sets: [], unreadable: [], rest: {} };
  }
  if (!raw) return { sets: [], unreadable: [], rest: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { sets: [], unreadable: [raw], rest: {} };
  }
  return splitCustomSets(parsed);
}

/**
 * Readable sets newest first, then the unreadable values. Throws when the
 * store is full even after every restore point is gone.
 */
function writeSets(storage: VersionHistoryStore, stored: StoredSets): void {
  const sets: unknown[] = [...stored.sets, ...stored.unreadable];
  setItemEvictingSnapshots(storage, CUSTOM_SETS_STORAGE_KEY, JSON.stringify({ ...stored.rest, sets }));
}

// The Sets panel re-reads the list after every save/delete made elsewhere
// (the viewport chip) — a module-level notification keeps lib/ free of
// React while giving the panel a change signal.
const listeners = new Set<() => void>();

export function subscribeCustomSets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Saved sets, newest first. */
export function listCustomSets(opts: CustomSetsOptions = {}): CustomFurnitureSet[] {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return [];
  return readSets(storage).sets.sort((a, b) => b.savedAt - a.savedAt);
}

let unreadableCountCache: { raw: string; count: number } | null = null;

/**
 * How many stored values the Sets panel can't show (#340). They stay in
 * storage through every save and delete.
 */
export function countUnreadableCustomSets(opts: CustomSetsOptions = {}): number {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return 0;
  let raw: string | null;
  try {
    raw = storage.getItem(CUSTOM_SETS_STORAGE_KEY);
  } catch {
    return 0;
  }
  if (!raw) return 0;
  // The panel asks on every render (it re-renders on every layout edit);
  // re-validate only when the stored blob changed.
  if (unreadableCountCache?.raw !== raw) {
    unreadableCountCache = { raw, count: readSets(storage).unreadable.length };
  }
  return unreadableCountCache.count;
}

/**
 * Snapshot `items` as a set called `name`. Positions become offsets from
 * the centroid; locks are dropped (a placed set is immediately movable,
 * like a paste). Returns the saved set, or null when nothing was placed,
 * the name is blank, or the store is full past every restore point.
 */
export function saveCustomSet(
  items: readonly FurnitureItem[],
  name: string,
  opts: CustomSetsOptions = {}
): CustomFurnitureSet | null {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return null;
  const trimmed = name.trim().slice(0, MAX_CUSTOM_SET_NAME_LENGTH);
  if (!trimmed) return null;
  const arranged = arrangeAroundCentroid(items);
  if (!arranged) return null;
  const now = opts.now ?? Date.now;
  const savedAt = now();
  const set: CustomFurnitureSet = {
    id: `set-${savedAt}-${opts.idTag ?? ''}`,
    name: trimmed,
    savedAt,
    items: arranged.items.map((item) => {
      const { locked: _movable, ...rest } = item;
      return rest;
    }),
  };
  // Newest first; the oldest readable set falls off the end past the cap.
  const stored = readSets(storage);
  const sets = [set, ...stored.sets.filter((entry) => entry.id !== set.id)].slice(0, MAX_CUSTOM_SETS);
  try {
    writeSets(storage, { ...stored, sets });
  } catch {
    return null;
  }
  notify();
  return set;
}

export function deleteCustomSet(id: string, opts: CustomSetsOptions = {}): boolean {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return false;
  const stored = readSets(storage);
  const remaining = stored.sets.filter((set) => set.id !== id);
  if (remaining.length === stored.sets.length) return false;
  try {
    writeSets(storage, { ...stored, sets: remaining });
  } catch {
    return false;
  }
  notify();
  return true;
}

export function customSetKey(id: string): string {
  return `${CUSTOM_KEY_PREFIX}${id}`;
}

export function isCustomSetKey(key: string): boolean {
  return key.startsWith(CUSTOM_KEY_PREFIX);
}

/**
 * The `FurnitureSet` view of a saved set, so placing it goes through
 * `buildFurnitureSet` — the same fit/scale/self-collision path as the
 * built-ins — with each spec carrying its snapshot instead of a catalog
 * lookup.
 */
export function customSetToFurnitureSet(set: CustomFurnitureSet): FurnitureSet {
  return {
    key: customSetKey(set.id),
    label: set.name,
    icon: '⭐',
    description: `${set.items.length} item${set.items.length === 1 ? '' : 's'} · saved set`,
    items: set.items.map((item) => {
      const { id: _id, position, rotation, locked: _locked, ...snapshot } = item;
      return {
        type: item.type,
        offset: { x: position!.x, z: position!.z },
        ...(rotation !== undefined ? { rotation } : {}),
        snapshot,
      };
    }),
  };
}
