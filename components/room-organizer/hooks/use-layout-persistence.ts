import { useCallback, useEffect, useRef, useState } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { askConfirm } from '../lib/confirm-dialog';
import { AUTOSAVE_DEBOUNCE_MS, STORAGE_KEY } from '../lib/constants';
import { notify } from '../lib/editor-notices';
import {
  EDITOR_SETTLED_MS,
  clearEditorCrashed,
  clearReloadAttempt,
  editorHasCrashed,
  keepStoredLayout,
  loadLayout,
  sameLayoutContent,
  saveLayout,
} from '../lib/persistence';
import { isUntouched, snapshotBeforeReplace } from '../lib/restore-point';
import { parseStoredLayout } from '../lib/schema';
import { isShareHash, isShareHashWithinBudget, readShareHash, shareFailureMessage } from '../lib/share';
import { recordSnapshot } from '../lib/version-history';
import type { SaveFailureReason } from '../lib/persistence';
import type { RoomLayout } from '../lib/types';

export interface UseLayoutPersistenceOptions {
  layout: RoomLayout;
  onHydrate: (layout: RoomLayout) => void;
  /**
   * Open a shared house over the player's own (#573), once they said yes:
   * an ordinary whole-house replacement (restore point, history commit,
   * `markLayoutLoaded`), so one Ctrl+Z brings their house back. Without it
   * a share link hydrates over the stored house unasked, as before.
   */
  onOpenShared?: (layout: RoomLayout) => void;
  debounceMs?: number;
}

export interface SaveStatus {
  /** Milliseconds-since-epoch of the last successful save, or null. */
  readonly lastSavedAt: number | null;
  /** True while the debounce window is pending — the next save is on the way. */
  readonly saving: boolean;
  /**
   * Why the most recent save attempt failed — a full quota (typically an
   * oversized floor-plan image), storage blocked by the browser, or something
   * else (#472) — or null after a success. The HUD uses it to avoid falsely
   * showing "Saved" and to say what the user can do.
   */
  readonly saveError: SaveFailureReason | null;
}

export type SaveStatusStore = StoreApi<SaveStatus>;

function createSaveStatusStore(): SaveStatusStore {
  return createStore<SaveStatus>()(() => ({ lastSavedAt: null, saving: false, saveError: null }));
}

/** The save status, re-rendering only the component that shows it. */
export function useSaveStatus(store: SaveStatusStore): SaveStatus {
  return useStore(store, useShallow((state: SaveStatus) => state));
}

