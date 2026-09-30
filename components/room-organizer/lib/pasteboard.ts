import { STORAGE_KEY } from './constants';
import { parseStoredLayout } from './schema';
import { isShareHash } from './share';
import { setItemEvictingSnapshots } from './version-history';
import type { RoomLayout } from './types';
import type { VersionHistoryStore } from './version-history';

/**
 * Share-URL paste-board (#190): a local gallery of houses received through
 * share links, kept beside the named-layout library. Share links used to be
 * consume-once — opening one replaced the working house and there was
 * nowhere to keep what a friend sent. The gallery closes that loop with no
 * backend: links are pasted, decoded through the hardened share pipeline and
 * stored here until loaded or removed.
 *
 * Pure module — storage and clock are injectable so every code path is
 * unit-testable without a browser (pattern: version-history.ts).
 */

/** One localStorage key holds the whole collection, like the restore ring. */
export const PASTEBOARD_STORAGE_KEY = `${STORAGE_KEY}-pasteboard`;

export interface PasteboardEntry {
  /** Stable key for `removeReceivedLayout`. */
  id: string;
  /** The house's name at the time it was received. */
  name: string;
  receivedAt: number;
  /**
   * The received house, schema-validated on every read. Never carries
   * `floorPlanImage`: share links strip the tracing image before encoding
   * (it would blow the URL), and the store strips it again defensively so a
   * gallery of houses can't spend megabytes of the ~5MB quota on base64.
   */
  layout: RoomLayout;
}

export interface PasteboardOptions {
  /** Storage override for tests; defaults to `window.localStorage`. */
  storage?: VersionHistoryStore;
  /** Clock override for tests; defaults to `Date.now`. */
  now?: () => number;
}

export interface AddReceivedResult {
  entry: PasteboardEntry;
  /** True when the very same house was already on the board — nothing was written. */
  duplicate: boolean;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The `#layout=…` hash inside pasted text — a whole URL, a bare hash, or
 * either wrapped in whitespace — or null when the text carries no share
 * payload at all. Decoding is the caller's job (`decodeShareUrl` is async);
 * this only tells "not a share link" apart from "a share link that won't
 * decode", so each gets its own message.
 */
export function shareHashFromText(text: string): string | null {
  const trimmed = text.trim();
  const hashIndex = trimmed.indexOf('#');
  if (hashIndex < 0) return null;
  const hash = trimmed.slice(hashIndex);
  return isShareHash(hash) ? hash : null;
}

/** Deterministic 6-char base36 digest — ids stay unique within one millisecond. */
function shortHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}

/**
 * Read the stored collection, tolerating corrupt data: a blob that isn't a
 * JSON array yields an empty board, and entries without an id, a finite
 * `receivedAt` or a layout that passes schema validation are dropped —
 * a broken card must never take the whole gallery down.
 */
function readEntries(storage: VersionHistoryStore): PasteboardEntry[] {
  let parsed: unknown;
  try {
    const raw = storage.getItem(PASTEBOARD_STORAGE_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: PasteboardEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of parsed as unknown[]) {
    if (!isRecord(candidate)) continue;
    const { id, receivedAt } = candidate;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    if (typeof receivedAt !== 'number' || !Number.isFinite(receivedAt)) continue;
    const layout = parseStoredLayout(candidate.layout);
    if (!layout) continue;
    seen.add(id);
    entries.push({
      id,
      name: typeof candidate.name === 'string' && candidate.name ? candidate.name : layout.name,
      receivedAt,
      layout,
    });
  }
  return entries;
}

/** Stored oldest-first; the write is quota-safe (restore points give way, #295). */
function writeEntries(storage: VersionHistoryStore, entries: PasteboardEntry[]): void {
  setItemEvictingSnapshots(storage, PASTEBOARD_STORAGE_KEY, JSON.stringify(entries));
}

/** Received houses, newest first. Never throws. */
export function listReceivedLayouts(opts: PasteboardOptions = {}): PasteboardEntry[] {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return [];
  return readEntries(storage).sort((a, b) => b.receivedAt - a.receivedAt);
}

/**
 * Put a received house on the board. Returns null when localStorage refuses
 * the write even after the restore-point ring has been evicted, or when
 * storage is unavailable. The tracing image is stripped (see
 * `PasteboardEntry.layout`). Pasting the same link twice yields the existing
 * card (`duplicate: true`) instead of a second copy.
 */
export function addReceivedLayout(
  layout: RoomLayout,
  opts: PasteboardOptions = {}
): AddReceivedResult | null {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return null;
  const stored: RoomLayout = { ...layout };
  delete stored.floorPlanImage;
  const json = JSON.stringify(stored);

  const entries = readEntries(storage);
  const existing = entries.find((entry) => JSON.stringify(entry.layout) === json);
  if (existing) return { entry: existing, duplicate: true };

  const receivedAt = (opts.now ?? Date.now)();
  const entry: PasteboardEntry = {
    id: `${receivedAt.toString(36)}-${shortHash(json)}`,
    name: stored.name.trim() || 'Untitled',
    receivedAt,
    layout: stored,
  };
  entries.push(entry);
  try {
    writeEntries(storage, entries);
  } catch {
    return null;
  }
  return { entry, duplicate: false };
}

/** Take a house off the board. False when it wasn't there or the write failed. */
export function removeReceivedLayout(id: string, opts: PasteboardOptions = {}): boolean {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return false;
  const entries = readEntries(storage);
  const kept = entries.filter((entry) => entry.id !== id);
  if (kept.length === entries.length) return false;
  try {
    if (kept.length === 0 && storage.removeItem) storage.removeItem(PASTEBOARD_STORAGE_KEY);
    else writeEntries(storage, kept);
  } catch {
    return false;
  }
  return true;
}
