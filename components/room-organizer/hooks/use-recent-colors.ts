import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'standalone-room-organizer-recent-colors';

interface UseRecentColorsOptions {
  /** Maximum number of recent colours retained. Defaults to 8. */
  max?: number;
}

export interface UseRecentColorsResult {
  recent: readonly string[];
  pushColor(color: string): void;
}

/**
 * Persisted LRU of hand-picked colours. Most recent first.
 * The colour palette swatches live elsewhere; this hook only tracks
 * choices that came from the freeform colour input.
 */
export function useRecentColors({ max = 8 }: UseRecentColorsOptions = {}): UseRecentColorsResult {
  const [recent, setRecent] = useState<readonly string[]>(() => loadInitial(max));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
    } catch {
      /* ignore quota errors */
    }
  }, [recent]);

  const pushColor = useCallback(
    (color: string) => {
      const normalised = color.toLowerCase();
      setRecent((current) => {
        const filtered = current.filter((entry) => entry.toLowerCase() !== normalised);
        return [normalised, ...filtered].slice(0, max);
      });
    },
    [max]
  );

  return { recent, pushColor };
}

function loadInitial(max: number): readonly string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, max);
  } catch {
    return [];
  }
}
