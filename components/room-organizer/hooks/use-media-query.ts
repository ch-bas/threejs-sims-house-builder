'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches, kept in step with the viewport. False
 * on the server and during hydration, so the static export's markup matches.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query]
  );
  const getSnapshot = useCallback(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    [query]
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
