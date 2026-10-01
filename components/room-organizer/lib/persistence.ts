import { STORAGE_KEY } from './constants';
import { notify } from './editor-notices';
import { isUntouched } from './restore-point';
import { parseStoredLayout, storedEntryCount } from './schema';
import { classifyStorageError, type StorageErrorKind } from './storage-errors';
import { setItemEvictingSnapshots } from './version-history';
import type { RoomLayout } from './types';
import type { VersionHistoryStore } from './version-history';

/**
 * `window.localStorage`, or null where storage is unavailable: the getter
 * throws where storage is blocked, and Firefox with `dom.storage.enabled=false`
 * returns null instead (#472).
 */
export function localStorageOrNull(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Parse a stored house through the schema, or null when it can't be one. */
export function parseLayoutJson(raw: string): RoomLayout | null {
  try {
    return parseStoredLayout(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadLayout(): RoomLayout | null {
  try {
    const raw = localStorageOrNull()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const layout = parseStoredLayout(parsed);
    // Over the caps, the load trims the house; the next autosave would make
    // that permanent. Keep the original first (#332).
    if (layout && storedEntryCount(layout) < storedEntryCount(parsed)) {
      // No room for the copy: treat the save as unopenable, so the caller
      // holds autosave off and the original stays the only thing stored.
      if (!backupStoredLayout()) return null;
      notify(
        'This house had more than the editor keeps on one floor, so some items were left out. The original is kept in Manage → Saved Layouts → History.',
        'info'
      );
    }
    return layout;
  } catch (error) {
    console.warn('Failed to load saved layout:', error);
    return null;
  }
}

/**
 * Prefix of the keys holding houses kept aside: a stored blob that exists but
 * can't be used — unreadable (JSON or schema failure, #113) or crashing on
 * apply (#206) — before the autosave loop overwrites it, and the house the
 * error screen's "start fresh" moved away (#336). Each copy lives under
 * `<prefix>-<savedAt>-<random>` (the random part keeps two tabs keeping a
 * copy in the same millisecond apart); `<prefix>-<savedAt>` and the bare
 * prefix are older shapes and are still read, the bare one as the oldest.
 */
export const RECOVERY_STORAGE_KEY = `${STORAGE_KEY}-recovery`;

/**
 * How many recovery copies are kept. Past the cap the oldest goes, and only
 * once the new one is written — or, on a full quota, once the house the new
 * copy is of is known to still be in the main save.
 */
export const MAX_RECOVERY_COPIES = 2;

/** The slice of `Storage` the recovery helpers use; injectable for tests. */
export type RawStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const DATED_SUFFIX = /^(\d+)(?:-[a-z0-9]+)?$/;

/** When the copy under `key` was kept: null for the undated legacy key, undefined for a key that isn't a copy. */
function recoverySavedAt(key: string): number | null | undefined {
  if (key === RECOVERY_STORAGE_KEY) return null;
  if (!key.startsWith(`${RECOVERY_STORAGE_KEY}-`)) return undefined;
  const match = DATED_SUFFIX.exec(key.slice(RECOVERY_STORAGE_KEY.length + 1));
  return match ? Number(match[1]) : undefined;
}

/** Whether a storage key holds a recovery copy. */
export function isRecoveryKey(key: string): boolean {
  return recoverySavedAt(key) !== undefined;
}

interface RecoverySlot {
  key: string;
  /** When the copy was kept; null for the legacy undated key. */
  savedAt: number | null;
}

/** Every recovery copy's key, oldest first. */
function recoverySlots(store: RawStore): RecoverySlot[] {
  const slots: RecoverySlot[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key === null) continue;
    const savedAt = recoverySavedAt(key);
    if (savedAt !== undefined) slots.push({ key, savedAt });
  }
  return slots.sort((a, b) => (a.savedAt ?? -1) - (b.savedAt ?? -1) || a.key.localeCompare(b.key));
}

/**
 * Whether two stored blobs hold the same house. Since every new house gets a
 * random id (#479), two blank lots — or a restored copy and the copy it was
 * restored from, re-serialised by the schema — differ as raw strings, so
 * houses that parse are compared by content without the id.
 */
/**
 * The layout a stored blob opens as, or null unless it opens with no repair
 * at all — the schema returns the very object it was given then (#332).
 */
function wholeLayout(raw: string): RoomLayout | null {
  try {
    const json: unknown = JSON.parse(raw);
    const layout = parseStoredLayout(json);
    return layout !== null && layout === json ? layout : null;
  } catch {
    return null;
  }
}

/**
 * Whether two stored blobs hold the same house. Parsed content decides only
 * when neither blob loses anything by parsing: an over-cap original and its
 * trimmed form parse alike, and treating them as one would drop the
 * original's only copy.
 */
function sameStoredHouse(a: string, b: string): boolean {
  if (a === b) return true;
  const left = wholeLayout(a);
  const right = wholeLayout(b);
  return left !== null && right !== null && sameLayoutContent(left, right);
}

function newRecoveryKey(store: RawStore, now: number, slots: RecoverySlot[]): string {
  const newest = slots.reduce((latest, { savedAt }) => Math.max(latest, savedAt ?? 0), 0);
  const stamp = Math.max(now, newest + 1);
  for (;;) {
    const key = `${RECOVERY_STORAGE_KEY}-${stamp}-${Math.random().toString(36).slice(2, 8) || '0'}`;
    if (store.getItem(key) === null) return key;
  }
}

/**
 * Keep `raw` as a recovery copy, or throw the storage error that stopped it.
 *
 * Nothing is kept of an untouched house (#346), and a house already kept
 * isn't kept twice. The write outranks restore points, which yield first
 * (#295). On a full quota older copies are dropped, oldest first, to make
 * room — the newest unreadable house is worth more than an old copy — but
 * only while that house is still in the main save, so at every step each
 * house is stored somewhere. If the copy still can't be written, the dropped
 * copies are put back in the room they left and the error is rethrown.
 */
function keepRecoveryCopy(store: RawStore, raw: string, now: number): boolean {
  const parsed = parseLayoutJson(raw);
  if (parsed && isUntouched(parsed)) return false;
  const slots = recoverySlots(store);
  const alreadyKept = slots.some(({ key }) => {
    const kept = store.getItem(key);
    return kept !== null && sameStoredHouse(kept, raw);
  });
  if (alreadyKept) return false;
  const key = newRecoveryKey(store, now, slots);
  const dropped: { key: string; raw: string }[] = [];
  // Every path that gives up puts the dropped copies back first: the new
  // copy wasn't written, so nothing was traded for them.
  const putBack = (): void => {
    for (const copy of dropped.reverse()) {
      try {
        store.setItem(copy.key, copy.raw);
      } catch {
        /* best effort — the main save still holds the house being copied */
      }
    }
  };
  let remaining = slots;
  for (;;) {
    try {
      setItemEvictingSnapshots(store, key, raw);
      break;
    } catch (error) {
      try {
        const oldest = remaining[0];
        const mayDrop = oldest !== undefined && classifyStorageError(error) === 'quota' && store.getItem(STORAGE_KEY) === raw;
        const oldestRaw = mayDrop ? store.getItem(oldest.key) : null;
        if (!oldest || oldestRaw === null) throw error;
        store.removeItem(oldest.key);
        dropped.push({ key: oldest.key, raw: oldestRaw });
        remaining = remaining.slice(1);
      } catch (failure) {
        putBack();
        throw failure;
      }
    }
  }
  for (const { key: stale } of remaining.slice(0, Math.max(0, remaining.length + 1 - MAX_RECOVERY_COPIES))) {
    try {
      store.removeItem(stale);
    } catch {
      /* an extra copy costs space, not data */
    }
  }
  return true;
}

/**
 * Copy the raw stored blob aside before it gets clobbered by the fallback
 * autosave. Call whenever the stored layout can't be brought up: after
 * loadLayout() returned null despite a blob existing (#113), or after
 * applying a parsed layout threw (#206). Returns whether the main save may
 * now be overwritten: true once the house is kept (or there is nothing worth
 * keeping), false when the copy couldn't be written — the caller must then
 * leave the main save alone, since it's the only copy of the house.
 */
export function backupStoredLayout(storage?: RawStore, now: number = Date.now()): boolean {
  const outcome = keepStoredLayout(storage, now);
  return outcome === 'kept' || outcome === 'nothing';
}

/**
 * `backupStoredLayout`, saying what happened: `'kept'` when a new copy was
 * written, `'nothing'` when there was nothing new worth keeping (no save, an
 * untouched house, a house already kept), else the storage error that
 * stopped it — "storage full" and "storage blocked" need different advice
 * (#472).
 */
export function keepStoredLayout(
  storage?: RawStore,
  now: number = Date.now()
): 'kept' | 'nothing' | StorageErrorKind {
  const target = storage ?? localStorageOrNull();
  if (!target) return 'nothing';
  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) return 'nothing';
    return keepRecoveryCopy(target, raw, now) ? 'kept' : 'nothing';
  } catch (error) {
    console.warn('Failed to back up stored layout; leaving it in place:', error);
    return classifyStorageError(error);
  }
}

/** Why a save didn't reach storage (#472). */
export type SaveFailureReason = StorageErrorKind;

export { classifyStorageError };

/** On success, `json` is exactly what was written — the cross-tab guard compares against it (#334). */
export type SaveResult = { ok: true; json: string } | { ok: false; reason: SaveFailureReason };


/**
 * Persist the layout, or say why it couldn't be (#472). Restore points are
 * the lowest-priority tenant of the quota: a failed write evicts them
 * oldest-first and retries before giving up (#295). `storage` is injectable
 * for tests and defaults to `window.localStorage`.
 */
export function saveLayout(layout: RoomLayout, storage?: VersionHistoryStore): SaveResult {
  if (!storage && typeof window === 'undefined') return { ok: false, reason: 'unknown' };
  try {
    const target = storage ?? localStorageOrNull();
    if (!target) return { ok: false, reason: 'blocked' };
    const json = JSON.stringify(layout);
    setItemEvictingSnapshots(target, STORAGE_KEY, json);
    return { ok: true, json };
  } catch (error) {
    // Reported to the caller so the HUD never shows "Saved" for a layout that
    // didn't persist, and can say what the user can do about it.
    console.warn('Failed to persist layout to localStorage:', error);
    return { ok: false, reason: classifyStorageError(error) };
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner;
    const record = inner as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

/**
 * Whether two layouts hold the same house, whatever order their keys were
 * written in — the schema and the reducer each rebuild objects their own
 * way, so raw JSON can differ for one house (#334).
 */
export function sameLayoutContent(a: RoomLayout, b: RoomLayout): boolean {
  return a === b || canonicalJson(withoutId(a)) === canonicalJson(withoutId(b));
}

/**
 * The id is a label, not content: two tabs on a fresh lot each mint their
 * own (#479) yet hold the same house.
 */
function withoutId(layout: RoomLayout): Partial<RoomLayout> {
  const copy: Partial<RoomLayout> = { ...layout };
  delete copy.id;
  return copy;
}

/**
 * What "start fresh" did with the stored house (#336): moved it to a
 * recovery copy, refused and left it where it was, or — only if storage
 * misbehaved mid-move — lost it from storage, so the caller's in-memory
 * copy is the last one and must be offered for download.
 */
export type ResetOutcome = 'moved' | 'refused' | 'lost';

/**
 * Move the stored house aside to a recovery copy and clear the main save,
 * for the error screen's "start fresh" (#336). Never deletes without a copy:
 * on a full quota the copy is retried in the space the original frees, and
 * the original is put back if even that fails.
 */
export function resetStoredLayout(storage?: RawStore, now: number = Date.now()): ResetOutcome {
  const target = storage ?? localStorageOrNull();
  if (!target) return 'refused';
  let raw: string | null;
  try {
    raw = target.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to read the saved layout before resetting:', error);
    return 'refused';
  }
  if (raw === null) return 'moved';
  const parsed = parseLayoutJson(raw);
  if (parsed && isUntouched(parsed)) {
    // A blank lot isn't worth a copy, and keeping one would push a real
    // house out of the copies kept (#336).
    try {
      target.removeItem(STORAGE_KEY);
      return 'moved';
    } catch {
      return 'refused';
    }
  }
  try {
    keepRecoveryCopy(target, raw, now);
  } catch (error) {
    if (classifyStorageError(error) !== 'quota') {
      console.warn('Failed to back up the saved layout; leaving it in place:', error);
      return 'refused';
    }
    try {
      target.removeItem(STORAGE_KEY);
      keepRecoveryCopy(target, raw, now);
      return 'moved';
    } catch (retryError) {
      console.warn('Failed to back up the saved layout; putting it back:', retryError);
      try {
        target.setItem(STORAGE_KEY, raw);
        return 'refused';
      } catch {
        try {
          return target.getItem(STORAGE_KEY) === raw ? 'refused' : 'lost';
        } catch {
          return 'lost';
        }
      }
    }
  }
  try {
    target.removeItem(STORAGE_KEY);
  } catch {
    // The copy exists and the original is still there: nothing was lost,
    // but nothing was reset either.
    return 'refused';
  }
  return 'moved';
}

/** The raw stored house (for a download), or null when absent or unreadable. */
export function readStoredLayoutRaw(storage?: RawStore): string | null {
  try {
    return (storage ?? localStorageOrNull())?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export interface RecoveryCopy {
  /** The storage key it lives under — what restore and delete address. */
  key: string;
  /** When it was kept; null for a copy from before copies were dated. */
  savedAt: number | null;
  raw: string;
  /** The copy validated through the schema, or null when it can't be used as a house. */
  layout: RoomLayout | null;
}

/** The houses kept aside (#336), newest first. */
export function readRecoveryCopies(storage?: RawStore): RecoveryCopy[] {
  const target = storage ?? localStorageOrNull();
  if (!target) return [];
  try {
    const copies: RecoveryCopy[] = [];
    for (const { key, savedAt } of recoverySlots(target).reverse()) {
      const raw = target.getItem(key);
      if (raw !== null) copies.push({ key, savedAt, raw, layout: parseLayoutJson(raw) });
    }
    return copies;
  } catch {
    return [];
  }
}

/** One recovery copy as it is stored right now, or null when it's gone or unreadable. */
export function readRecoveryCopy(key: string, storage?: RawStore): RecoveryCopy | null {
  if (!isRecoveryKey(key)) return null;
  let raw: string | null;
  try {
    raw = (storage ?? localStorageOrNull())?.getItem(key) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  return { key, savedAt: recoverySavedAt(key) ?? null, raw, layout: parseLayoutJson(raw) };
}

/** Whether the recovery copy under `key` is now gone. */
export function discardRecoveryCopy(key: string, storage?: RawStore): boolean {
  if (!isRecoveryKey(key)) return false;
  try {
    const target = storage ?? localStorageOrNull();
    if (!target) return false;
    target.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download a stored house exactly as stored — it may not parse, so it can't
 * go through `downloadLayoutAsJson`.
 */
export function downloadRawLayout(raw: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

const RELOAD_ATTEMPT_KEY = 'pc-error-reload';
/** A crash this soon after the error screen's reload means reloading didn't help. */
export const RELOAD_RETRY_WINDOW_MS = 2 * 60_000;
/** How long the editor must stay up after mounting before its reload counts as having worked. */
export const EDITOR_SETTLED_MS = 10_000;

/** Called by the error screen's "Reload" so the next crash knows it came back. */
export function noteReloadAttempt(now: number = Date.now(), session?: Pick<Storage, 'setItem'>): void {
  try {
    (session ?? window.sessionStorage).setItem(RELOAD_ATTEMPT_KEY, String(now));
  } catch {
    /* without the marker the reset is offered straight away */
  }
}

/**
 * Called once the editor has come up with the saved house: the reload
 * worked, so a later, unrelated crash must not read as a recurrence.
 */
export function clearReloadAttempt(session?: Pick<Storage, 'removeItem'>): void {
  try {
    (session ?? window.sessionStorage).removeItem(RELOAD_ATTEMPT_KEY);
  } catch {
    /* nothing to clear where session storage is unavailable */
  }
}

/**
 * Whether the error screen should suspect the saved house (#336): the crash
 * came back within moments of a reload. Without session storage there's no
 * way to tell, so the answer is yes rather than no way out.
 */
export function crashRecurredAfterReload(now: number = Date.now(), session?: Pick<Storage, 'getItem'>): boolean {
  try {
    const stamp = Number((session ?? window.sessionStorage).getItem(RELOAD_ATTEMPT_KEY));
    return stamp > 0 && now >= stamp && now - stamp < RELOAD_RETRY_WINDOW_MS;
  } catch {
    return true;
  }
}
