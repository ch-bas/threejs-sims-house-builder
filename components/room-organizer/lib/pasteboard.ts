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
 * The board keeps at most this many readable houses; adding past it drops
 * the oldest. Uncapped, every paste evicted a restore point until the main
 * save itself failed (#355). Lower than `MAX_CUSTOM_SETS` because a house
 * is far bigger than a set.
 */
export const MAX_RECEIVED_LAYOUTS = 30;

interface StoredBoard {
  entries: PasteboardEntry[];
  /**
   * Stored values the current schema rejects, kept verbatim (#340). Every
   * rewrite carries them through, so a schema tightening hides an old house
   * instead of deleting it, and a later loosening or migration shows it again
   * on the next read. A blob that isn't an array is kept as one such value
   * (the raw string when it isn't even JSON).
   */
  unreadable: unknown[];
}

function parseEntry(candidate: unknown): PasteboardEntry | null {
  if (!isRecord(candidate)) return null;
  const { id, receivedAt } = candidate;
  if (typeof id !== 'string' || !id) return null;
  if (typeof receivedAt !== 'number' || !Number.isFinite(receivedAt)) return null;
  const layout = parseStoredLayout(candidate.layout);
  if (!layout) return null;
  return {
    id,
    name: typeof candidate.name === 'string' && candidate.name ? candidate.name : layout.name,
    receivedAt,
    layout,
  };
}

/**
 * Read the stored collection, tolerating corrupt data: entries without an
 * id, a finite `receivedAt` or a layout that passes schema validation — and
 * second copies of an id — are set aside as unreadable instead of shown, so
 * a broken card never takes the whole gallery down.
 */
function readBoard(storage: VersionHistoryStore): StoredBoard {
  let raw: string | null;
  try {
    raw = storage.getItem(PASTEBOARD_STORAGE_KEY);
  } catch {
    return { entries: [], unreadable: [] };
  }
  if (!raw) return { entries: [], unreadable: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { entries: [], unreadable: [raw] };
  }
  if (parsed === null) return { entries: [], unreadable: [] };
  if (!Array.isArray(parsed)) return { entries: [], unreadable: [parsed] };
  const entries: PasteboardEntry[] = [];
  const unreadable: unknown[] = [];
  const seen = new Set<string>();
  for (const candidate of parsed as unknown[]) {
    const entry = parseEntry(candidate);
    if (!entry || seen.has(entry.id)) {
      unreadable.push(candidate);
      continue;
    }
    seen.add(entry.id);
    entries.push(entry);
  }
  return { entries, unreadable };
}

/**
 * Unreadable values first, then the cards oldest-first. The write is
 * quota-safe (restore points give way, #295); the key goes once nothing at
 * all is left.
 */
function writeBoard(storage: VersionHistoryStore, board: StoredBoard): void {
  if (board.entries.length === 0 && board.unreadable.length === 0 && storage.removeItem) {
    storage.removeItem(PASTEBOARD_STORAGE_KEY);
    return;
  }
  setItemEvictingSnapshots(
    storage,
    PASTEBOARD_STORAGE_KEY,
    JSON.stringify([...board.unreadable, ...board.entries])
  );
}

/** Received houses, newest first. Never throws. */
export function listReceivedLayouts(opts: PasteboardOptions = {}): PasteboardEntry[] {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return [];
  return readBoard(storage).entries.sort((a, b) => b.receivedAt - a.receivedAt);
}

// The panel asks on every render; re-validating every house each time is
// wasted work while the stored blob hasn't changed.
let unreadableCountCache: { raw: string; count: number } | null = null;

/**
 * How many stored values the board can't show (#340). They stay in storage
 * through every add and remove. Never throws.
 */
export function countUnreadableReceivedLayouts(opts: PasteboardOptions = {}): number {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return 0;
  let raw: string | null;
  try {
    raw = storage.getItem(PASTEBOARD_STORAGE_KEY);
  } catch {
    return 0;
  }
  if (!raw) return 0;
  if (unreadableCountCache?.raw !== raw) {
    unreadableCountCache = { raw, count: readBoard(storage).unreadable.length };
  }
  return unreadableCountCache.count;
}

/**
 * Put a received house on the board. Returns null when localStorage refuses
 * the write even after the restore-point ring has been evicted, or when
 * storage is unavailable. The tracing image is stripped (see
 * `PasteboardEntry.layout`). Pasting the same link twice yields the existing
 * card (`duplicate: true`) instead of a second copy. Past
 * `MAX_RECEIVED_LAYOUTS` the oldest card is dropped (#355).
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

  const board = readBoard(storage);
  const existing = board.entries.find((entry) => JSON.stringify(entry.layout) === json);
  if (existing) return { entry: existing, duplicate: true };

  const receivedAt = (opts.now ?? Date.now)();
  const entry: PasteboardEntry = {
    id: `${receivedAt.toString(36)}-${shortHash(json)}`,
    name: stored.name.trim() || 'Untitled',
    receivedAt,
    layout: stored,
  };
  const oldestFirst = board.entries.sort((a, b) => a.receivedAt - b.receivedAt);
  const entries = [...oldestFirst, entry].slice(-MAX_RECEIVED_LAYOUTS);
  try {
    writeBoard(storage, { entries, unreadable: board.unreadable });
  } catch {
    return null;
  }
  return { entry, duplicate: false };
}

/** Take a house off the board. False when it wasn't there or the write failed. */
export function removeReceivedLayout(id: string, opts: PasteboardOptions = {}): boolean {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return false;
  const board = readBoard(storage);
  const kept = board.entries.filter((entry) => entry.id !== id);
  if (kept.length === board.entries.length) return false;
  try {
    writeBoard(storage, { entries: kept, unreadable: board.unreadable });
  } catch {
    return false;
  }
  return true;
}
