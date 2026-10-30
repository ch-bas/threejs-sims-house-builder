import { STORAGE_KEY } from './constants';
import { safeGetItem, safeRemoveItem } from './safe-storage';
import { MAX_NAME_LENGTH, capText, parseStoredLayout } from './schema';
import { classifyStorageError, type StorageErrorKind } from './storage-errors';
import {
  MAX_STORAGE_ENTRY_CHARS,
  putBackSnapshots,
  readStoredSnapshots,
  setItemEvictingSnapshots,
} from './version-history';
import type { RoomLayout, SavedLayoutEntry } from './types';

const LIBRARY_KEY_PREFIX = 'standalone-room-organizer-library:';
const LIBRARY_INDEX_KEY = `${LIBRARY_KEY_PREFIX}_index`;

interface LibraryIndex {
  entries: SavedLayoutEntry[];
  /**
   * Index values that aren't a valid entry, kept verbatim (#348): the panel
   * never sees them, and every rewrite carries them through so the raw index
   * stays recoverable. An index of the wrong shape is kept as one such value
   * (the raw string when it isn't even JSON).
   */
  unreadable: unknown[];
  /** Other top-level fields of the stored index, written back untouched. */
  rest: Record<string, unknown>;
  /**
   * The stored object behind each listed entry, by id: fields this version
   * doesn't know survive a rewrite instead of being rebuilt away.
   */
  raw: Map<string, Record<string, unknown>>;
}

function emptyIndex(): LibraryIndex {
  return { entries: [], unreadable: [], rest: {}, raw: new Map() };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** One index entry, or null when it can't be listed without throwing (#348). */
export function parseSavedLayoutEntry(value: unknown): SavedLayoutEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id === '') return null;
  if (typeof v.name !== 'string') return null;
  if (!isFiniteNumber(v.savedAt) || !isFiniteNumber(v.itemCount) || !isFiniteNumber(v.floorCount)) {
    return null;
  }
  return { id: v.id, name: v.name, savedAt: v.savedAt, itemCount: v.itemCount, floorCount: v.floorCount };
}

/** Pure half of `readIndex`, exported for tests. */
export function parseLibraryIndex(raw: string | null): LibraryIndex {
  if (!raw) return emptyIndex();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...emptyIndex(), unreadable: [raw] };
  }
  if (parsed === null) return emptyIndex();
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...emptyIndex(), unreadable: [parsed] };
  }
  const { entries: stored, ...rest } = parsed as Record<string, unknown>;
  if (!Array.isArray(stored)) return { ...emptyIndex(), unreadable: [parsed] };
  const entries: SavedLayoutEntry[] = [];
  const unreadable: unknown[] = [];
  const rawById = new Map<string, Record<string, unknown>>();
  for (const candidate of stored as unknown[]) {
    const entry = parseSavedLayoutEntry(candidate);
    if (!entry || rawById.has(entry.id)) {
      unreadable.push(candidate);
      continue;
    }
    rawById.set(entry.id, candidate as Record<string, unknown>);
    entries.push(entry);
  }
  return { entries, unreadable, rest, raw: rawById };
}

function readIndex(): LibraryIndex {
  if (typeof window === 'undefined') return emptyIndex();
  return parseLibraryIndex(safeGetItem(LIBRARY_INDEX_KEY));
}

function writeIndex(index: LibraryIndex): void {
  if (typeof window === 'undefined') return;
  const entries: unknown[] = [
    ...index.entries.map((entry) => ({ ...index.raw.get(entry.id), ...entry })),
    ...index.unreadable,
  ];
  // Restore points give way to the library on a full quota (#295).
  setItemEvictingSnapshots(
    window.localStorage,
    LIBRARY_INDEX_KEY,
    JSON.stringify({ ...index.rest, entries })
  );
}

/** The id an unreadable index value still names, if any. */
function unreadableId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' && id !== '' ? id : null;
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

/**
 * The historical slot of a name: ASCII letters, digits and dashes, or '' when
 * the name has none. Not the download `slugify` (lib/plan-export/download.ts):
 * existing saves were written under it, so it must never change.
 */
function asciiSlug(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Short names keep their historical slug unchanged, so existing library
  // saves are unaffected. Only when truncation would discard part of the name
  // do we append a hash of the FULL name to disambiguate.
  if (base.length <= SLUG_MAX_LENGTH) return base;
  return `${base.slice(0, SLUG_MAX_LENGTH)}-${shortHash(base)}`;
}

