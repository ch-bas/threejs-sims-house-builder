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

/**
 * The stored list. A corrupt entry is dropped on its own rather than
 * costing the whole list; anything that isn't a list at all reads as empty.
 */
export function parseCustomSets(value: unknown): CustomFurnitureSet[] {
  if (!isPlainObject(value) || !Array.isArray(value.sets)) return [];
  const sets: CustomFurnitureSet[] = [];
  const seen = new Set<string>();
  for (const entry of value.sets) {
    const set = parseCustomSet(entry);
    if (!set || seen.has(set.id)) continue;
    seen.add(set.id);
    sets.push(set);
  }
  return sets;
}

function readSets(storage: VersionHistoryStore): CustomFurnitureSet[] {
  try {
    const raw = storage.getItem(CUSTOM_SETS_STORAGE_KEY);
    if (!raw) return [];
    return parseCustomSets(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Throws when the store is full even after every restore point is gone. */
function writeSets(storage: VersionHistoryStore, sets: readonly CustomFurnitureSet[]): void {
  setItemEvictingSnapshots(storage, CUSTOM_SETS_STORAGE_KEY, JSON.stringify({ sets }));
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
  return readSets(storage).sort((a, b) => b.savedAt - a.savedAt);
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
  // Newest first; the oldest falls off the end past the cap.
  const sets = [set, ...readSets(storage).filter((entry) => entry.id !== set.id)].slice(0, MAX_CUSTOM_SETS);
  try {
    writeSets(storage, sets);
  } catch {
    return null;
  }
  notify();
  return set;
}

export function deleteCustomSet(id: string, opts: CustomSetsOptions = {}): boolean {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return false;
  const sets = readSets(storage);
  const remaining = sets.filter((set) => set.id !== id);
  if (remaining.length === sets.length) return false;
  try {
    writeSets(storage, remaining);
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
