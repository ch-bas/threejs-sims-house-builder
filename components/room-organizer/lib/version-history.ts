import { STORAGE_KEY } from './constants';
import { randomId } from './ids';
import { INITIAL_GROUND_FLOOR } from './initial-layout';
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

/**
 * Sidecar listing each ring entry's house and time (#297, #342). The cadence
 * gate runs after every debounced autosave; reading this few-hundred-byte key
 * instead of the ring keeps a refused snapshot from parsing up to half a
 * megabyte.
 */
export const VERSION_HISTORY_META_KEY = `${VERSION_HISTORY_STORAGE_KEY}-meta`;

/** The ring keeps at most this many restore points; the oldest is evicted. */
export const VERSION_HISTORY_LIMIT = 10;

/**
 * Ceiling on the serialised ring, in characters of JSON (#295). Without it
 * the ring grew to whatever the quota allowed and starved the main autosave
 * and the library, which matter more than restore points.
 */
export const VERSION_HISTORY_MAX_CHARS = 512 * 1024;

/**
 * Coarse cadence: a new snapshot is accepted only when the newest entry of
 * the same house is at least this old, so ten entries span hours of editing
 * rather than seconds. `force` (used on pagehide) bypasses the gate.
 */
export const VERSION_HISTORY_MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How many entity-id hashes a house sketch keeps (#342). Enough that an
 * ordinary edit — adding, moving or deleting a few things — leaves an overlap
 * with the previous restore point; few enough that the sidecar stays small.
 */
const HOUSE_SKETCH_SIZE = 8;

/**
 * One stored restore point. The summary fields sit beside the layout so the
 * History list never has to validate a layout (#297). Entries written before
 * #296 carry only `savedAt` and `layout`; entries written before #342/#344
 * lack `house` and `id`, which are derived on read and persisted by the next
 * rewrite of the ring. A field left `undefined` is simply not written:
 * entries only ever go through JSON.
 */
interface StoredEntry {
  /** Lookup key, written once and never changed (#344). */
  id: string;
  /** Display and ordering only; may be clamped to the present (#297). */
  savedAt: number;
  /** Which house this is — see `houseSketch` (#342). */
  house: string[];
  layoutId?: string | undefined;
  name?: string | undefined;
  hadFloorPlan?: boolean | undefined;
  /** Fingerprint of the floor-plan image the house carried (#296). */
  floorPlan?: string | undefined;
  itemCount?: number | undefined;
  floorCount?: number | undefined;
  layout: unknown;
}

/** A stored entry together with its serialised form, for size accounting. */
interface Slot {
  entry: StoredEntry;
  json: string;
}

/** Cheap per-entry summary for the History list — no layout blob attached. */
export interface VersionSummary {
  /** Stable lookup key for `getSnapshot`; never rewritten (#344). */
  id: string;
  /** When the snapshot was taken, clamped to the present (#297). */
  savedAt: number;
  itemCount: number;
  floorCount: number;
  /** Name of the house the snapshot belongs to; null when it is unknown. */
  name: string | null;
  /** `layout.id` of that house; null when it had none. */
  layoutId: string | null;
  /** Sketch of the house's entity ids, telling same-named houses apart (#342). */
  house: readonly string[];
  /** Whether the house carried a floor-plan image when it was snapshotted. */
  hadFloorPlan: boolean;
  /** Fingerprint of that image, or null — see `floorPlanFingerprint`. */
  floorPlanFingerprint: string | null;
}

/** The slice of the Storage API this module needs; injectable for tests. */
export interface VersionHistoryStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
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

// In-tab change signal for the History list (#367): the `storage` event only
// fires in OTHER tabs, so writes from this tab notify their listeners here.
const listeners = new Set<() => void>();

/** Called after every in-tab change to the restore-point ring. */
export function subscribeSnapshots(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** djb2 over the whole string, as an unsigned 32-bit number. */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

const FINGERPRINT_SAMPLE = 4096;

/**
 * Short fingerprint of a floor-plan data URL: its length plus a hash of its
 * head and tail. Houses have no dependable identity — `layout.id` is rarely
 * set and every new house is called "My Home" — so whether a restore may put
 * the current image back is decided by the image itself, not by the house
 * it seems to belong to (#296). Sampled so a multi-megabyte image costs the
 * same as a small one.
 */
export function floorPlanFingerprint(image: string | null | undefined): string | null {
  if (!image) return null;
  const sample =
    image.length <= FINGERPRINT_SAMPLE * 2
      ? image
      : image.slice(0, FINGERPRINT_SAMPLE) + image.slice(-FINGERPRINT_SAMPLE);
  return `${image.length}:${hashString(sample).toString(36)}`;
}

function collectIds(list: unknown, into: Set<string>): void {
  if (!Array.isArray(list)) return;
  for (const entry of list as unknown[]) {
    if (isRecord(entry) && typeof entry.id === 'string') into.add(entry.id);
  }
}

/**
 * Which house a layout is, for cadence and dedupe (#342). Houses have no
 * dependable identity: `layout.id` is set only by a library load, every new
 * house is "My Home", and its ground floor is always `ground`. What does
 * tell two houses apart is the random ids of what was built in them — items,
 * partitions, zones, dormers, added storeys — and an ordinary edit keeps
 * most of those. The sketch is the HOUSE_SKETCH_SIZE smallest hashes of
 * those ids (a bottom-k MinHash): two snapshots of one house share some of
 * it, unrelated houses share none. Reads `unknown` because entries predating
 * the sketch are read raw, possibly in the legacy single-floor shape.
 */
export function houseSketch(layout: unknown): string[] {
  if (!isRecord(layout)) return [];
  const ids = new Set<string>();
  collectIds(layout.items, ids); // legacy single-floor layouts
  if (isRecord(layout.roof)) collectIds(layout.roof.dormers, ids);
  if (Array.isArray(layout.floors)) {
    for (const floor of layout.floors as unknown[]) {
      if (!isRecord(floor)) continue;
      if (typeof floor.id === 'string' && floor.id !== INITIAL_GROUND_FLOOR.id) ids.add(floor.id);
      collectIds(floor.items, ids);
      collectIds(floor.interiorWalls, ids);
      collectIds(floor.zones, ids);
    }
  }
  const hashes = [...new Set([...ids].map(hashString))].sort((a, b) => a - b);
  return hashes.slice(0, HOUSE_SKETCH_SIZE).map((hash) => hash.toString(36));
}

interface HouseRef {
  layoutId?: string | undefined;
  name?: string | undefined;
  house: readonly string[];
}

/**
 * Whether two snapshots are of one house, which scopes cadence and dedupe
 * (#296, #342): the same id when either has one; otherwise the same name and
 * overlapping sketches. Houses with nothing built in them have empty
 * sketches and match only each other — there is no work to tell apart.
 */
function sameHouse(a: HouseRef, b: HouseRef): boolean {
  if (a.layoutId !== undefined || b.layoutId !== undefined) return a.layoutId === b.layoutId;
  if (a.name === undefined || a.name !== b.name) return false;
  if (a.house.length === 0 || b.house.length === 0) return a.house.length === b.house.length;
  return a.house.some((hash) => b.house.includes(hash));
}

/** The newest of `entries` that is the same house as `ref`. */
function newestOfHouse<T extends HouseRef & { savedAt: number }>(
  entries: readonly T[],
  ref: HouseRef
): T | undefined {
  let newest: T | undefined;
  for (const entry of entries) {
    if (sameHouse(entry, ref) && (newest === undefined || entry.savedAt >= newest.savedAt)) newest = entry;
  }
  return newest;
}

/** A negative delta means the clock was corrected backwards — elapsed (#297). */
function insideInterval(at: number, newest: number): boolean {
  const delta = at - newest;
  return delta >= 0 && delta < VERSION_HISTORY_MIN_INTERVAL_MS;
}

/**
 * Read the stored ring, tolerating corrupt or missing data: a blob that isn't
 * a JSON array yields an empty ring, and entries without a finite `savedAt`
 * or a layout object are dropped. Layouts are NOT schema-validated here —
 * that is deferred to `getSnapshot` (#297). Entries predating #296 take
 * their identity from the raw layout. An entry without an `id` (or with one
 * already taken) gets one derived from its stored `savedAt` and its place in
 * the blob: deterministic, so every read agrees until the next rewrite
 * persists it, after which clamping `savedAt` no longer moves it (#344).
 */
function readEntries(storage: VersionHistoryStore): StoredEntry[] {
  let parsed: unknown;
  try {
    const raw = storage.getItem(VERSION_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: StoredEntry[] = [];
  const ids = new Set<string>();
  for (const candidate of parsed as unknown[]) {
    if (!isRecord(candidate)) continue;
    const { savedAt, layout } = candidate;
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) continue;
    if (!isRecord(layout)) continue;
    let id = optionalString(candidate.id) ?? `at-${savedAt}`;
    for (let n = 2; ids.has(id); n++) id = `at-${savedAt}-${n}`;
    ids.add(id);
    entries.push({
      id,
      savedAt,
      house: isStringArray(candidate.house) ? candidate.house : houseSketch(layout),
      layoutId: optionalString(candidate.layoutId) ?? optionalString(layout.id),
      name: optionalString(candidate.name) ?? optionalString(layout.name),
      hadFloorPlan: candidate.hadFloorPlan === true,
      floorPlan: optionalString(candidate.floorPlan),
      itemCount: optionalCount(candidate.itemCount),
      floorCount: optionalCount(candidate.floorCount),
      layout,
    });
  }
  // Stored oldest-first; keep that invariant even if the blob was reordered.
  return entries.sort((a, b) => a.savedAt - b.savedAt);
}

function readSlots(storage: VersionHistoryStore): Slot[] {
  return readEntries(storage).map((entry) => ({ entry, json: JSON.stringify(entry) }));
}

function serialiseSlots(slots: Slot[]): string {
  return `[${slots.map((slot) => slot.json).join(',')}]`;
}

/** Length of `serialiseSlots(slots)` without building the string. */
function serialisedLength(slots: Slot[]): number {
  return slots.reduce((sum, slot) => sum + slot.json.length, 0) + Math.max(slots.length - 1, 0) + 2;
}

/** One ring entry as the sidecar knows it: enough to run the gate. */
interface MetaEntry extends HouseRef {
  savedAt: number;
}

/**
 * The sidecar's per-entry list (#342). A sidecar in the older per-name shape
 * (`{ houses }`) reads as missing and is rebuilt from the ring.
 */
function readMeta(storage: VersionHistoryStore): MetaEntry[] | null {
  try {
    const raw = storage.getItem(VERSION_HISTORY_META_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.entries)) return null;
    const entries: MetaEntry[] = [];
    for (const entry of parsed.entries as unknown[]) {
      if (!isRecord(entry) || typeof entry.savedAt !== 'number' || !isStringArray(entry.house)) return null;
      entries.push({
        savedAt: entry.savedAt,
        layoutId: optionalString(entry.layoutId),
        name: optionalString(entry.name),
        house: entry.house,
      });
    }
    return entries;
  } catch {
    return null;
  }
}

/** Best-effort: a stale or missing sidecar only costs one ring read. */
function writeMeta(storage: VersionHistoryStore, slots: Slot[]): void {
  const entries: MetaEntry[] = slots.map(({ entry }) => ({
    savedAt: entry.savedAt,
    layoutId: entry.layoutId,
    name: entry.name,
    house: entry.house,
  }));
  try {
    storage.setItem(VERSION_HISTORY_META_KEY, JSON.stringify({ entries }));
  } catch {
    /* quota — the gate falls back to the ring itself */
  }
}

function removeKey(storage: VersionHistoryStore, key: string): void {
  try {
    if (storage.removeItem) storage.removeItem(key);
    else storage.setItem(key, '');
  } catch {
    /* nothing more can be freed */
  }
}

/**
 * Append a restore point to the ring. Returns true when one was stored.
 *
 * Quota discipline: the base64 floor-plan image can be megabytes on its own
 * and would blow the ring's share of the ~5MB localStorage budget, so
 * snapshots NEVER carry `floorPlanImage` — the History panel re-attaches the
 * current one when the snapshot belongs to the same house (#296). The ring
 * stays under VERSION_HISTORY_MAX_CHARS (#295); on a failed write the oldest
 * entry is evicted and the write retried; if even a single-entry ring won't
 * fit, give up silently — restore points must never break the app or the
 * main autosave.
 *
 * A snapshot identical to the newest one of the same house is skipped, even
 * when forced (#297).
 */
export function recordSnapshot(
  layout: RoomLayout,
  opts: VersionHistoryOptions & { force?: boolean } = {}
): boolean {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return false;
  const at = (opts.now ?? Date.now)();
  const ref: HouseRef = { layoutId: layout.id, name: layout.name, house: houseSketch(layout) };

  // Cheap gate first (#297): only a snapshot that may actually be written
  // pays for reading the ring.
  const meta = opts.force ? null : readMeta(storage);
  const gated = meta ? newestOfHouse(meta, ref) : undefined;
  if (gated && insideInterval(at, gated.savedAt)) return false;

  const slots = readSlots(storage);
  const previous = newestOfHouse(
    slots.map((slot) => slot.entry),
    ref
  );

  // The sidecar was missing or stale — the ring is the source of truth.
  if (!opts.force && previous && insideInterval(at, previous.savedAt)) {
    if (meta === null) writeMeta(storage, slots);
    return false;
  }

  const snapshotted: RoomLayout = { ...layout };
  delete snapshotted.floorPlanImage;
  const layoutJson = JSON.stringify(snapshotted);
  if (previous && JSON.stringify(previous.layout) === layoutJson) return false;

  // A `savedAt` ahead of the clock would sort as newest forever and be
  // evicted last (#297). Pull such entries back, keeping the order strict.
  // Done after the gate, which must see the stored timestamps; lookups go by
  // `id`, which this leaves alone (#344).
  let earlier = -Infinity;
  for (const slot of slots) {
    const clamped = Math.max(Math.min(slot.entry.savedAt, at), earlier + 1);
    if (clamped !== slot.entry.savedAt) {
      slot.entry = { ...slot.entry, savedAt: clamped };
      slot.json = JSON.stringify(slot.entry);
    }
    earlier = clamped;
  }

  const newest = slots[slots.length - 1];
  const header: Omit<StoredEntry, 'layout'> = {
    id: randomId('rp'),
    // Strictly after the newest entry, so the ring's order is unambiguous.
    savedAt: newest ? Math.max(at, newest.entry.savedAt + 1) : at,
    house: [...ref.house],
    layoutId: layout.id,
    name: layout.name,
    hadFloorPlan: Boolean(layout.floorPlanImage),
    floorPlan: floorPlanFingerprint(layout.floorPlanImage) ?? undefined,
    itemCount: layout.floors.reduce((sum, floor) => sum + floor.items.length, 0),
    floorCount: layout.floors.length,
  };
  const added: Slot = {
    entry: { ...header, layout: snapshotted },
    // Spliced by hand so the layout is serialised once, not twice.
    json: `${JSON.stringify(header).slice(0, -1)},"layout":${layoutJson}}`,
  };
  // A house too large for the budget on its own gets no restore points;
  // the older entries are worth more than an empty ring.
  if (serialisedLength([added]) > VERSION_HISTORY_MAX_CHARS) return false;

  slots.push(added);
  while (slots.length > VERSION_HISTORY_LIMIT) slots.shift();
  while (serialisedLength(slots) > VERSION_HISTORY_MAX_CHARS) slots.shift();

  while (slots.length > 0) {
    try {
      storage.setItem(VERSION_HISTORY_STORAGE_KEY, serialiseSlots(slots));
      writeMeta(storage, slots);
      notify();
      return true;
    } catch {
      // Quota — drop the oldest restore point and try again.
      slots.shift();
    }
  }
  return false;
}

/**
 * Cheap summaries of the stored restore points, newest first. Built from the
 * summaries stored beside each layout; only entries predating them (#296)
 * are schema-validated here, and dropped when invalid.
 */
export function listSnapshots(opts: VersionHistoryOptions = {}): VersionSummary[] {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return [];
  const at = (opts.now ?? Date.now)();
  const summaries: VersionSummary[] = [];
  for (const entry of readEntries(storage)) {
    let { itemCount, floorCount } = entry;
    if (itemCount === undefined || floorCount === undefined) {
      const validated = parseStoredLayout(entry.layout);
      if (!validated) continue;
      itemCount = validated.floors.reduce((sum, floor) => sum + floor.items.length, 0);
      floorCount = validated.floors.length;
    }
    summaries.push({
      id: entry.id,
      savedAt: Math.min(entry.savedAt, at),
      itemCount,
      floorCount,
      name: entry.name ?? null,
      layoutId: entry.layoutId ?? null,
      house: entry.house,
      hadFloorPlan: entry.hadFloorPlan === true,
      floorPlanFingerprint: entry.floorPlan ?? null,
    });
  }
  // Stable sort: entries clamped to the same instant keep their stored order.
  return summaries.sort((a, b) => a.savedAt - b.savedAt).reverse();
}

/**
 * The full layout stored under a summary's `id`, or null if it's gone or
 * fails schema validation (which also upgrades legacy single-floor
 * snapshots).
 */
export function getSnapshot(id: string, opts: VersionHistoryOptions = {}): RoomLayout | null {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return null;
  const entry = readEntries(storage).find((candidate) => candidate.id === id);
  return entry ? parseStoredLayout(entry.layout) : null;
}

type HouseFields = Pick<VersionSummary, 'layoutId' | 'name' | 'house'>;

function summaryRef(summary: HouseFields): HouseRef {
  return { layoutId: summary.layoutId ?? undefined, name: summary.name ?? undefined, house: summary.house };
}

/** Whether two restore points are of one house (#296, #342). */
export function snapshotsShareHouse(a: HouseFields, b: HouseFields): boolean {
  return sameHouse(summaryRef(a), summaryRef(b));
}

/**
 * Whether a restore point was taken from `layout`'s house (#296, #342): the
 * same id, or — when neither side has one — the same name and an overlapping
 * sketch.
 */
export function snapshotBelongsTo(summary: HouseFields, layout: RoomLayout): boolean {
  return sameHouse(summaryRef(summary), { layoutId: layout.id, name: layout.name, house: houseSketch(layout) });
}

/** Drop every restore point, freeing the ring's whole share of the quota. */
export function clearSnapshots(opts: VersionHistoryOptions = {}): void {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return;
  removeKey(storage, VERSION_HISTORY_STORAGE_KEY);
  removeKey(storage, VERSION_HISTORY_META_KEY);
  notify();
}

/**
 * Free space by dropping the oldest restore point (#295). Returns false once
 * there is nothing left to drop, so callers can loop on it.
 */
export function evictOldestSnapshot(opts: VersionHistoryOptions = {}): boolean {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return false;
  try {
    if (!storage.getItem(VERSION_HISTORY_STORAGE_KEY)) return false;
  } catch {
    return false;
  }
  const slots = readSlots(storage);
  slots.shift();
  if (slots.length === 0) {
    // Also covers a corrupt blob: it holds quota but no usable entry.
    clearSnapshots({ storage });
    return true;
  }
  try {
    storage.setItem(VERSION_HISTORY_STORAGE_KEY, serialiseSlots(slots));
    writeMeta(storage, slots);
    notify();
  } catch {
    clearSnapshots({ storage });
  }
  return true;
}

/**
 * `storage.setItem` for data that outranks restore points (#295): on a
 * failed write the ring is evicted oldest-first and the write retried.
 * Rethrows the storage error once the ring is empty and the write still
 * fails.
 */
export function setItemEvictingSnapshots(
  storage: VersionHistoryStore,
  key: string,
  value: string
): void {
  for (;;) {
    try {
      storage.setItem(key, value);
      return;
    } catch (error) {
      if (!evictOldestSnapshot({ storage })) throw error;
    }
  }
}
