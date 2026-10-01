/**
 * localStorage access that never throws (#396). Reading `window.localStorage`
 * itself throws a SecurityError where storage is blocked (third-party framing,
 * "Block all cookies", dom.storage.enabled=false), and so can every call on
 * it; an uncaught throw during render takes the whole editor down.
 *
 * Writers that must yield to restore points on a full quota keep using
 * `setItemEvictingSnapshots` — this is for small preference keys.
 */

function resolve(storage: Storage | undefined): Storage | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

/** The stored value, or null when absent or storage is unavailable. */
export function safeGetItem(key: string, storage?: Storage): string | null {
  try {
    return resolve(storage)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Whether the value was stored. */
export function safeSetItem(key: string, value: string, storage?: Storage): boolean {
  try {
    const target = resolve(storage);
    if (!target) return false;
    target.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Whether the key is now gone (true also when it never existed). */
export function safeRemoveItem(key: string, storage?: Storage): boolean {
  try {
    const target = resolve(storage);
    if (!target) return false;
    target.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
