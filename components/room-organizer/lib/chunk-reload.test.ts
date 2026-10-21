import { describe, expect, it } from 'vitest';
import { CHUNK_RELOAD_WINDOW_MS, chunkReloadAllowed, isChunkLoadError } from './chunk-reload';

describe('isChunkLoadError', () => {
  it('matches webpack ChunkLoadError by name', () => {
    const err = new Error('Loading chunk 367 failed.');
    err.name = 'ChunkLoadError';
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('matches "Loading chunk N failed" messages', () => {
    expect(isChunkLoadError(new Error('Loading chunk 42 failed. (error: /_next/x.js)'))).toBe(true);
  });

  it('matches native dynamic-import failures', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /x.js'))).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
  });

  it('matches CSS chunk failures', () => {
    expect(isChunkLoadError(new Error('Loading CSS chunk 5 failed'))).toBe(true);
  });

  it('does NOT match unrelated errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false);
    expect(isChunkLoadError('some string')).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('chunkReloadAllowed (#499)', () => {
  const now = 1_800_000_000_000;

  it('allows the first automatic reload', () => {
    expect(chunkReloadAllowed(null, now)).toBe(true);
  });

  it('refuses another inside the window, however the app fared since', () => {
    expect(chunkReloadAllowed(String(now - 1_000), now)).toBe(false);
    expect(chunkReloadAllowed(String(now - CHUNK_RELOAD_WINDOW_MS + 1), now)).toBe(false);
  });

  it('allows one again once the window has passed', () => {
    expect(chunkReloadAllowed(String(now - CHUNK_RELOAD_WINDOW_MS), now)).toBe(true);
  });

  it('a legacy "1", a garbled value or a future stamp never pins the guard shut', () => {
    expect(chunkReloadAllowed('1', now)).toBe(true);
    expect(chunkReloadAllowed('garbage', now)).toBe(true);
    expect(chunkReloadAllowed(String(now + 60_000), now)).toBe(true);
  });
});
