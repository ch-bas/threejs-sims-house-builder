import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from './chunk-reload';

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
