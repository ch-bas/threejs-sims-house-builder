import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDUCED_MOTION_QUERY, prefersReducedMotion } from './reduced-motion';

describe('prefersReducedMotion (#436)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is false without a window or matchMedia', () => {
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal('window', {});
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reads the reduce-motion media query', () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === REDUCED_MOTION_QUERY }));
    vi.stubGlobal('window', { matchMedia });
    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });
});