/** A letter, digit or mark the ASCII slug would drop: é, 東, д, ب (#550). */
const NON_ASCII_WORD_CHAR = /(?![A-Za-z0-9])[\p{L}\p{M}\p{N}]/u;

/** Prefix of the slots of names the ASCII slug can't spell; ASCII slots never hold `_`. */
const UNICODE_SLOT_PREFIX = 'u_';

/** Never in a slug: separates a moved house's slot from its name's (#550). */
const MOVED_SLOT_SEPARATOR = '~';

/**
 * A Unicode-aware slot (#550): the name's letters, marks and digits, case
 * folded, so "Café" and "café" share one and "Café" and "Caf" don't. A name
 * with none at all ("!!!", "🏠") is keyed by a hash of the name itself.
 */
function unicodeSlot(name: string): string {
  const key = capText(name.trim(), MAX_NAME_LENGTH).normalize('NFC').toLowerCase();
  const base = key.replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  if (!base) return `${UNICODE_SLOT_PREFIX}${shortHash(key)}`;
  const chars = Array.from(base);
  if (chars.length <= SLUG_MAX_LENGTH) return `${UNICODE_SLOT_PREFIX}${base}`;
  return `${UNICODE_SLOT_PREFIX}${chars.slice(0, SLUG_MAX_LENGTH).join('')}-${shortHash(base)}`;
}

/**
 * The library save slot a name maps to. A name the ASCII slug spells in full
 * keeps its historical slot, byte for byte: it is the storage key existing
 * saves live under. Any other name — one with a letter or digit outside ASCII,
 * or with none at all — gets a Unicode slot under `u_` (#550), so the same
 * name always maps to the same slot and "Café" no longer shares one with
 * "Caf". Older saves of such names still sit under the ASCII slug or a
 * `layout-<time>` fallback; `planSlot` finds them, and moves them out of the
 * way when the slot they hold is wanted.
 */
export function librarySlotId(name: string): string {
  const ascii = asciiSlug(name);
  return ascii && !NON_ASCII_WORD_CHAR.test(name) ? ascii : unicodeSlot(name);
}

/** The slot a name without an ASCII slug was saved under before #550. */
const LEGACY_FALLBACK_SLOT = /^layout-\d+$/;

/** Whether `entry` is an older save of a name whose slot is now `slot` (#550). */
function isLegacySaveOf(entry: SavedLayoutEntry, slot: string): boolean {
  if (entry.id === slot || !slot.startsWith(UNICODE_SLOT_PREFIX)) return false;
  if (librarySlotId(entry.name) !== slot) return false;
  return entry.id === asciiSlug(entry.name) || LEGACY_FALLBACK_SLOT.test(entry.id);
}

/**
 * Whether `entry` holds a house saved before #550 under the ASCII slug of a
 * name that now has a slot of its own: "Café" under `caf`, which "Caf" wants.
 */
function isMisplaced(entry: SavedLayoutEntry): boolean {
  return entry.id === asciiSlug(entry.name) && librarySlotId(entry.name) !== entry.id;
}

function slotTaken(index: LibraryIndex, id: string): boolean {
  return index.entries.some((entry) => entry.id === id) || index.unreadable.some((value) => unreadableId(value) === id);
}

interface SlotPlan {
  id: string;
  /** Position of the listed entry the save overwrites in place, or -1. */
  at: number;
  /** An older save of this very name under another slot, retired once the save lands. */
  legacy: SavedLayoutEntry | null;
  /** A house of another name holding this slot, moved to a slot of its own first. */
  move: { entry: SavedLayoutEntry; to: string } | null;
}

/** Where a save under `name` goes, and what it replaces or moves (#550). */
function planSlot(index: LibraryIndex, name: string): SlotPlan {
  const id = librarySlotId(name);
  const at = index.entries.findIndex((entry) => entry.id === id);
  const occupant = index.entries[at];
  if (occupant && isMisplaced(occupant)) {
    const own = librarySlotId(occupant.name);
    let to = own;
    for (let n = 2; slotTaken(index, to); n++) to = `${own}${MOVED_SLOT_SEPARATOR}${n}`;
    return { id, at: -1, legacy: null, move: { entry: occupant, to } };
  }
  if (at >= 0) return { id, at, legacy: null, move: null };
  // The newest, when an older version saved one name more than once.
  const legacy = index.entries
    .filter((entry) => isLegacySaveOf(entry, id))
    .sort((a, b) => b.savedAt - a.savedAt)[0];
  return { id, at, legacy: legacy ?? null, move: null };
}

