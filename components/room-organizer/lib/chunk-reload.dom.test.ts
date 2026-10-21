// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS, clearChunkReloadGuard, reloadOnceForChunkError } from './chunk-reload';

function chunkError(): Error {
  const err = new Error('Loading chunk 600 failed.');
  err.name = 'ChunkLoadError';
  return err;
}

describe('reloadOnceForChunkError across loads (#499)', () => {
  const reload = vi.fn();
  beforeEach(() => {
    sessionStorage.clear();
    reload.mockClear();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
  });
  afterEach(() => vi.restoreAllMocks());

  it('reloads once, then refuses the next failure so the error screen shows', () => {
    expect(reloadOnceForChunkError(chunkError())).toBe(true);
    // The next page load: the editor chunk arrives, the engine chunk fails again.
    expect(reloadOnceForChunkError(chunkError())).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh reload after the window, or after Retry clears the guard', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    expect(reloadOnceForChunkError(chunkError())).toBe(true);
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + CHUNK_RELOAD_WINDOW_MS);
    expect(reloadOnceForChunkError(chunkError())).toBe(true);
    expect(reloadOnceForChunkError(chunkError())).toBe(false);
    clearChunkReloadGuard();
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
    expect(reloadOnceForChunkError(chunkError())).toBe(true);
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it('ignores errors that are not chunk failures', () => {
    expect(reloadOnceForChunkError(new TypeError('x is not a function'))).toBe(false);
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});
