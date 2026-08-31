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

const CHUNK_RELOAD_KEY = 'pc-chunk-reload';

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
 * error instead of looping.
 */
export function reloadOnceForChunkError(err: unknown): boolean {
  if (!isChunkLoadError(err) || typeof window === 'undefined') return false;
  try {
    if (window.sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1') return false;
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
  } catch {
    // sessionStorage unavailable (private mode / disabled) — reload best-effort.
  }
  window.location.reload();
  return true;
}

/** Clear the one-shot guard after a successful load so future reloads aren't blocked. */
export function clearChunkReloadGuard(): void {
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    // ignore
  }
}