/**
 * Whether saving under `name` would overwrite a stored house — including one
 * whose index entry is unreadable, so a hidden house is never replaced
 * without the overwrite prompt, and an older save of the same name kept
 * under its pre-#550 slot.
 */
export function layoutSlugExists(name: string): boolean {
  const index = readIndex();
  const plan = planSlot(index, name);
  if (plan.at >= 0 || plan.legacy !== null) return true;
  return plan.move === null && index.unreadable.some((value) => unreadableId(value) === plan.id);
}

/** Saved layouts, newest first; malformed index entries are left out (#348). Never throws. */
export function listSavedLayouts(): SavedLayoutEntry[] {
  return readIndex().entries.sort((a, b) => b.savedAt - a.savedAt);
}

/** How many index values the library can't list (#348); they stay in storage. */
export function countUnreadableSavedLayouts(): number {
  return readIndex().unreadable.length;
}

export interface SaveResult {
  entry: SavedLayoutEntry;
  overwrote: boolean;
}

/**
 * Why a library save didn't happen: the storage error, or `'autosave-room'`
 * when the copy fits but would leave the open house no room to autosave
 * (#565).
 */
export type LibrarySaveFailure = StorageErrorKind | 'autosave-room';

export type LibrarySaveOutcome = ({ ok: true } & SaveResult) | { ok: false; reason: LibrarySaveFailure };

/** What to tell the user about a library save that didn't happen. */
export function librarySaveFailureMessage(reason: LibrarySaveFailure): string {
  switch (reason) {
    case 'autosave-room':
      return 'This copy was not saved: it would leave no room for autosave, so the house you are editing would stop saving. Delete some saved layouts or remove the floor-plan image and try again.';
    case 'quota':
      return 'Could not save the layout — browser storage is full. Delete some saved layouts or remove the floor-plan image and try again.';
    case 'blocked':
      return 'Could not save the layout — this browser is blocking site storage.';
    case 'unknown':
      return 'Could not save the layout — browser storage refused it.';
  }
}

function totalItemCount(layout: RoomLayout): number {
  return layout.floors.reduce((sum, floor) => sum + floor.items.length, 0);
}

/**
 * The least room, in characters, a library save leaves for the open house's
 * autosave (#565). Above it the room kept is the house's own size, so it can
 * double before autosave runs out.
 */
export const AUTOSAVE_HEADROOM_MIN_CHARS = 64 * 1024;

/** Written and removed at once to measure the room left; never read. */
const PROBE_KEY = `${LIBRARY_KEY_PREFIX}_probe`;

/** Slack for the index growing by one entry, beyond the entry's own JSON. */
const INDEX_SLACK_CHARS = 64;

function autosaveHeadroom(storage: Storage, houseJson: string): number {
  let stored = 0;
  try {
    stored = storage.getItem(STORAGE_KEY)?.length ?? 0;
  } catch {
    /* unreadable: the house being saved stands in for it */
  }
  return Math.max(AUTOSAVE_HEADROOM_MIN_CHARS, stored, houseJson.length);
}

/**
 * Whether `chars` more characters fit, found by writing a probe that size and
 * removing it: localStorage has no way to ask. Restore points give way to it
 * as to any library write; the caller puts them back if it then gives up.
 */
function probeRoom(storage: Storage, chars: number): StorageErrorKind | null {
  if (chars > MAX_STORAGE_ENTRY_CHARS) return 'quota';
  try {
    setItemEvictingSnapshots(storage, PROBE_KEY, 'x'.repeat(Math.max(0, chars - PROBE_KEY.length)));
    return null;
  } catch (error) {
    return classifyStorageError(error);
  } finally {
    safeRemoveItem(PROBE_KEY);
  }
}

