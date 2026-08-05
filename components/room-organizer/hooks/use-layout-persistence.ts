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
  // While set, autosave is suppressed until the layout moves past the stored
  // pre-hydration value — i.e. until the hydration dispatch has landed. This
  // stops a freshly opened share link (or a plain reload) from overwriting the
  // local save before the user has actually edited anything.
  const hydrationBaseRef = useRef<RoomLayout | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const pendingRef = useRef(false);
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
        hydrationBaseRef.current = layout;
        onHydrate(shared);
        // Clear the hash so reloading after edits doesn't restore the
        // shared version.
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        return;
      }
    }

    const saved = loadLayout();
    if (saved) {
      hydrationBaseRef.current = layout;
      onHydrate(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot hydration; `layout` is only read as the pre-hydration baseline
  }, [onHydrate]);

  useEffect(() => {
    if (hydrationBaseRef.current) {
      if (Object.is(layout, hydrationBaseRef.current)) return;
      // First layout change after hydration is the hydration dispatch itself,
      // not a user edit — swallow it and resume normal autosave afterwards.
      hydrationBaseRef.current = null;
      return;
    }
    setSaving(true);
    pendingRef.current = true;
    const handle = window.setTimeout(() => {
      pendingRef.current = false;
      saveLayout(layout);
      setLastSavedAt(Date.now());
      setSaving(false);
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [layout, debounceMs]);

  // Flush a still-debouncing save when the editor unmounts or the page goes
  // away — without this, edits made in the last debounceMs are silently lost
  // on tab close.
  useEffect(() => {
    const flush = () => {
      if (!pendingRef.current) return;
      pendingRef.current = false;
      saveLayout(layoutRef.current);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  return { lastSavedAt, saving };
}
