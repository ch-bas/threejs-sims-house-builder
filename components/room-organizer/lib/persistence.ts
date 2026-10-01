import { STORAGE_KEY } from './constants';
import { notify } from './editor-notices';
import { parseStoredLayout, storedEntryCount } from './schema';
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
      backupStoredLayout();
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
 * `<prefix>-<savedAt>`; the bare prefix is where the single copy used to go
 * and is still read, as the oldest.
 */
export const RECOVERY_STORAGE_KEY = `${STORAGE_KEY}-recovery`;

/**
 * How many recovery copies are kept. No copy is ever overwritten: the oldest
 * goes only once a newer one has been written past this cap, so the copy the
 * user was just told about, and the one before it, always survive.
 */
export const MAX_RECOVERY_COPIES = 2;

/** The slice of `Storage` the recovery helpers use; injectable for tests. */
export type RawStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Whether a storage key holds a recovery copy. */
export function isRecoveryKey(key: string): boolean {
  if (key === RECOVERY_STORAGE_KEY) return true;
  if (!key.startsWith(`${RECOVERY_STORAGE_KEY}-`)) return false;
  return /^\d+$/.test(key.slice(RECOVERY_STORAGE_KEY.length + 1));
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
    if (key === null || !isRecoveryKey(key)) continue;
    const savedAt = key === RECOVERY_STORAGE_KEY ? null : Number(key.slice(RECOVERY_STORAGE_KEY.length + 1));
    slots.push({ key, savedAt });
  }
  return slots.sort((a, b) => (a.savedAt ?? -1) - (b.savedAt ?? -1));
}

/**
 * Keep `raw` as a recovery copy, or throw the storage error that stopped it.
 * A copy with the same content isn't duplicated, no kept copy is replaced,
 * and the oldest are dropped only after the new one is safely written.
 */
function keepRecoveryCopy(store: RawStore, raw: string, now: number): void {
  const slots = recoverySlots(store);
  if (slots.some(({ key }) => store.getItem(key) === raw)) return;
  const newest = slots.reduce((latest, { savedAt }) => Math.max(latest, savedAt ?? 0), 0);
  store.setItem(`${RECOVERY_STORAGE_KEY}-${Math.max(now, newest + 1)}`, raw);
  for (const { key } of slots.slice(0, Math.max(0, slots.length + 1 - MAX_RECOVERY_COPIES))) {
    try {
      store.removeItem(key);
    } catch {
      /* an extra copy costs space, not data */
    }
  }
}

/**
 * Copy the raw stored blob aside before it gets clobbered by the fallback
 * autosave. Call whenever the stored layout can't be brought up: after
 * loadLayout() returned null despite a blob existing (#113), or after
 * applying a parsed layout threw (#206). Best-effort; a quota failure here
 * must not break the mount.
 */
export function backupStoredLayout(storage?: RawStore, now: number = Date.now()): void {
  const target = storage ?? localStorageOrNull();
  if (!target) return;
  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) return;
    keepRecoveryCopy(target, raw, now);
    console.warn('Saved layout can’t be used; a copy was kept in Manage → Saved Layouts → History.');
  } catch (error) {
    console.warn('Failed to back up stored layout:', error);
  }
}

/** Why a save didn't reach storage (#472). */
export type SaveFailureReason = 'quota' | 'blocked' | 'unknown';

/** On success, `json` is exactly what was written — the cross-tab guard compares against it (#334). */
export type SaveResult = { ok: true; json: string } | { ok: false; reason: SaveFailureReason };

/**
 * A full quota and blocked storage need different advice: deleting things
 * helps the first and does nothing for the second (#472). Quota errors carry
 * the name `QuotaExceededError` (old Firefox: `NS_ERROR_DOM_QUOTA_REACHED`)
 * or the legacy codes 22 / 1014; blocked storage throws a `SecurityError`
 * (code 18), from the `window.localStorage` getter or from the call itself.
 */
export function classifyStorageError(error: unknown): SaveFailureReason {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const { name, code } = error as { name?: unknown; code?: unknown };
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) {
    return 'quota';
  }
  if (name === 'SecurityError' || code === 18) return 'blocked';
  return 'unknown';
}

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
  return a === b || canonicalJson(a) === canonicalJson(b);
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
  const savedAt = key === RECOVERY_STORAGE_KEY ? null : Number(key.slice(RECOVERY_STORAGE_KEY.length + 1));
  return { key, savedAt, raw, layout: parseLayoutJson(raw) };
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
