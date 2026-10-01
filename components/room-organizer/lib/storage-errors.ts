/** What a failed `localStorage` write means for the user. */
export type StorageErrorKind = 'quota' | 'blocked' | 'unknown';

/**
 * Why a storage call threw: `'quota'` when the origin is out of space
 * (Chromium and Safari: `QuotaExceededError`, code 22; older Firefox:
 * `NS_ERROR_DOM_QUOTA_REACHED`, code 1014), `'blocked'` when the browser
 * refuses storage outright (`SecurityError`, code 18 — site data blocked,
 * some private modes), `'unknown'` for anything else. Only a quota error
 * can be helped by freeing space.
 */
export function classifyStorageError(error: unknown): StorageErrorKind {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const { name, code } = error as { name?: unknown; code?: unknown };
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) {
    return 'quota';
  }
  if (name === 'SecurityError' || code === 18) return 'blocked';
  return 'unknown';
}