/**
 * Save a named copy of `layout`. Library entries embed the base64 floor-plan
 * image, so running out of the quota is realistic. The open house outranks
 * the library (#565): a copy that would leave its autosave less room than
 * `autosaveHeadroom` is refused up front with `'autosave-room'`, and any
 * restore points evicted while finding that out are put back. Restore points
 * give way to a copy that does fit (#295). The layout blob and the index are
 * kept consistent: if the index write fails, the blob is rolled back.
 */
export function saveNamedLayout(layout: RoomLayout, name: string): LibrarySaveOutcome {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch (error) {
    return { ok: false, reason: classifyStorageError(error) };
  }
  const trimmed = name.trim() || layout.name || 'Untitled';
  // The slot comes from the full name, as it always has; the stored name is
  // capped like the schema caps it, so the saved house parses unchanged.
  const shown = capText(trimmed, MAX_NAME_LENGTH);
  const index = readIndex();
  const plan = planSlot(index, trimmed);
  const { id } = plan;

  const entry: SavedLayoutEntry = {
    id,
    name: shown,
    savedAt: Date.now(),
    itemCount: totalItemCount(layout),
    floorCount: layout.floors.length,
  };

  // The house keeps its own id: the slug names the library slot, and two
  // houses saved under one name in turn are still different houses (#342).
  const layoutCopy: RoomLayout = { ...layout, name: shown };
  const json = JSON.stringify(layoutCopy);
  const previousBlob = safeGetItem(layoutKey(id));
  const move = plan.move;
  const movedBlob = move ? previousBlob : null;

  // What the save adds to storage, measured with the autosave's room on top.
  const growth =
    Math.max(0, json.length - (previousBlob?.length ?? 0)) +
    layoutKey(id).length +
    (move && movedBlob !== null ? layoutKey(move.to).length + movedBlob.length : 0) +
    JSON.stringify(entry).length +
    INDEX_SLACK_CHARS;
  const ring = readStoredSnapshots(storage);
  const shortfall = probeRoom(storage, growth + autosaveHeadroom(storage, json));
  if (shortfall !== null) {
    const reason: LibrarySaveFailure =
      shortfall === 'quota' && probeRoom(storage, growth) === null ? 'autosave-room' : shortfall;
    putBackSnapshots(storage, ring);
    return { ok: false, reason };
  }

  const dropMovedCopy = (): void => {
    if (move && movedBlob !== null) safeRemoveItem(layoutKey(move.to));
  };
  try {
    if (move && movedBlob !== null) setItemEvictingSnapshots(storage, layoutKey(move.to), movedBlob);
    setItemEvictingSnapshots(storage, layoutKey(id), json);
  } catch (error) {
    dropMovedCopy();
    return { ok: false, reason: classifyStorageError(error) };
  }

  const entries = [...index.entries];
  const raw = new Map(index.raw);
  if (move) {
    entries[entries.indexOf(move.entry)] = { ...move.entry, id: move.to };
    const stored = raw.get(id);
    if (stored) raw.set(move.to, stored);
    raw.delete(id);
  }
  const listed = plan.legacy ? entries.filter((candidate) => candidate !== plan.legacy) : entries;
  if (plan.at >= 0) listed[plan.at] = entry;
  else listed.push(entry);
  // An unreadable entry naming this slot described the blob just replaced.
  const unreadable = index.unreadable.filter((value) => unreadableId(value) !== id);
  try {
    writeIndex({ ...index, entries: listed, unreadable, raw });
  } catch (error) {
    // Best-effort rollback: restoring the blob can ITSELF hit the quota that
    // just failed the index write — never let that escape the save call (#122).
    try {
      if (previousBlob === null) storage.removeItem(layoutKey(id));
      else storage.setItem(layoutKey(id), previousBlob);
      dropMovedCopy();
    } catch {
      /* quota still exhausted — the stale blob stays but the index is intact */
    }
    return { ok: false, reason: classifyStorageError(error) };
  }
  // The older save of this name is now listed under its new slot.
  if (plan.legacy) safeRemoveItem(layoutKey(plan.legacy.id));

  return { ok: true, entry, overwrote: plan.at >= 0 || plan.legacy !== null };
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
  // A second index entry for this id named the blob being removed: dropped
  // with it, or it would list a house that can no longer load.
  const unreadable = index.unreadable.filter((value) => unreadableId(value) !== id);
  try {
    writeIndex({ ...index, entries: filtered, unreadable });
  } catch {
    return false;
  }
  safeRemoveItem(layoutKey(id));
  return true;
}
