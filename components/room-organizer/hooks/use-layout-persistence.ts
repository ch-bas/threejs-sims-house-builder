import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTOSAVE_DEBOUNCE_MS, STORAGE_KEY } from '../lib/constants';
import { backupUnreadableLayout, loadLayout, saveLayout } from '../lib/persistence';
import { parseStoredLayout } from '../lib/schema';
import { decodeShareUrl, isShareHash } from '../lib/share';
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
  /**
   * True when the most recent save attempt failed (e.g. QuotaExceededError from
   * an oversized floor-plan image). The HUD uses this to avoid falsely showing
   * "Saved" when the layout never actually made it to localStorage.
   */
  saveError: boolean;
  /**
   * The layout another tab saved over ours, or null. Autosave stays
   * last-writer-wins between tabs (full merge is out of scope, #123), but the
   * race is surfaced instead of silent: the HUD shows a notice and can adopt
   * this snapshot. The caller decides what "adopt" means (an undoable
   * applyLayout — NOT the hydrate path, which would clear history).
   */
  remoteLayout: RoomLayout | null;
  /** Dismiss the cross-tab notice (also call after adopting `remoteLayout`). */
  clearRemoteLayout(): void;
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
  const [saveError, setSaveError] = useState(false);
  const [remoteLayout, setRemoteLayout] = useState<RoomLayout | null>(null);

  // Cross-tab guard (#123): the `storage` event only fires in OTHER tabs of
  // the same origin, so any event on our key means a different tab saved.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return;
      try {
        const parsed = parseStoredLayout(JSON.parse(event.newValue));
        if (parsed) setRemoteLayout(parsed);
      } catch {
        /* another tab wrote something unreadable — nothing to offer */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const clearRemoteLayout = useCallback(() => setRemoteLayout(null), []);

  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;

    const hydrateFromLocalSave = (): void => {
      const saved = loadLayout();
      if (saved) {
        hydrationBaseRef.current = layoutRef.current;
        // A stored layout that parses but throws on apply must not
        // white-screen mount.
        try {
          onHydrate(saved);
        } catch (error) {
          console.warn('Failed to apply saved layout:', error);
          hydrationBaseRef.current = null;
        }
      } else {
        hydrationBaseRef.current = null;
        // A blob that exists but failed to load would otherwise be overwritten
        // by the autosave of the fallback layout ~debounceMs after mount —
        // permanent data loss. Stash a copy first (#113).
        backupUnreadableLayout();
      }
    };

    // Share-URL takes precedence over the local auto-save so opening a
    // shared link always lands you on that layout.
    if (typeof window !== 'undefined' && isShareHash(window.location.hash)) {
      const hash = window.location.hash;
      // decodeShareUrl is async (DecompressionStream). Set the hydration
      // baseline synchronously so the autosave effect stays suppressed while
      // the decode is in flight — otherwise the fallback layout could be
      // scheduled to overwrite the local save before hydration lands.
      hydrationBaseRef.current = layoutRef.current;
      void decodeShareUrl(hash).then((shared) => {
        // Clear the hash either way: reloading after edits must not restore
        // the shared version, nor repeat the broken-link warning.
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        if (shared) {
          // Re-capture the baseline right before the hydration dispatch.
          hydrationBaseRef.current = layoutRef.current;
          // A corrupt-but-parseable layout can still throw while it's applied
          // to the scene. Guard the dispatch so a bad share link doesn't crash
          // the whole mount — the error boundary's reset path is the recovery.
          try {
            onHydrate(shared);
          } catch (error) {
            console.warn('Failed to apply shared layout:', error);
            hydrationBaseRef.current = null;
          }
          return;
        }
        // The hash looks like a share link (`#layout=…`) but failed to decode
        // — truncated or corrupted. Surface a visible notice instead of
        // silently falling back to the local save.
        window.alert(
          'This shared layout link is broken or incomplete and could not be opened. Loading your last saved layout instead.'
        );
        hydrateFromLocalSave();
      });
      return;
    }

    hydrateFromLocalSave();
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
      const ok = saveLayout(layout);
      if (ok) {
        // Only mark the edit persisted on a real success — otherwise the HUD
        // would show "Saved" for a layout that never reached localStorage.
        pendingRef.current = false;
        setLastSavedAt(Date.now());
        setSaving(false);
        setSaveError(false);
      } else {
        // Keep `saving`/pending truthy and flag the error so the HUD reports
        // the failure instead of a false "Saved". A later successful edit
        // clears the flag.
        setSaveError(true);
      }
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

  return { lastSavedAt, saving, saveError, remoteLayout, clearRemoteLayout };
}
