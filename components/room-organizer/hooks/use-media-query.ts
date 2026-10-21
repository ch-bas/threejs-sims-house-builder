import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches, kept live across resizes and rotations.
 * False during the static prerender and the first client render, so markup
 * that depends on it must be invisible until then (toasts, the open sheet).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}
