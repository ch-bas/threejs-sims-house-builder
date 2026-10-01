import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTOSAVE_DEBOUNCE_MS, STORAGE_KEY } from '../lib/constants';
import { notify } from '../lib/editor-notices';
import {
  EDITOR_SETTLED_MS,
  clearReloadAttempt,
  keepStoredLayout,
  loadLayout,
  sameLayoutContent,
  saveLayout,
} from '../lib/persistence';
import { isUntouched, snapshotBeforeReplace } from '../lib/restore-point';
import { parseStoredLayout } from '../lib/schema';
import { decodeShareUrl, isShareHash, isShareHashWithinBudget } from '../lib/share';
import { recordSnapshot } from '../lib/version-history';
import type { SaveFailureReason } from '../lib/persistence';
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
   * Why the most recent save attempt failed — a full quota (typically an
   * oversized floor-plan image), storage blocked by the browser, or something
   * else (#472) — or null after a success. The HUD uses it to avoid falsely
   * showing "Saved" and to say what the user can do.
   */
  saveError: SaveFailureReason | null;
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
  const [saveError, setSaveError] = useState<SaveFailureReason | null>(null);
  // The exact JSON this tab last wrote: its own echo must not count as
  // another tab's change (#334).
  const lastSavedJsonRef = useRef<string | null>(null);
  // The main save holds a house that couldn't be opened and couldn't be
  // copied aside (storage full): it's the only copy, so nothing may be
  // written over it until a copy succeeds.
  const mainSaveHeldRef = useRef(false);
  const [remoteLayout, setRemoteLayout] = useState<RoomLayout | null>(null);

  // Cross-tab guard (#123): the `storage` event only fires in OTHER tabs of
  // the same origin, so any event on our key means a different tab saved.
  // A different tab, but not necessarily a different house: after one tab
  // adopts the other's version its autosave writes that same house back, and
  // flagging it would bounce the notice between the tabs forever (#334).
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return;
      if (event.newValue === lastSavedJsonRef.current) {
        // Storage is back to what this tab wrote: a notice offering the
        // other tab's version is stale, and adopting it would restart the
        // ping-pong (#334).
        setRemoteLayout(null);
        return;
      }
      try {
        const parsed = parseStoredLayout(JSON.parse(event.newValue));
        if (!parsed) return;
        // Both sides through the same schema pass, so defaults it fills in
        // don't read as a difference.
        const shown = layoutRef.current;
        const shownNormalised = parseStoredLayout(JSON.parse(JSON.stringify(shown))) ?? shown;
        if (sameLayoutContent(parsed, shownNormalised)) {
          // The other tab now holds what this one shows: any earlier notice is moot.
          setRemoteLayout(null);
          return;
        }
        setRemoteLayout(parsed);
      } catch {
        /* another tab wrote something unreadable — nothing to offer */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const clearRemoteLayout = useCallback(() => setRemoteLayout(null), []);

  // The editor hydrated and stayed up, so the error screen's reload worked: a
  // later, unrelated crash must not read as the saved house failing again
  // (#336). A crash before then unmounts the hook and cancels this.
  useEffect(() => {
    const handle = window.setTimeout(() => clearReloadAttempt(), EDITOR_SETTLED_MS);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;

    // Copy the stored house aside, or hold the main save if it can't be.
    const keepStoredHouseAside = (): void => {
      const outcome = keepStoredLayout();
      if (outcome === 'kept') {
        notify('Your saved house couldn’t be opened, so a copy was kept in Manage → Saved Layouts → History.', 'info');
      }
      if (outcome === 'kept' || outcome === 'nothing') return;
      mainSaveHeldRef.current = true;
      setSaveError(outcome);
    };

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
          // Clearing the baseline resumes autosave, which will overwrite the
          // stored blob with the fallback layout ~debounceMs later. That blob
          // is the user's house — stash a copy first, exactly like the
          // unreadable-blob branch below (#206).
          keepStoredHouseAside();
          hydrationBaseRef.current = null;
        }
      } else {
        hydrationBaseRef.current = null;
        // A blob that exists but failed to load would otherwise be overwritten
        // by the autosave of the fallback layout ~debounceMs after mount —
        // permanent data loss. Stash a copy first (#113).
        keepStoredHouseAside();
      }
    };

    // Share-URL takes precedence over the local auto-save so opening a
    // shared link always lands you on that layout.
    if (typeof window !== 'undefined' && isShareHash(window.location.hash)) {
      const hash = window.location.hash;
      // Refused before decoding, with the local house left as it was: a hash
      // this long is no house, and inflating it could take the tab down (#332).
      if (!isShareHashWithinBudget(hash)) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        notify('This shared link is far larger than any house, so it was not opened. Your own house is unchanged.', 'error');
        hydrateFromLocalSave();
        return;
      }
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
          // Hydration clears undo and the first edit autosaves over the
          // stored house, so its final state needs a restore point now — the
          // ring's last cadence snapshot may be minutes stale (#298). Reads
          // storage only; the hydration baseline below is untouched.
          const outgoing = loadLayout();
          snapshotBeforeReplace(outgoing);
          // An unreadable save has no restore point to fall back on, and the
          // shared house would autosave over it (#113).
          if (!outgoing) keepStoredHouseAside();
          // Re-capture the baseline right before the hydration dispatch.
          hydrationBaseRef.current = layoutRef.current;
          // A corrupt-but-parseable layout can still throw while it's applied
          // to the scene. Guard the dispatch so a bad share link doesn't crash
          // the whole mount — the error boundary's reset path is the recovery.
          try {
            onHydrate(shared);
          } catch (error) {
            console.warn('Failed to apply shared layout:', error);
            // The LOCAL save is healthy and untouched — the failure is the
            // shared layout's. Nulling the baseline here would let the
            // fallback layout autosave over the local house ~debounceMs
            // later (#206). Fall back to the local save instead, same as a
            // link that failed to decode.
            hydrateFromLocalSave();
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
      // Retried on every edit, so freeing space lets saving resume.
      if (mainSaveHeldRef.current) {
        const outcome = keepStoredLayout();
        if (outcome !== 'kept' && outcome !== 'nothing') {
          setSaveError(outcome);
          return;
        }
        mainSaveHeldRef.current = false;
      }
      const result = saveLayout(layout);
      if (result.ok) {
        lastSavedJsonRef.current = result.json;
        // Only mark the edit persisted on a real success — otherwise the HUD
        // would show "Saved" for a layout that never reached localStorage.
        pendingRef.current = false;
        setLastSavedAt(Date.now());
        setSaving(false);
        setSaveError(null);
        // Restore point (#231): piggyback on the successful autosave. The
        // ring gates its own cadence and swallows quota failures, so this
        // can never break the save that just happened. A blank lot isn't
        // worth a point — and since #342 each one is a new house, so each
        // fresh start would add one.
        if (!isUntouched(layout)) recordSnapshot(layout);
      } else {
        // Keep `saving`/pending truthy and flag the error so the HUD reports
        // the failure instead of a false "Saved". A later successful edit
        // clears the flag.
        setSaveError(result.reason);
      }
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [layout, debounceMs]);

  // Flush a still-debouncing save when the editor unmounts or the page goes
  // away — without this, edits made in the last debounceMs are silently lost
  // on tab close.
  useEffect(() => {
    const flush = () => {
      if (!pendingRef.current || mainSaveHeldRef.current) return;
      pendingRef.current = false;
      const result = saveLayout(layoutRef.current);
      if (result.ok) lastSavedJsonRef.current = result.json;
      // The page is going away — capture a restore point regardless of the
      // ring's 5-minute cadence (#231).
      if (!isUntouched(layoutRef.current)) recordSnapshot(layoutRef.current, { force: true });
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  return { lastSavedAt, saving, saveError, remoteLayout, clearRemoteLayout };
}
