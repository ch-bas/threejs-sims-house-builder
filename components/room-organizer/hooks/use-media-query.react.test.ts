// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMediaQuery } from './use-media-query';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubMatchMedia(initial: boolean): { set(next: boolean): void; listeners: Set<() => void> } {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    set(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener());
    },
    listeners,
  };
}

it('follows the media query as it starts and stops matching', () => {
  const media = stubMatchMedia(true);
  const { result, unmount } = renderHook(() => useMediaQuery('(max-width: 768px)'));
  expect(result.current).toBe(true);
  act(() => media.set(false));
  expect(result.current).toBe(false);
  unmount();
  expect(media.listeners.size).toBe(0);
});
