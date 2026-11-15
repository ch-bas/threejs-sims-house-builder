import { STORAGE_KEY } from './constants';
import { randomId } from './ids';
import { parseStoredLayout } from './schema';
import { classifyStorageError } from './storage-errors';
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
  /** `layout.id` of the house — see `sameHouse` (#342). */
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
 * head and tail. Whether a restore may put the current image back is
 * decided by the image itself, not by the house it seems to belong to: older
 * points carry no house id, and copies of a house (saved under two names,
 * shared) share one (#296). Sampled so a multi-megabyte image costs the
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

interface HouseRef {
  layoutId?: string | undefined;
  name?: string | undefined;
}

/**
 * Whether two snapshots are of one house, which scopes cadence and dedupe
 * (#296, #342). Every house gets a random `layout.id` when the store first
 * holds it (see `withHouseId`), so two houses that are both "My Home" are
 * still told apart. Only when neither side has an id — points and layouts
 * from before ids existed — does the name decide, the old rule, which errs
 * toward fewer restore points and can never flood the ring.
 */
function sameHouse(a: HouseRef, b: HouseRef): boolean {
  if (a.layoutId !== undefined || b.layoutId !== undefined) return a.layoutId === b.layoutId;
  return a.name !== undefined && a.name === b.name;
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
  return readRawEntries(storage, VERSION_HISTORY_STORAGE_KEY).map(({ entry }) => entry);
}

/** The entries stored under `key`, each with the raw record it was read from. */
function readRawEntries(
  storage: VersionHistoryStore,
  key: string
): { entry: StoredEntry; raw: Record<string, unknown> }[] {
  let parsed: unknown;
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: { entry: StoredEntry; raw: Record<string, unknown> }[] = [];
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
      entry: {
        id,
        savedAt,
        layoutId: optionalString(candidate.layoutId) ?? optionalString(layout.id),
        name: optionalString(candidate.name) ?? optionalString(layout.name),
        hadFloorPlan: candidate.hadFloorPlan === true,
        floorPlan: optionalString(candidate.floorPlan),
        itemCount: optionalCount(candidate.itemCount),
        floorCount: optionalCount(candidate.floorCount),
        layout,
      },
      raw: candidate,
    });
  }
  // Stored oldest-first; keep that invariant even if the blob was reordered.
  return entries.sort((a, b) => a.entry.savedAt - b.entry.savedAt);
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
      if (!isRecord(entry) || typeof entry.savedAt !== 'number') return null;
      entries.push({
        savedAt: entry.savedAt,
        layoutId: optionalString(entry.layoutId),
        name: optionalString(entry.name),
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
  const ref: HouseRef = { layoutId: layout.id, name: layout.name };

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
  // A kept version newer than the ring's newest of this house counts as the
  // newest (#935): keeping the newest point and leaving must not record the
  // same house straight back into the ring.
  const keptNewest = newestOfHouse(readKept(storage), ref);
  const latest = keptNewest && (!previous || keptNewest.savedAt > previous.savedAt) ? keptNewest : previous;
  if (latest && JSON.stringify(latest.layout) === layoutJson) return false;

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

/** An entry's History summary; null for a pre-#296 entry whose layout fails the schema. */
function summarise(entry: StoredEntry, at: number): VersionSummary | null {
  let { itemCount, floorCount } = entry;
  if (itemCount === undefined || floorCount === undefined) {
    const validated = parseStoredLayout(entry.layout);
    if (!validated) return null;
    itemCount = validated.floors.reduce((sum, floor) => sum + floor.items.length, 0);
    floorCount = validated.floors.length;
  }
  return {
    id: entry.id,
    savedAt: Math.min(entry.savedAt, at),
    itemCount,
    floorCount,
    name: entry.name ?? null,
    layoutId: entry.layoutId ?? null,
    hadFloorPlan: entry.hadFloorPlan === true,
    floorPlanFingerprint: entry.floorPlan ?? null,
  };
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
  // A point also on the kept list shows there only: two tabs keeping at
  // once can leave a stale copy in the ring until it ages out (#935).
  const kept = new Set(readKept(storage).map((entry) => entry.id));
  for (const entry of readEntries(storage)) {
    if (kept.has(entry.id)) continue;
    const summary = summarise(entry, at);
    if (summary) summaries.push(summary);
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

type HouseFields = Pick<VersionSummary, 'layoutId' | 'name'>;

function summaryRef(summary: HouseFields): HouseRef {
  return { layoutId: summary.layoutId ?? undefined, name: summary.name ?? undefined };
}

/** Whether two restore points are of one house (#296, #342). */
export function snapshotsShareHouse(a: HouseFields, b: HouseFields): boolean {
  return sameHouse(summaryRef(a), summaryRef(b));
}

/**
 * Whether the restore point holds exactly `layout`, so restoring it would
 * change nothing (#647). The same comparison `recordSnapshot` skips a
 * repeat with: the stored JSON, which never has the floor-plan image.
 */
export function snapshotIsLayout(id: string, layout: RoomLayout, opts: VersionHistoryOptions = {}): boolean {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return false;
  const stored = readSlots(storage).find((slot) => slot.entry.id === id);
  if (!stored) return false;
  const shown: RoomLayout = { ...layout };
  delete shown.floorPlanImage;
  return JSON.stringify(stored.entry.layout) === JSON.stringify(shown);
}

/**
 * Whether a restore point was taken from `layout`'s house (#296, #342): the
 * same id, or — when either side predates ids — the same name.
 */
export function snapshotBelongsTo(summary: HouseFields, layout: RoomLayout): boolean {
  return sameHouse(summaryRef(summary), { layoutId: layout.id, name: layout.name });
}

/** What `importSnapshots` did. */
export interface ImportedSnapshots {
  added: number;
  /** Points left out: unreadable, or no room left under the caps or the quota. */
  skipped: number;
}

/**
 * Put restore points from a backup file back in the ring (#620), beside the
 * ones already there. Each entry is read as the ring reads its own and its
 * layout validated through the schema; one whose id, or whose house and
 * layout, the ring already holds is skipped as already there. This browser's
 * own points always stay: imported ones, newest first, fill only the room
 * the caps leave after them. On a full quota imported points give way, the
 * oldest first, and nothing else is evicted — restore points stay the
 * lowest-priority tenant. Kept versions among them (#935) are put back as
 * kept, by `importKeptVersions`.
 */
export function importSnapshots(candidates: readonly unknown[], opts: VersionHistoryOptions = {}): ImportedSnapshots {
  // An entry that carries a kept version's name and time is one (#935): it
  // goes back on the kept list, first, so a full ring can't cost it.
  const kept = candidates.filter(isKeptCandidate);
  if (kept.length === 0) return importRingSnapshots(candidates, opts);
  const keptResult = importKeptVersions(kept, opts);
  const ring = importRingSnapshots(
    candidates.filter((candidate) => !isKeptCandidate(candidate)),
    opts
  );
  return { added: keptResult.added + ring.added, skipped: keptResult.skipped + ring.skipped };
}

function isKeptCandidate(candidate: unknown): boolean {
  return isRecord(candidate) && typeof candidate.label === 'string' && optionalCount(candidate.keptAt) !== undefined;
}

function importRingSnapshots(candidates: readonly unknown[], opts: VersionHistoryOptions): ImportedSnapshots {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return { added: 0, skipped: candidates.length };
  const at = (opts.now ?? Date.now)();
  const local = readSlots(storage);
  // Kept versions (#935) are held too: a point this browser keeps is not
  // brought back into the ring beside it.
  const keptSlots: Slot[] = readKept(storage).map((entry) => ({ entry, json: '' }));
  const ids = new Set([...local, ...keptSlots].map((slot) => slot.entry.id));
  const incoming: Slot[] = [];
  const read = readEntries({ getItem: () => JSON.stringify(candidates), setItem: () => undefined });
  // Entries the reader drops outright (no time, no layout) can't be restored.
  let skipped = candidates.length - read.length;
  for (const entry of read) {
    const layout = parseStoredLayout(entry.layout);
    if (!layout) {
      skipped += 1;
      continue;
    }
    if (ids.has(entry.id)) continue;
    const stored: RoomLayout = { ...layout };
    delete stored.floorPlanImage;
    const layoutJson = JSON.stringify(stored);
    const held = [...local, ...keptSlots, ...incoming].some(
      (slot) => sameHouse(slot.entry, entry) && JSON.stringify(slot.entry.layout) === layoutJson
    );
    if (held) continue;
    const added: StoredEntry = { ...entry, savedAt: Math.min(entry.savedAt, at), layout: stored };
    incoming.push({ entry: added, json: JSON.stringify(added) });
    ids.add(entry.id);
  }
  incoming.sort((a, b) => b.entry.savedAt - a.entry.savedAt);
  const kept: Slot[] = [];
  for (const slot of incoming) {
    const fits =
      local.length + kept.length < VERSION_HISTORY_LIMIT &&
      serialisedLength([...local, ...kept, slot]) <= VERSION_HISTORY_MAX_CHARS;
    if (fits) kept.push(slot);
    else skipped += 1;
  }
  while (kept.length > 0) {
    const ring = [...local, ...kept].sort((a, b) => a.entry.savedAt - b.entry.savedAt);
    try {
      storage.setItem(VERSION_HISTORY_STORAGE_KEY, serialiseSlots(ring));
      writeMeta(storage, ring);
      notify();
      return { added: kept.length, skipped };
    } catch {
      // The failed write left the ring as it was; give up the oldest import.
      kept.pop();
      skipped += 1;
    }
  }
  return { added: 0, skipped };
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

/** The restore-point ring exactly as stored. */
export interface StoredSnapshots {
  ring: string | null;
  meta: string | null;
}

/** Read the ring as stored: what a library save counts as reclaimable room (#565). */
export function readStoredSnapshots(storage: VersionHistoryStore): StoredSnapshots {
  try {
    return { ring: storage.getItem(VERSION_HISTORY_STORAGE_KEY), meta: storage.getItem(VERSION_HISTORY_META_KEY) };
  } catch {
    return { ring: null, meta: null };
  }
}

/**
 * The most localStorage any major browser gives one origin, in UTF-16 code
 * units of key plus value (Chromium: 10 MiB of UTF-16; Firefox and Safari:
 * 5 MiB). An entry over this can never be written, whatever is evicted.
 */
export const MAX_STORAGE_ENTRY_CHARS = 5 * 1024 * 1024;

export interface EvictionOptions {
  /**
   * The open house's own save only (#935): once the ring is empty, kept
   * versions give way too, the oldest kept first. The house always wins.
   */
  evictKept?: boolean;
}

/**
 * `storage.setItem` for data that outranks restore points (#295): on a
 * quota error the ring is evicted oldest-first and the write retried; any
 * other error is rethrown at once with the ring untouched. With
 * `evictKept`, kept versions follow the ring as a last resort; if the write
 * fails even so, they are put back, since nothing was traded for them.
 * Rethrows the storage error once there is nothing left to evict and the
 * write still fails. An entry that alone exceeds any browser's quota is
 * refused up front with a `QuotaExceededError` and evicts nothing: those
 * restore points are the only way back to the house it would have replaced
 * (#332). Returns the names of the kept versions it removed ('' for a
 * corrupt list).
 */
export function setItemEvictingSnapshots(
  storage: VersionHistoryStore,
  key: string,
  value: string,
  opts: EvictionOptions = {}
): string[] {
  if (key.length + value.length > MAX_STORAGE_ENTRY_CHARS) {
    throw new DOMException(
      `"${key}" is ${value.length} characters, more than browser storage can ever hold.`,
      'QuotaExceededError'
    );
  }
  const keptBefore = opts.evictKept ? safeRead(storage, VERSION_KEPT_STORAGE_KEY) : null;
  const evicted: string[] = [];
  for (;;) {
    try {
      storage.setItem(key, value);
      if (evicted.length > 0) notify();
      return evicted;
    } catch (error) {
      // Eviction frees space, so only a quota error costs a restore point:
      // storage that is blocked outright fails the same way afterwards.
      if (classifyStorageError(error) !== 'quota') throw error;
      if (evictOldestSnapshot({ storage })) continue;
      const dropped = opts.evictKept ? evictOldestKept(storage) : null;
      if (dropped) {
        evicted.push(dropped.label);
        continue;
      }
      if (keptBefore !== null && evicted.length > 0) {
        try {
          storage.setItem(VERSION_KEPT_STORAGE_KEY, keptBefore);
        } catch {
          /* it fitted before, in no more room than is free now */
        }
      }
      throw error;
    }
  }
}

function safeRead(storage: VersionHistoryStore, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Kept versions (#935): restore points the player pinned so they outlive the
// ring. A separate small list the ring never pushes out. Its writes are
// plain: keeping evicts nothing (a keep from the ring takes the room of
// the ring copy it replaces), and a failed keep or unpin puts the bytes it
// changed back exactly. Capped (count and size), and a keep is refused when
// it would leave the open house no room to save (`roomCheck`).
// The open house's own save still outranks them: as a last resort it evicts
// kept versions too, oldest kept first (`evictKept`). Like ring entries they
// never carry `floorPlanImage`.
// ---------------------------------------------------------------------------

/** Where kept versions live, beside the ring. */
export const VERSION_KEPT_STORAGE_KEY = `${VERSION_HISTORY_STORAGE_KEY}-kept`;

/** At most this many kept versions. */
export const VERSION_KEPT_LIMIT = 5;

/** Ceiling on the serialised kept list, in characters of JSON (as the ring's). */
export const VERSION_KEPT_MAX_CHARS = 512 * 1024;

/** Longest name a kept version takes. */
export const KEPT_LABEL_MAX_LENGTH = 80;

interface KeptEntry extends StoredEntry {
  /** The player's name for this version. */
  label: string;
  /** When it was kept: the list's order, newest first. */
  keptAt: number;
}

/** A kept version as the History list shows it. */
export interface KeptVersionSummary extends VersionSummary {
  label: string;
  keptAt: number;
}

// C0 and C1 controls, zero-width and bidi marks and overrides, line and
// paragraph separators, the BOM: none belongs in a name shown in a list.
const LABEL_STRIP = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

/** A name as stored and shown: one line, no hidden characters, capped. */
export function cleanKeptLabel(label: string): string {
  return label.replace(LABEL_STRIP, ' ').replace(/\s+/g, ' ').trim().slice(0, KEPT_LABEL_MAX_LENGTH).trim();
}

function defaultLabel(entry: StoredEntry): string {
  return cleanKeptLabel(entry.name ?? '') || 'Kept version';
}

/** Entries read from `key` as kept versions: a label (or a default) and a keptAt each. */
function readKeptFrom(storage: VersionHistoryStore, key: string): KeptEntry[] {
  return readRawEntries(storage, key)
    .map(({ entry, raw }) => {
      const label = typeof raw.label === 'string' ? cleanKeptLabel(raw.label) : '';
      const keptAt = optionalCount(raw.keptAt) ?? entry.savedAt;
      return { ...entry, label: label || defaultLabel(entry), keptAt };
    })
    .sort((a, b) => a.keptAt - b.keptAt);
}

/** The kept list as stored, tolerating corrupt data; oldest kept first. */
function readKept(storage: VersionHistoryStore): KeptEntry[] {
  return readKeptFrom(storage, VERSION_KEPT_STORAGE_KEY);
}

function serialiseEntries(entries: readonly StoredEntry[]): string {
  return JSON.stringify(entries);
}

/**
 * Write the kept list, or remove it when empty. A plain write: it evicts
 * nothing, so a write that fails leaves storage as it was. Throws what the
 * store threw.
 */
function writeKept(storage: VersionHistoryStore, entries: readonly KeptEntry[]): void {
  if (entries.length === 0) removeKey(storage, VERSION_KEPT_STORAGE_KEY);
  else storage.setItem(VERSION_KEPT_STORAGE_KEY, serialiseEntries(entries));
}

/** A key's stored value, to put back exactly; undefined when it couldn't be read. */
function snapshotKey(storage: VersionHistoryStore, key: string): string | null | undefined {
  try {
    return storage.getItem(key);
  } catch {
    return undefined;
  }
}

/** Put back what `snapshotKey` read, with a plain write: nothing is evicted for it. */
function putBack(storage: VersionHistoryStore, key: string, value: string | null | undefined): void {
  if (value === undefined) return;
  try {
    if (value === null) removeKey(storage, key);
    else if (storage.getItem(key) !== value) storage.setItem(key, value);
  } catch {
    /* best effort: the room it held was taken meanwhile */
  }
}

/**
 * Drop the kept version kept longest ago, for the open house's save. Null
 * when there is nothing to drop; a corrupt list, which holds quota but no
 * usable entry, is removed and reported with an empty label.
 */
function evictOldestKept(storage: VersionHistoryStore): { label: string } | null {
  if (safeRead(storage, VERSION_KEPT_STORAGE_KEY) === null) return null;
  const kept = readKept(storage);
  const oldest = kept.shift();
  try {
    if (kept.length === 0) removeKey(storage, VERSION_KEPT_STORAGE_KEY);
    else storage.setItem(VERSION_KEPT_STORAGE_KEY, serialiseEntries(kept));
  } catch {
    // A shorter list that still won't write: drop them all rather than none.
    removeKey(storage, VERSION_KEPT_STORAGE_KEY);
  }
  if (safeRead(storage, VERSION_KEPT_STORAGE_KEY) !== null && kept.length === 0) return null;
  return { label: oldest?.label ?? '' };
}

/** Kept versions, newest kept first. Entries predating #296 summaries are validated. */
export function listKeptVersions(opts: VersionHistoryOptions = {}): KeptVersionSummary[] {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return [];
  const at = (opts.now ?? Date.now)();
  const kept: KeptVersionSummary[] = [];
  for (const entry of readKept(storage)) {
    const summary = summarise(entry, at);
    if (summary) kept.push({ ...summary, label: entry.label, keptAt: entry.keptAt });
  }
  return kept.reverse();
}

/** The full layout of a kept version, through the schema; null if gone or unreadable. */
export function getKeptVersion(id: string, opts: VersionHistoryOptions = {}): RoomLayout | null {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return null;
  const entry = readKept(storage).find((candidate) => candidate.id === id);
  return entry ? parseStoredLayout(entry.layout) : null;
}

/** Why a version couldn't be kept. */
export type KeepRefusal = 'missing' | 'unreadable' | 'full' | 'too-big' | 'autosave-room' | 'storage' | 'already';

export type KeepResult = { ok: true; id: string } | { ok: false; reason: KeepRefusal };

export const KEEP_REFUSAL_TEXT: Record<KeepRefusal, string> = {
  missing: 'That restore point is gone: it was cleared to make room.',
  unreadable: 'That restore point can’t be read, so it can’t be kept.',
  full: `${VERSION_KEPT_LIMIT} versions are kept already. Stop keeping one first.`,
  'too-big': 'There’s no room to keep this version beside the others. Stop keeping one first.',
  'autosave-room': 'Keeping this version would leave your house no room to save. Free some space in Storage & backup first.',
  storage: 'Couldn’t keep this version: the browser’s storage is full or blocked.',
  already: 'This version is kept already.',
};

/**
 * The room check a keep runs before it writes, given the characters the
 * kept copy will hold beyond what the ring gives up for it: a refusal, or
 * null to go ahead. The library's autosave-headroom rule
 * (`keepRoomShortfall`); injected, since the library builds on this module.
 */
export type KeepRoomCheck = (pinnedChars: number) => KeepRefusal | null;

export interface KeepOptions extends VersionHistoryOptions {
  label?: string;
  roomCheck?: KeepRoomCheck;
}

/**
 * Move a restore point from the ring to the kept list. The ring copy is
 * removed first, so its room goes to the kept copy instead of evicting
 * other points for it; it is held in memory and put back if the kept list
 * can't be written. The kept list is read again right before the write and
 * the new entry added to what it holds then, so a keep made meanwhile (in
 * another tab) is never written over.
 */
export function keepSnapshot(id: string, opts: KeepOptions = {}): KeepResult {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return { ok: false, reason: 'storage' };
  const entry = readEntries(storage).find((candidate) => candidate.id === id);
  if (!entry) {
    return readKept(storage).some((candidate) => candidate.id === id) ? { ok: true, id } : { ok: false, reason: 'missing' };
  }
  if (!parseStoredLayout(entry.layout)) return { ok: false, reason: 'unreadable' };
  const at = (opts.now ?? Date.now)();
  const kept = readKept(storage);
  if (kept.some((candidate) => candidate.id === id)) {
    removeFromRing(storage, id);
    notify();
    return { ok: true, id };
  }
  if (kept.length >= VERSION_KEPT_LIMIT) return { ok: false, reason: 'full' };
  const added: KeptEntry = {
    ...entry,
    label: cleanKeptLabel(opts.label ?? '') || defaultLabel(entry),
    keptAt: Math.max(at, (kept[kept.length - 1]?.keptAt ?? -Infinity) + 1),
  };
  const addedChars = JSON.stringify(added).length;
  if (serialiseEntries([...kept, added]).length > VERSION_KEPT_MAX_CHARS) return { ok: false, reason: 'too-big' };
  const refusal = opts.roomCheck?.(addedChars) ?? null;
  if (refusal) return { ok: false, reason: refusal };

  // The ring copy goes first, so the kept copy takes its room instead of
  // needing as much again. Every write is plain: nothing is evicted for a
  // keep, and a keep that fails puts the ring's own bytes back.
  const ring = snapshotKey(storage, VERSION_HISTORY_STORAGE_KEY);
  const meta = snapshotKey(storage, VERSION_HISTORY_META_KEY);
  removeFromRing(storage, id);
  const result = addKept(storage, added);
  if (!result.ok) {
    // In the reverse order of the writes: the sidecar first, so the room it
    // took (it may not have existed) is free again for the ring's bytes.
    putBack(storage, VERSION_HISTORY_META_KEY, meta);
    putBack(storage, VERSION_HISTORY_STORAGE_KEY, ring);
  }
  notify();
  return result;
}

/** Add one entry to the kept list as it stands now (read again: merge by id). */
function addKept(storage: VersionHistoryStore, added: KeptEntry): KeepResult {
  const fresh = readKept(storage);
  if (fresh.some((candidate) => candidate.id === added.id)) return { ok: true, id: added.id };
  if (fresh.length >= VERSION_KEPT_LIMIT) return { ok: false, reason: 'full' };
  const next = [...fresh, added];
  if (serialiseEntries(next).length > VERSION_KEPT_MAX_CHARS) return { ok: false, reason: 'too-big' };
  try {
    writeKept(storage, next);
  } catch {
    return { ok: false, reason: 'storage' };
  }
  return { ok: true, id: added.id };
}

/**
 * Keep the house on screen as it is now (#935). The entry is built in
 * memory and every check runs before anything is written; it then goes
 * straight onto the kept list, never through the ring, so no restore point
 * gives way for it and a refusal leaves storage exactly as it was. A house
 * identical to a version of it already kept is kept already.
 */
export function keepLayout(layout: RoomLayout, opts: KeepOptions = {}): KeepResult {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return { ok: false, reason: 'storage' };
  const at = (opts.now ?? Date.now)();
  const ref: HouseRef = { layoutId: layout.id, name: layout.name };
  const shown: RoomLayout = { ...layout };
  delete shown.floorPlanImage;
  const json = JSON.stringify(shown);
  const kept = readKept(storage);
  if (kept.some((entry) => sameHouse(entry, ref) && JSON.stringify(entry.layout) === json)) {
    return { ok: false, reason: 'already' };
  }
  if (kept.length >= VERSION_KEPT_LIMIT) return { ok: false, reason: 'full' };
  const entry: StoredEntry = {
    id: randomId('rp'),
    savedAt: at,
    layoutId: layout.id,
    name: layout.name,
    hadFloorPlan: Boolean(layout.floorPlanImage),
    floorPlan: floorPlanFingerprint(layout.floorPlanImage) ?? undefined,
    itemCount: layout.floors.reduce((sum, floor) => sum + floor.items.length, 0),
    floorCount: layout.floors.length,
    layout: shown,
  };
  const added: KeptEntry = {
    ...entry,
    label: cleanKeptLabel(opts.label ?? '') || defaultLabel(entry),
    keptAt: Math.max(at, (kept[kept.length - 1]?.keptAt ?? -Infinity) + 1),
  };
  if (serialiseEntries([...kept, added]).length > VERSION_KEPT_MAX_CHARS) return { ok: false, reason: 'too-big' };
  // Nothing comes out of the ring for it: all of it is new room.
  const refusal = opts.roomCheck?.(JSON.stringify(added).length) ?? null;
  if (refusal) return { ok: false, reason: refusal };
  const result = addKept(storage, added);
  if (result.ok) notify();
  return result;
}

/** Drop one entry from the ring; best effort (a leftover only shows twice). */
function removeFromRing(storage: VersionHistoryStore, id: string): void {
  const slots = readSlots(storage);
  const left = slots.filter((slot) => slot.entry.id !== id);
  if (left.length === slots.length) return;
  try {
    if (left.length === 0) {
      removeKey(storage, VERSION_HISTORY_STORAGE_KEY);
      removeKey(storage, VERSION_HISTORY_META_KEY);
    } else {
      storage.setItem(VERSION_HISTORY_STORAGE_KEY, serialiseSlots(left));
      writeMeta(storage, left);
    }
  } catch {
    /* a smaller write than before; nothing else to do */
  }
}

/** Rename a kept version. False when it is gone or the name is empty. */
export function renameKeptVersion(id: string, label: string, opts: VersionHistoryOptions = {}): boolean {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return false;
  const clean = cleanKeptLabel(label);
  if (!clean) return false;
  const kept = readKept(storage);
  const index = kept.findIndex((candidate) => candidate.id === id);
  const entry = kept[index];
  if (!entry) return false;
  if (entry.label === clean) return true;
  kept[index] = { ...entry, label: clean };
  try {
    writeKept(storage, kept);
  } catch {
    return false;
  }
  notify();
  return true;
}

/**
 * Where a version goes once it is no longer kept: back among the restore
 * points, or deleted at once because the full ring holds only newer points
 * (or the ring's size cap leaves it no room).
 */
export type UnkeepOutcome = 'history' | 'deleted';

/**
 * What unpinning a version will do: where it goes, and the times of the
 * restore points that give way for it, oldest first (a full ring takes it
 * back only by clearing its oldest point).
 */
export interface UnkeepPlan {
  outcome: UnkeepOutcome;
  clears: number[];
}

function planFor(storage: VersionHistoryStore, entry: KeptEntry): { slots: Slot[]; plan: UnkeepPlan } {
  const before = readSlots(storage).filter((slot) => slot.entry.id !== entry.id);
  const slots = ringWith(storage, asRingEntry(entry));
  const outcome: UnkeepOutcome = slots.some((slot) => slot.entry.id === entry.id) ? 'history' : 'deleted';
  const left = new Set(slots.map((slot) => slot.entry.id));
  const clears = outcome === 'deleted' ? [] : before.filter((slot) => !left.has(slot.entry.id)).map((slot) => slot.entry.savedAt);
  return { slots, plan: { outcome, clears } };
}

/** The ring with `entry` placed in time order under the ring's caps, oldest dropped first. */
function ringWith(storage: VersionHistoryStore, entry: StoredEntry): Slot[] {
  const slots = readSlots(storage).filter((slot) => slot.entry.id !== entry.id);
  slots.push({ entry, json: JSON.stringify(entry) });
  slots.sort((a, b) => a.entry.savedAt - b.entry.savedAt);
  while (slots.length > VERSION_HISTORY_LIMIT) slots.shift();
  while (slots.length > 0 && serialisedLength(slots) > VERSION_HISTORY_MAX_CHARS) slots.shift();
  return slots;
}

function asRingEntry(entry: KeptEntry): StoredEntry {
  const { label: _label, keptAt: _keptAt, ...stored } = entry;
  return stored;
}

/** What `unkeepVersion` would do with `id` now, for the question before it; null if it isn't kept. */
export function unkeepOutcome(id: string, opts: VersionHistoryOptions = {}): UnkeepPlan | null {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return null;
  const entry = readKept(storage).find((candidate) => candidate.id === id);
  return entry ? planFor(storage, entry).plan : null;
}

/** What `unkeepVersion` did. */
export type UnkeptVersion =
  /**
   * `lost`: another writer took the room the kept list freed before the ring
   * could take the version, so it is gone; every restore point stays.
   */
  | ({ removed: true; lost?: true } & UnkeepPlan)
  /** `missing`: not kept (any more). `no-room`/`storage`: it stays kept. */
  | { removed: false; reason: 'missing' | 'no-room' | 'storage' };

/**
 * Stop keeping a version. The kept list shrinks first, so the room it frees
 * is what the ring takes back; the version goes into the ring in time
 * order, under the ring's caps — and so is deleted at once when it is older
 * than everything a full ring holds (`unkeepOutcome` says so beforehand).
 * Nothing in the ring gives way to it beyond those caps: when the ring
 * can't be written, it goes back on the kept list.
 */
export function unkeepVersion(id: string, opts: VersionHistoryOptions = {}): UnkeptVersion {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return { removed: false, reason: 'storage' };
  const kept = readKept(storage);
  const entry = kept.find((candidate) => candidate.id === id);
  if (!entry) return { removed: false, reason: 'missing' };
  const keptBytes = snapshotKey(storage, VERSION_KEPT_STORAGE_KEY);
  try {
    writeKept(
      storage,
      kept.filter((candidate) => candidate.id !== id)
    );
  } catch {
    return { removed: false, reason: 'storage' };
  }
  const { slots, plan } = planFor(storage, entry);
  if (plan.outcome === 'deleted') {
    notify();
    return { removed: true, ...plan };
  }
  try {
    storage.setItem(VERSION_HISTORY_STORAGE_KEY, serialiseSlots(slots));
    writeMeta(storage, slots);
  } catch (error) {
    // The room the kept copy freed wasn't enough: the kept list's own bytes
    // go back, with a plain write, and it stays kept.
    putBack(storage, VERSION_KEPT_STORAGE_KEY, keptBytes);
    notify();
    if (!readKept(storage).some((candidate) => candidate.id === id)) {
      return { removed: true, lost: true, outcome: 'deleted', clears: [] };
    }
    return { removed: false, reason: classifyStorageError(error) === 'quota' ? 'no-room' : 'storage' };
  }
  notify();
  return { removed: true, ...plan };
}

/**
 * The kept list for a backup's `keptVersions` part: every readable entry
 * with its name and the time it was kept, oldest kept first.
 */
export function readKeptEntriesForBackup(storage: VersionHistoryStore): unknown[] {
  return readKept(storage);
}

/** What `importKeptVersions` did. */
export interface ImportedKeptVersions {
  added: number;
  /** Left out: unreadable, or no room under the caps, the autosave rule or the quota. */
  skipped: number;
}

/**
 * Put kept versions from a backup file back on the kept list (#935): add
 * only, beside the ones kept here, under the same caps. One whose id this
 * browser already keeps or holds in the ring, or whose house and layout it
 * already keeps, is skipped as already there. Most recently kept first;
 * `roomCheck` refuses what would leave the open house no room to save.
 */
export function importKeptVersions(candidates: readonly unknown[], opts: KeepOptions = {}): ImportedKeptVersions {
  const storage = opts.storage ?? defaultStorage();
  if (!storage) return { added: 0, skipped: candidates.length };
  const at = (opts.now ?? Date.now)();
  const read = readKeptFrom({ getItem: () => JSON.stringify(candidates), setItem: () => undefined }, 'backup');
  let skipped = candidates.length - read.length;
  const local = readKept(storage);
  const ids = new Set([...local.map((entry) => entry.id), ...readEntries(storage).map((entry) => entry.id)]);
  const incoming: KeptEntry[] = [];
  for (const entry of read.reverse()) {
    const layout = parseStoredLayout(entry.layout);
    if (!layout) {
      skipped += 1;
      continue;
    }
    if (ids.has(entry.id)) continue;
    const stored: RoomLayout = { ...layout };
    delete stored.floorPlanImage;
    const layoutJson = JSON.stringify(stored);
    if ([...local, ...incoming].some((held) => sameHouse(held, entry) && JSON.stringify(held.layout) === layoutJson)) continue;
    const next: KeptEntry = { ...entry, savedAt: Math.min(entry.savedAt, at), keptAt: Math.min(entry.keptAt, at), layout: stored };
    const fits =
      local.length + incoming.length < VERSION_KEPT_LIMIT &&
      serialiseEntries([...local, ...incoming, next]).length <= VERSION_KEPT_MAX_CHARS &&
      (opts.roomCheck?.(serialiseEntries([...incoming, next]).length) ?? null) === null;
    if (fits) {
      incoming.push(next);
      ids.add(entry.id);
    } else {
      skipped += 1;
    }
  }
  while (incoming.length > 0) {
    // Read again right before the write, as a keep does: merge by id.
    const fresh = readKept(storage);
    const adding = incoming.filter((entry) => !fresh.some((held) => held.id === entry.id));
    if (fresh.length + adding.length > VERSION_KEPT_LIMIT) {
      incoming.pop();
      skipped += 1;
      continue;
    }
    try {
      writeKept(storage, [...fresh, ...adding].sort((a, b) => a.keptAt - b.keptAt));
      notify();
      return { added: adding.length, skipped };
    } catch {
      // Give up the least recently kept import and try again.
      incoming.pop();
      skipped += 1;
    }
  }
  return { added: 0, skipped };
}
