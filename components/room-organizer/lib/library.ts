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

export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `layout-${Date.now()}`
  );
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

export function saveNamedLayout(layout: RoomLayout, name: string): SaveResult {
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
  window.localStorage.setItem(layoutKey(id), JSON.stringify(layoutCopy));

  if (existingIndex >= 0) {
    index.entries[existingIndex] = entry;
  } else {
    index.entries.push(entry);
  }
  writeIndex(index);

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
  window.localStorage.removeItem(layoutKey(id));
  writeIndex({ entries: filtered });
  return true;
}
