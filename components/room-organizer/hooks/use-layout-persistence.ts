import { useEffect, useRef, useState } from 'react';
import { AUTOSAVE_DEBOUNCE_MS } from '../lib/constants';
import { loadLayout, saveLayout } from '../lib/persistence';
import { decodeShareUrl } from '../lib/share';
import type { RoomLayout } from '../lib/types';

export interface UseLayoutPersistenceOptions {
  layout: RoomLayout;
  onHydrate: (layout: RoomLayout) => void;
  debounceMs?: number;
}

export interface UseLayoutPersistenceResult {
  /** Milliseconds-since-epoch of the last successful save, or null. */
  lastSavedAt: number | null;
  /** True while the debounce window is pending — the next save is on the way. */
  saving: boolean;
}

export function useLayoutPersistence({
  layout,
  onHydrate,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
}: UseLayoutPersistenceOptions): UseLayoutPersistenceResult {
  const hasHydratedRef = useRef(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;

    // Share-URL takes precedence over the local auto-save so opening a
    // shared link always lands you on that layout.
    if (typeof window !== 'undefined') {
      const shared = decodeShareUrl(window.location.hash);
      if (shared) {
        onHydrate(shared);
        // Clear the hash so reloading after edits doesn't restore the
        // shared version.
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        return;
      }
    }

    const saved = loadLayout();
    if (saved) onHydrate(saved);
  }, [onHydrate]);

  useEffect(() => {
    if (!hasHydratedRef.current) return;
    setSaving(true);
    const handle = window.setTimeout(() => {
      saveLayout(layout);
      setLastSavedAt(Date.now());
      setSaving(false);
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [layout, debounceMs]);

  return { lastSavedAt, saving };
}