export interface UseLayoutPersistenceResult {
  /** Subscribe with `useSaveStatus`; read in tests with `getState()`. */
  saveStatus: SaveStatusStore;
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
  onOpenShared,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
}: UseLayoutPersistenceOptions): UseLayoutPersistenceResult {
  const hasHydratedRef = useRef(false);
  // Read when the player answers, which is after later renders.
  const onOpenSharedRef = useRef(onOpenShared);
  onOpenSharedRef.current = onOpenShared;
  // While set, autosave is suppressed until the layout moves past the stored
  // pre-hydration value — i.e. until the hydration dispatch has landed. This
  // stops a freshly opened share link (or a plain reload) from overwriting the
  // local save before the user has actually edited anything.
  const hydrationBaseRef = useRef<RoomLayout | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const pendingRef = useRef(false);
  // The last layout the editor survived (#568): one that crashed it must
  // never reach the save, or every reload crashes again. A crash in render or
  // in an effect unmounts the editor within the same task, so a layout only
  // counts once a timer has fired after its commit. `layoutRef` can't serve
  // after a crash: it is written during render, even for a render that threw.
  // Only a crash falls back to it; an ordinary unmount or a page going away
  // saves the layout on screen, since a big edit's render and scene rebuild
  // is one long task that pagehide can follow before any timer runs.
  const settledRef = useRef<RoomLayout | null>(null);
  // The save status lives in a store of its own, read by the HUD's leaf
  // subscriber: as hook state, every flip re-rendered the whole editor (#3).
  const [saveStatus] = useState(createSaveStatusStore);
  // What `saving` was last set to, so the autosave effect writes it only when
  // it flips: as state, re-setting it while already true scheduled a render
  // per keystroke until fast typing hit "Maximum update depth exceeded"
  // (#480). Written beside each `saving` write, never during render.
  const savingRef = useRef(false);
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
      saveStatus.setState({ saveError: outcome });
    };

    /** True when the stored house is the one on screen now. */
    const hydrateFromLocalSave = (): boolean => {
      const saved = loadLayout();
      if (saved) {
        hydrationBaseRef.current = layoutRef.current;
        // A stored layout that parses but throws on apply must not
        // white-screen mount.
        try {
          onHydrate(saved);
          return true;
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
      return false;
    };

    // A share link opens the shared house: straight away over nothing worth
    // keeping, after asking over the player's own work (#573).
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
      // The decode is async (DecompressionStream). Set the hydration
      // baseline synchronously so the autosave effect stays suppressed while
      // the decode is in flight — otherwise the fallback layout could be
      // scheduled to overwrite the local save before hydration lands.
      hydrationBaseRef.current = layoutRef.current;
      // Clear the hash once the link is dealt with: reloading after edits
      // must not open the shared version again, nor repeat a warning.
      const clearHash = (): void => {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      };
      void readShareHash(hash).then(async (result) => {
        if (!result.ok) {
          // Truncated, corrupt or from a newer app: say which, without a
          // blocking alert, and open the local save (#607).
          clearHash();
          notify(`${shareFailureMessage(result.reason)} Your own house is unchanged.`, 'error');
          hydrateFromLocalSave();
          return;
        }
        const shared = result.layout;
        // Reads storage only; the hydration baseline is untouched.
        const outgoing = loadLayout();
        const openShared = onOpenSharedRef.current;
        if (outgoing && !isUntouched(outgoing) && openShared && hydrateFromLocalSave()) {
          // The player's own house is on screen: ask before replacing it
          // (#573). The hash stays until they answer, so a reload asks again.
          const open = await askConfirm({
            title: `Open the shared house “${shared.name}”?`,
            body: 'Your current house is kept as a restore point, and Undo brings it back.',
            confirmLabel: 'Open it',
            cancelLabel: 'Keep mine',
          });
          clearHash();
          if (!open) return;
          try {
            onOpenSharedRef.current?.(shared);
          } catch (error) {
            // The house on screen is still the player's own (#206).
            console.warn('Failed to apply shared layout:', error);
            notify(`${shareFailureMessage('unreadable')} Your own house is unchanged.`, 'error');
            return;
          }
          notify(
            'Opened the shared house. Undo brings yours back, and it is kept in Manage → Saved Layouts → History.',
            'success'
          );
          return;
        }
        clearHash();
        // Nothing worth asking about (no save, an untouched one) — or the
        // stored house wouldn't even apply. Hydration clears undo and the
        // first edit autosaves over the stored house, so its final state
        // needs a restore point now — the ring's last cadence snapshot may
        // be minutes stale (#298).
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
      });
      return;
    }

    hydrateFromLocalSave();
  }, [onHydrate, saveStatus]);

  useEffect(() => {
    if (hydrationBaseRef.current) {
      if (Object.is(layout, hydrationBaseRef.current)) return;
      // First layout change after hydration is the hydration dispatch itself,
      // not a user edit — swallow it and resume normal autosave afterwards.
      hydrationBaseRef.current = null;
      return;
    }
    if (!savingRef.current) {
      savingRef.current = true;
      saveStatus.setState({ saving: true });
    }
    pendingRef.current = true;
    const handle = window.setTimeout(() => {
      // Retried on every edit, so freeing space lets saving resume.
      if (mainSaveHeldRef.current) {
        const outcome = keepStoredLayout();
        if (outcome !== 'kept' && outcome !== 'nothing') {
          saveStatus.setState({ saveError: outcome });
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
        savingRef.current = false;
        saveStatus.setState({ lastSavedAt: Date.now(), saving: false, saveError: null });
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
        saveStatus.setState({ saveError: result.reason });
      }
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [layout, debounceMs, saveStatus]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      settledRef.current = layout;
    }, 0);
    return () => window.clearTimeout(handle);
  }, [layout]);

  // Flush a still-debouncing save when the editor unmounts, the page goes
  // away or the tab goes to the background — without this, edits made in the
  // last debounceMs are silently lost on tab close. After a crash only a
  // settled layout is flushed (#568).
  useEffect(() => {
    clearEditorCrashed();
    // A flush when the tab was hidden owes the page-away restore point to
    // the pagehide or unmount that may follow.
    let pointOwed = false;
    const flush = (layout: RoomLayout | null, leaving: boolean) => {
      if (mainSaveHeldRef.current || layout === null) return;
      if (pendingRef.current) {
        const result = saveLayout(layout);
        // Still pending after a failure: a later flush, or the debounced
        // save, retries once storage has room again.
        if (result.ok) {
          pendingRef.current = false;
          lastSavedJsonRef.current = result.json;
        }
        pointOwed = true;
      }
      if (!pointOwed || isUntouched(layout)) return;
      if (leaving) {
        // The page is going away — capture a restore point regardless of
        // the ring's 5-minute cadence (#231).
        recordSnapshot(layout, { force: true });
        pointOwed = false;
      } else {
        // Hidden may be followed by nothing at all (a discarded tab) or by
        // a return: a point within the cadence, so that switching tabs
        // after every edit can't push the older points out of the ring.
        recordSnapshot(layout);
      }
    };
    // A crash has already removed these listeners: pagehide is never a crash.
    const onPageHide = () => flush(layoutRef.current, true);
    // Mobile browsers discard a background tab without firing pagehide;
    // hidden is the last signal they reliably send (#554). The save is
    // idempotent with a pagehide that follows, through `pendingRef`.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush(layoutRef.current, false);
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // A crash before any layout settled saves nothing: the stored house
      // is the last one that opened.
      flush(editorHasCrashed() ? settledRef.current : layoutRef.current, true);
    };
  }, []);

  return { saveStatus, remoteLayout, clearRemoteLayout };
}
