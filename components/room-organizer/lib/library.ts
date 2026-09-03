import { parseStoredLayout } from './schema';
import type { RoomLayout, SavedLayoutEntry } from './types';

const LIBRARY_KEY_PREFIX = 'standalone-room-organizer-library:';
const LIBRARY_INDEX_KEY = `${LIBRARY_KEY_PREFIX}_index`;

interface LibraryIndex {
  entries: SavedLayoutEntry[];
}

function readIndex(): LibraryIndex {
  if (typeof window === 'undefined') return { entries: [] };
  try {
    const raw = window.localStorage.getItem(LIBRARY_INDEX_KEY);
    if (!raw) return { entries: [] };
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as LibraryIndex).entries)) {
      return parsed as LibraryIndex;
    }
    return { entries: [] };
  } catch {
    return { entries: [] };
  }
}

function writeIndex(index: LibraryIndex): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LIBRARY_INDEX_KEY, JSON.stringify(index));
}

function layoutKey(id: string): string {
  return `${LIBRARY_KEY_PREFIX}${id}`;
}

const SLUG_MAX_LENGTH = 40;

/**
 * Deterministic 6-char base36 digest, used to keep truncated slugs distinct.
 * Not cryptographic — just enough that two long names sharing a 40-char
 * prefix don't silently map to the same save slot.
 */
function shortHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}

export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return `layout-${Date.now()}`;
  // Short names keep their historical slug unchanged, so existing library
  // saves are unaffected. Only when truncation would discard part of the name
  // do we append a hash of the FULL name to disambiguate.
  if (base.length <= SLUG_MAX_LENGTH) return base;
  return `${base.slice(0, SLUG_MAX_LENGTH)}-${shortHash(base)}`;
}

export function layoutSlugExists(name: string): boolean {
  return readIndex().entries.some((entry) => entry.id === slugify(name));
}

export function listSavedLayouts(): SavedLayoutEntry[] {
  return readIndex().entries.slice().sort((a, b) => b.savedAt - a.savedAt);
}

export interface SaveResult {
  entry: SavedLayoutEntry;
  overwrote: boolean;
}

function totalItemCount(layout: RoomLayout): number {
  return layout.floors.reduce((sum, floor) => sum + floor.items.length, 0);
}

/**
 * Returns `null` when localStorage rejects the write (typically
 * QuotaExceededError — library entries embed the base64 floor-plan image, so
 * running out of the ~5MB quota is realistic). The layout blob and the index
 * are kept consistent: if the index write fails, the blob is rolled back.
 */
export function saveNamedLayout(layout: RoomLayout, name: string): SaveResult | null {
  const trimmed = name.trim() || layout.name || 'Untitled';
  const id = slugify(trimmed);
  const index = readIndex();
  const existingIndex = index.entries.findIndex((entry) => entry.id === id);

  const entry: SavedLayoutEntry = {
    id,
    name: trimmed,
    savedAt: Date.now(),
    itemCount: totalItemCount(layout),
    floorCount: layout.floors.length,
  };

  const layoutCopy: RoomLayout = { ...layout, id, name: trimmed };
  const previousBlob = window.localStorage.getItem(layoutKey(id));
  try {
    window.localStorage.setItem(layoutKey(id), JSON.stringify(layoutCopy));
  } catch {
    return null;
  }

  if (existingIndex >= 0) {
    index.entries[existingIndex] = entry;
  } else {
    index.entries.push(entry);
  }
  try {
    writeIndex(index);
  } catch {
    // Best-effort rollback: restoring the blob can ITSELF hit the quota that
    // just failed the index write — never let that escape the save call (#122).
    try {
      if (previousBlob === null) window.localStorage.removeItem(layoutKey(id));
      else window.localStorage.setItem(layoutKey(id), previousBlob);
    } catch {
      /* quota still exhausted — the stale blob stays but the index is intact */
    }
    return null;
  }

  return { entry, overwrote: existingIndex >= 0 };
}

export function loadNamedLayout(id: string): RoomLayout | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(layoutKey(id));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parseStoredLayout(parsed);
  } catch {
    return null;
  }
}

export function deleteNamedLayout(id: string): boolean {
  if (typeof window === 'undefined') return false;
  const index = readIndex();
  const filtered = index.entries.filter((entry) => entry.id !== id);
  if (filtered.length === index.entries.length) return false;
  // Index first, blob second: the old order removed the blob and then let a
  // quota throw out of writeIndex, leaving a ghost index entry whose layout
  // was already gone (#122). removeItem itself cannot hit quota.
  try {
    writeIndex({ entries: filtered });
  } catch {
    return false;
  }
  window.localStorage.removeItem(layoutKey(id));
  return true;
}
