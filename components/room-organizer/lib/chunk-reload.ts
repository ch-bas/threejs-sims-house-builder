// Recovery for stale hashed chunks after a redeploy.
//
// The app is a static export on GitHub Pages, which caches index.html for ~10
// minutes. A returning visitor within that window loads cached HTML whose
// hashed `_next/static/chunks/*.js` URLs were replaced by the new deploy and
// now 404. Those chunks are loaded lazily (the editor via `next/dynamic`, and
// Three.js via a runtime `import()`), so the failure surfaces as a
// ChunkLoadError — and `next/dynamic`'s loading fallback otherwise swallows it,
// stranding the user on "Loading the lot…" forever. Reloading once fetches
// fresh HTML + chunk hashes and recovers.

export const CHUNK_RELOAD_KEY = 'pc-chunk-reload';
/**
 * One automatic reload per window, not per successful load (#499). Clearing
 * the guard when the editor chunk arrived re-armed it before the engine
 * chunk failed again, and the page reloaded ~3 times a second forever. Ten
 * minutes covers Pages' HTML cache, the stale-chunk case the reload is for;
 * a second failure inside it ends on the error screen and its Retry button.
 */
export const CHUNK_RELOAD_WINDOW_MS = 10 * 60 * 1000;

/** Whether the guard value left by the last automatic reload allows another one at `now`. */
export function chunkReloadAllowed(stored: string | null, now: number): boolean {
  if (stored === null) return true;
  const since = now - Number(stored);
  // A garbled value or a clock that went backwards must not pin the guard shut.
  return !(since >= 0 && since < CHUNK_RELOAD_WINDOW_MS);
}

/** Recognise the various shapes a failed dynamic-chunk load can take. */
export function isChunkLoadError(err: unknown): boolean {
  const s = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return /ChunkLoadError|Loading chunk\s+\S+\s+failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(
    s
  );
}

/**
 * If `err` is a stale-chunk failure, reload the page ONCE to fetch fresh assets
 * and return `true`. A `sessionStorage` guard prevents a reload loop when the
 * chunk still fails after reloading (a genuinely missing asset / broken
 * deploy) — in that case this returns `false` so the caller can surface a real
 * error instead of looping. The head script in app/layout.tsx shares the guard.
 */
export function reloadOnceForChunkError(err: unknown): boolean {
  if (!isChunkLoadError(err) || typeof window === 'undefined') return false;
  try {
    const now = Date.now();
    if (!chunkReloadAllowed(window.sessionStorage.getItem(CHUNK_RELOAD_KEY), now)) return false;
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    // sessionStorage unavailable (private mode / disabled) — reload best-effort.
  }
  window.location.reload();
  return true;
}

/** Re-arm the automatic reload; only an explicit Retry does this. */
export function clearChunkReloadGuard(): void {
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    // ignore
  }
}

/**
 * Tell the head watchdog the app is up. Sent when the 3D engine has loaded,
 * not the editor chunk, so a hung engine chunk is caught by the watchdog
 * instead of waiting out webpack's 120 s timeout (#499).
 */
export function markAppReady(): void {
  if (typeof window !== 'undefined') (window as unknown as { __pcReady?: boolean }).__pcReady = true;
}
