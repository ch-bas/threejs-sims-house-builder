import { STORAGE_KEY } from './constants';
import { notify } from './editor-notices';
import { parseStoredLayout, storedEntryCount } from './schema';
import { setItemEvictingSnapshots } from './version-history';
import type { RoomLayout } from './types';
import type { VersionHistoryStore } from './version-history';

export function loadLayout(): RoomLayout | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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
 * Where a stored blob that exists but can't be used — unreadable (JSON or
 * schema failure, #113) or parseable but crashing on apply (#206) — is
 * stashed before the autosave loop can overwrite it with the fallback
 * layout. The user's house survives for manual recovery.
 */
export const RECOVERY_STORAGE_KEY = `${STORAGE_KEY}-recovery`;

/**
 * Copy the raw stored blob aside before it gets clobbered by the fallback
 * autosave. Call whenever the stored layout can't be brought up: after
 * loadLayout() returned null despite a blob existing (#113), or after
 * applying a parsed layout threw (#206). Best-effort; a quota failure here
 * must not break the mount.
 */
export function backupStoredLayout(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, raw);
    console.warn(`Saved layout can't be used; a copy was kept under "${RECOVERY_STORAGE_KEY}".`);
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
    const json = JSON.stringify(layout);
    setItemEvictingSnapshots(storage ?? window.localStorage, STORAGE_KEY, json);
    return { ok: true, json };
  } catch (error) {
    // Reported to the caller so the HUD never shows "Saved" for a layout that
    // didn't persist, and can say what the user can do about it.
    console.warn('Failed to persist layout to localStorage:', error);
    return { ok: false, reason: classifyStorageError(error) };
  }
}

/** The slice of `Storage` the recovery helpers use; injectable for tests. */
export type RawStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

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

// The `window.localStorage` getter itself throws where storage is blocked;
// every caller sits inside a try.
function storageOrDefault(storage: RawStore | undefined): RawStore {
  return storage ?? window.localStorage;
}

/**
 * What "start fresh" did with the stored house (#336): moved it to the
 * recovery key, refused and left it where it was, or — only if storage
 * misbehaved mid-move — lost it from storage, so the caller's in-memory
 * copy is the last one and must be offered for download.
 */
export type ResetOutcome = 'moved' | 'refused' | 'lost';

/**
 * Move the stored house aside to the recovery key and clear the main save,
 * for the error screen's "start fresh" (#336). Never deletes without a copy:
 * on a full quota the copy is retried in the space the original frees, and
 * the original is put back if even that fails.
 */
export function resetStoredLayout(storage?: RawStore): ResetOutcome {
  let target: RawStore;
  let raw: string | null;
  try {
    target = storageOrDefault(storage);
    raw = target.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to read the saved layout before resetting:', error);
    return 'refused';
  }
  if (raw === null) return 'moved';
  try {
    target.setItem(RECOVERY_STORAGE_KEY, raw);
  } catch (error) {
    if (classifyStorageError(error) !== 'quota') {
      console.warn('Failed to back up the saved layout; leaving it in place:', error);
      return 'refused';
    }
    try {
      target.removeItem(STORAGE_KEY);
      target.setItem(RECOVERY_STORAGE_KEY, raw);
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
    return storageOrDefault(storage).getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export interface RecoveryCopy {
  raw: string;
  /** The copy validated through the schema, or null when it can't be used as a house. */
  layout: RoomLayout | null;
}

/** The house kept under the recovery key, if any (#336). */
export function readRecoveryCopy(storage?: RawStore): RecoveryCopy | null {
  let raw: string | null;
  try {
    raw = storageOrDefault(storage).getItem(RECOVERY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let layout: RoomLayout | null;
  try {
    layout = parseStoredLayout(JSON.parse(raw));
  } catch {
    layout = null;
  }
  return { raw, layout };
}

/** Whether the recovery copy is now gone. */
export function discardRecoveryCopy(storage?: RawStore): boolean {
  try {
    storageOrDefault(storage).removeItem(RECOVERY_STORAGE_KEY);
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

const RELOAD_ATTEMPT_KEY ='pc-error-reload';
/** A crash this soon after the error screen's reload means reloading didn't help. */
export const RELOAD_RETRY_WINDOW_MS = 2 * 60_000;

/** Called by the error screen's "Reload" so the next crash knows it came back. */
export function noteReloadAttempt(now: number = Date.now(), session?: RawStore): void {
  try {
    (session ?? window.sessionStorage).setItem(RELOAD_ATTEMPT_KEY, String(now));
  } catch {
    /* without the marker the reset is offered straight away */
  }
}

/**
 * Whether the error screen should suspect the saved house (#336): the crash
 * came back within moments of a reload. Without session storage there's no
 * way to tell, so the answer is yes rather than no way out.
 */
export function crashRecurredAfterReload(now: number = Date.now(), session?: RawStore): boolean {
  try {
    const stamp = Number((session ?? window.sessionStorage).getItem(RELOAD_ATTEMPT_KEY));
    return stamp > 0 && now >= stamp && now - stamp < RELOAD_RETRY_WINDOW_MS;
  } catch {
    return true;
  }
}
