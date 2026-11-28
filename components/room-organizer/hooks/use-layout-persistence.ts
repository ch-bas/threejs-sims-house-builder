import { useCallback, useEffect, useRef, useState } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { AUTOSAVE_DEBOUNCE_MS, STORAGE_KEY } from '../lib/constants';
import { notify, notifyRefused, type RefusedCue } from '../lib/editor-notices';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import {
  EDITOR_SETTLED_MS,
  clearEditorCrashed,
  clearReloadAttempt,
  compactStoredHouse,
  editorHasCrashed,
  keepHouseAside,
  keepStoredLayout,
  loadLayout,
  readStoredLayoutRaw,
  sameLayoutContent,
  saveLayout,
  saveOverStoredHouse,
} from '../lib/persistence';
import {
  comparablePlanImage,
  pinPlanImage,
  planImagePending,
  planImageProblem,
  planImageProblemText,
  refreshPlanStoragePersisted,
  resolvePlanImage,
  storePlanImage,
  storedPlanImageRef,
  subscribePlanImageStored,
} from '../lib/plan-image-ref';
import { isUntouched, setOpeningHouse, snapshotBeforeReplace, subscribeHouseReplaced } from '../lib/restore-point';
import { subscribeSaveHereChosen } from '../lib/saved-by';
import { takeTourCrashNote } from '../lib/saved-house';
import { parseStoredLayout } from '../lib/schema';
import { isShareHash, isShareHashWithinBudget, readShareHash, shareFailureMessage } from '../lib/share';
import { isTourSession, setTourPhase } from '../lib/tour-session';
import { recordSnapshot } from '../lib/version-history';
import type { SaveFailureReason } from '../lib/persistence';
import type { SaveFlush } from '../lib/service-worker';
import type { RoomLayout } from '../lib/types';

export interface UseLayoutPersistenceOptions {
  layout: RoomLayout;
  /**
   * Open the stored house. `floorIndex` comes with a house that waited for
   * its floor-plan image (#936): the storey it would have opened on, since an
   * edit of the placeholder meanwhile (Add floor) may have moved the view.
   */
  onHydrate: (layout: RoomLayout, floorIndex?: number) => void;
  /** The storey on screen now, read when a stored house starts waiting (#936). */
  activeFloorIndex?: () => number;
  /**
   * Keep a copy of the toured house (#722), once it is saved: the rest of
   * the whole-house load (`commitNow`, `applyLayout`, `markLayoutLoaded`).
   * The copy is saved, and the stored house it replaced is a recovered copy
   * when `copiedAside` (false: there was nothing worth keeping), so the
   * notice only names History when it holds the house.
   */
  onKeepTourCopy?: (house: RoomLayout, copiedAside: boolean) => void;
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
  /**
   * The shared house being toured (#722), once its link has decoded; null
   * before that and outside a tour (`isTourSession`).
   */
  tourHouse: RoomLayout | null;
  /**
   * Make the toured house the visitor's own: from here on it saves. Refused,
   * with the tour left as it was, when the visitor's house can't be kept
   * first or the copy can't be saved.
   */
  keepTourCopy(playCue: RefusedCue): void;
  /** Leave the tour for the visitor's own house, or a fresh lot. */
  leaveTour(): void;
  /**
   * Save a change still waiting for the autosave now (#933, before an update
   * reloads the page): 'newer' when a newer version's save refused it.
   */
  flushSave(): SaveFlush;
}

/** Said when a load replaced the saved house before it had opened (#936). */
export const OPENING_HOUSE_KEPT =
  'Your saved house was still opening, so a copy of it is kept in Manage → Saved Layouts → History.';
/** Said when edits of the placeholder lot gave way to the saved house (#936). */
export const EDITS_WHILE_OPENING = 'Your saved house finished opening, so changes made while it loaded weren’t kept.';

const NO_ROOM_TO_KEEP_YOURS =
  'No room to keep a copy of your own house first, so nothing was changed. Free space in Manage → Storage (Build your own opens your house), then open the link again.';

const COPY_NOT_SAVED: Record<SaveFailureReason, string> = {
  quota: 'Storage full: the copy couldn’t be saved, so nothing was changed. Free space in Manage → Storage, then open the link again.',
  blocked: 'This browser blocks site storage, so a copy can’t be kept here. Nothing was changed.',
  unknown: 'The copy couldn’t be saved, so nothing was changed. Try again in a moment.',
  newer: 'A newer version of the editor saved your house, so this one didn’t replace it. Choose Save here anyway when asked (or under the save status), then keep the copy again.',
};

/** Drops a share link from the address, so a reload opens the visitor's own house. */
function clearShareHash(): void {
  if (!isShareHash(window.location.hash)) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

export function useLayoutPersistence({
  layout,
  onHydrate,
  onKeepTourCopy,
  activeFloorIndex,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
}: UseLayoutPersistenceOptions): UseLayoutPersistenceResult {
  const hasHydratedRef = useRef(false);
  // Read when the visitor answers, which is after later renders.
  const onKeepTourCopyRef = useRef(onKeepTourCopy);
  onKeepTourCopyRef.current = onKeepTourCopy;
  const activeFloorIndexRef = useRef(activeFloorIndex);
  activeFloorIndexRef.current = activeFloorIndex;
  const [tourHouse, setTourHouse] = useState<RoomLayout | null>(null);
  // While set, autosave is suppressed until the layout moves past the stored
  // pre-hydration value — i.e. until the hydration dispatch has landed. This
  // stops a freshly opened share link (or a plain reload) from overwriting the
  // local save before the user has actually edited anything.
  const hydrationBaseRef = useRef<RoomLayout | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const pendingRef = useRef(false);
  // Set by the flush effect below (#933).
  const flushNowRef = useRef((): SaveFlush => (pendingRef.current ? 'failed' : 'saved'));
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
  // While set, the stored house is waiting for its floor-plan image (#936):
  // nothing saves, since the house on screen isn't the stored one yet.
  const resolvingRef = useRef(false);
  // Bumped by each hydration, so an image read for an older one is dropped.
  const hydrationRef = useRef(0);
  // Bumped by each storage event, so a slower image read can't land late.
  const remoteRef = useRef(0);
  // The saved house waiting for its image, and its save as it was read: a
  // load during the wait keeps that text aside, whatever storage holds by
  // then (another tab's save, adopted). Until it is kept, the main save is
  // held and the retry keeps `heldRawRef`.
  const openingRef = useRef<RoomLayout | null>(null);
  const openingRawRef = useRef<string | null>(null);
  const heldRawRef = useRef<string | null>(null);
  // False once unmounted: a late image read must not open a house then.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    // StrictMode's remount: the wait is still on.
    if (resolvingRef.current && openingRef.current) setOpeningHouse(openingRef.current);
    return () => {
      mountedRef.current = false;
      setOpeningHouse(null);
    };
  }, []);

  // "Save here anyway" over a newer version's house (#933): the edit waiting
  // since the refusal is saved at once, not at the next edit.
  useEffect(
    () =>
      subscribeSaveHereChosen(() => {
        if (!pendingRef.current || mainSaveHeldRef.current || resolvingRef.current || isTourSession()) return;
        const result = saveLayout(layoutRef.current);
        if (!result.ok) {
          saveStatus.setState({ saveError: result.reason });
          return;
        }
        lastSavedJsonRef.current = result.json;
        pendingRef.current = false;
        savingRef.current = false;
        saveStatus.setState({ lastSavedAt: Date.now(), saving: false, saveError: null });
      }),
    [saveStatus]
  );

  // Cross-tab guard (#123): the `storage` event only fires in OTHER tabs of
  // the same origin, so any event on our key means a different tab saved.
  // A different tab, but not necessarily a different house: after one tab
  // adopts the other's version its autosave writes that same house back, and
  // flagging it would bounce the notice between the tabs forever (#334).
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return;
      // A tour shows someone else's house: the visitor's own, saved in
      // another tab, is nothing to adopt over it (#722).
      if (isTourSession()) return;
      if (event.newValue === lastSavedJsonRef.current) {
        // Storage is back to what this tab wrote: a notice offering the
        // other tab's version is stale, and adopting it would restart the
        // ping-pong (#334).
        setRemoteLayout(null);
        return;
      }
      const compare = (parsed: RoomLayout): void => {
        // Both sides through the same schema pass, so defaults it fills in
        // don't read as a difference; and both as a save writes them, so an
        // image inline on one side and named by ref on the other is one (#936).
        const shown = layoutRef.current;
        const shownNormalised = parseStoredLayout(JSON.parse(JSON.stringify(shown))) ?? shown;
        if (sameLayoutContent(comparablePlanImage(parsed), comparablePlanImage(shownNormalised))) {
          // The other tab now holds what this one shows: any earlier notice is moot.
          setRemoteLayout(null);
          return;
        }
        setRemoteLayout(parsed);
      };
      const seen = ++remoteRef.current;
      try {
        const parsed = parseStoredLayout(JSON.parse(event.newValue));
        if (!parsed) return;
        if (!planImagePending(parsed)) {
          compare(parsed);
          return;
        }
        // The other tab saved its image by ref: fetch it, so adopting the
        // house brings the image too.
        void resolvePlanImage(parsed).then((resolved) => {
          if (seen !== remoteRef.current || isTourSession()) return;
          try {
            compare(resolved);
          } catch {
            /* nothing to offer */
          }
        });
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

  // Copy the stored house aside, or hold the main save if it can't be.
  const keepStoredHouseAside = useCallback((): void => {
    const outcome = keepStoredLayout();
    if (outcome === 'kept') {
      notify('Your saved house couldn’t be opened, so a copy was kept in Manage → Saved Layouts → History.', 'info');
    }
    if (outcome === 'kept' || outcome === 'nothing') return;
    mainSaveHeldRef.current = true;
    saveStatus.setState({ saveError: outcome });
  }, [saveStatus]);

  /** True when the stored house is the one on screen now. */
  const hydrateFromLocalSave = useCallback((): boolean => {
    const saved = loadLayout();
    const hydration = ++hydrationRef.current;
    if (saved && planImagePending(saved)) {
      // The save names its floor-plan image (#936): open the house once the
      // image is read, saving nothing meanwhile. An image that can't be read
      // in time leaves the house without it, still naming it, so the next
      // save keeps it and a reload tries again.
      hydrationBaseRef.current = layoutRef.current;
      resolvingRef.current = true;
      // A load meanwhile replaces this house, not the placeholder on screen.
      openingRef.current = saved;
      openingRawRef.current = readStoredLayoutRaw();
      setOpeningHouse(saved);
      // The storey it opens on, whatever an edit meanwhile switches to.
      const floorIndex = activeFloorIndexRef.current?.();
      void resolvePlanImage(saved).then((resolved) => {
        if (hydration !== hydrationRef.current || !mountedRef.current) return;
        resolvingRef.current = false;
        openingRef.current = null;
        setOpeningHouse(null);
        // Left for a tour while the image was read.
        if (isTourSession()) return;
        // Edits of the placeholder lot give way to the saved house: said.
        const editedMeanwhile = !Object.is(layoutRef.current, hydrationBaseRef.current);
        try {
          onHydrate(resolved, floorIndex);
        } catch (error) {
          console.warn('Failed to apply saved layout:', error);
          keepStoredHouseAside();
          hydrationBaseRef.current = null;
          return;
        }
        if (editedMeanwhile) notify(EDITS_WHILE_OPENING, 'info');
        if (planImagePending(resolved)) {
          notify(`The house opened without its floor plan. ${planImageProblemText(planImageProblem(resolved.floorPlanImageRef))}`, 'error');
        }
      });
      return true;
    }
    resolvingRef.current = false;
    openingRef.current = null;
    setOpeningHouse(null);
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
  }, [onHydrate, keepStoredHouseAside]);

  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;

    // The error screen dropped a tour's link after it crashed (#722).
    if (takeTourCrashNote()) {
      notify('The shared house hit an error and couldn’t be shown, so your own house is open.', 'error');
    }

    // A share link opens the shared house as a read-only tour (#722): the
    // visitor's own save is neither read onto the screen nor written until
    // they keep a copy.
    if (typeof window !== 'undefined' && isShareHash(window.location.hash)) {
      const hash = window.location.hash;
      // Refused before decoding, with the local house left as it was: a hash
      // this long is no house, and inflating it could take the tab down (#332).
      if (!isShareHashWithinBudget(hash)) {
        clearShareHash();
        setTourPhase('none');
        notify('This shared link is far larger than any house, so it was not opened. Your own house is unchanged.', 'error');
        hydrateFromLocalSave();
        return;
      }
      // The tour is on from the first render (`tourPhase` reads the hash),
      // so nothing autosaves while the decode (DecompressionStream) runs.
      // The hash stays for the whole tour: a reload opens the tour again.
      setTourPhase('touring');
      hydrationBaseRef.current = null;
      // A stored house still waiting for its image is not opened now (#936).
      hydrationRef.current += 1;
      resolvingRef.current = false;
      openingRef.current = null;
      setOpeningHouse(null);
      void readShareHash(hash).then((result) => {
        // Left for the visitor's own house while the link was opening.
        if (!isTourSession()) return;
        if (!result.ok) {
          // Truncated, corrupt or from a newer app: say which, without a
          // blocking alert, and open the local save (#607).
          clearShareHash();
          setTourPhase('none');
          notify(`${shareFailureMessage(result.reason)} Your own house is unchanged.`, 'error');
          hydrateFromLocalSave();
          return;
        }
        // A corrupt-but-parseable layout can still throw while it's applied
        // to the scene. Guard the dispatch so a bad share link doesn't crash
        // the whole mount (#206): the visitor's own house opens instead.
        try {
          onHydrate(result.layout);
          setTourHouse(result.layout);
        } catch (error) {
          console.warn('Failed to apply shared layout:', error);
          clearShareHash();
          setTourPhase('none');
          notify(`${shareFailureMessage('unreadable')} Your own house is unchanged.`, 'error');
          hydrateFromLocalSave();
        }
      });
      return;
    }

    hydrateFromLocalSave();
  }, [onHydrate, hydrateFromLocalSave]);

  // Keep a copy (#722): the toured house becomes the visitor's, through the
  // ordinary whole-house load. Nothing replaces the visitor's house until it
  // is a recovered copy, which no save evicts, and the kept one is saved: a
  // refusal leaves the tour, the hash and storage exactly as they were.
  const keepTourCopy = useCallback(
    (playCue: RefusedCue) => {
      const house = tourHouse;
      if (!isTourSession() || !house) return;
      const saved = saveOverStoredHouse(house);
      if (!saved.ok) {
        notifyRefused(saved.reason === 'yours' ? NO_ROOM_TO_KEEP_YOURS : COPY_NOT_SAVED[saved.reason], playCue);
        return;
      }
      // A restore point too, where it fits: History lists it beside the copy.
      // Taken after the save, so a refusal never touches the ring.
      snapshotBeforeReplace(saved.previous);
      lastSavedJsonRef.current = saved.json;
      saveStatus.setState({ lastSavedAt: Date.now(), saving: false, saveError: null });
      clearShareHash();
      setTourPhase('kept');
      // The copy is saved: the load that shows it is no edit, so it neither
      // autosaves nor takes a restore point that could push the visitor's out.
      hydrationBaseRef.current = layoutRef.current;
      setTourHouse(null);
      onKeepTourCopyRef.current?.(house, saved.copiedAside);
    },
    [tourHouse, saveStatus]
  );

  // Build your own (#722): back to the visitor's own house, or a fresh lot.
  const leaveTour = useCallback(() => {
    if (!isTourSession()) return;
    clearShareHash();
    setTourPhase('none');
    setTourHouse(null);
    if (hydrateFromLocalSave()) return;
    // Nothing of theirs to open (or it couldn't be, and was copied aside):
    // a fresh lot, which saves nothing until it is edited.
    hydrationBaseRef.current = layoutRef.current;
    onHydrate(INITIAL_LAYOUT);
  }, [hydrateFromLocalSave, onHydrate]);

  useEffect(() => {
    // The toured house is someone else's: nothing saves until Keep a copy (#722).
    if (isTourSession()) return;
    // The stored house is still opening (#936): an edit of the lot shown
    // meanwhile must not save over it.
    if (resolvingRef.current) return;
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
        const held = heldRawRef.current;
        const outcome = held !== null ? keepHouseAside(held) : keepStoredLayout();
        if (outcome !== 'kept' && outcome !== 'nothing') {
          saveStatus.setState({ saveError: outcome });
          return;
        }
        heldRawRef.current = null;
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
        // Storage may have become persistent (the storage-care ask): then
        // the stored image's inline copy can go (#936).
        if (layout.floorPlanImage) refreshPlanStoragePersisted();
      } else {
        // Keep `saving`/pending truthy and flag the error so the HUD reports
        // the failure instead of a false "Saved". A later successful edit
        // clears the flag.
        saveStatus.setState({ saveError: result.reason });
      }
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [layout, debounceMs, saveStatus]);

  // --- #936 plan image store ---
  // A floor-plan image moves into the image store as soon as the house
  // holds it (an upload, an import, a save from before the store); once
  // it is confirmed there, the save names it by ref instead.
  useEffect(
    () =>
      subscribePlanImageStored(() => {
        if (mainSaveHeldRef.current || resolvingRef.current || isTourSession()) return;
        const json = compactStoredHouse();
        if (json !== null) lastSavedJsonRef.current = json;
      }),
    []
  );
  // Another whole-house load (an import, a library load, another tab's
  // version adopted) while the stored house waits for its image wins, as a
  // load over that house: it asked about it and took its restore point
  // (`setOpeningHouse`), and the stored house is copied aside before the
  // load can save over it; if it can't be, the save is held. Then the
  // waiting hydration is dropped and the load saves like any edit.
  useEffect(
    () =>
      subscribeHouseReplaced(() => {
        if (!resolvingRef.current) return;
        hydrationRef.current += 1;
        resolvingRef.current = false;
        openingRef.current = null;
        setOpeningHouse(null);
        hydrationBaseRef.current = null;
        // The save as it was when the wait began: another tab may have
        // saved over it since (the load may be that tab's house, adopted).
        const raw = openingRawRef.current;
        openingRawRef.current = null;
        const outcome = raw === null ? 'nothing' : keepHouseAside(raw);
        if (outcome === 'kept') notify(OPENING_HOUSE_KEPT, 'info');
        else if (outcome !== 'nothing') {
          heldRawRef.current = raw;
          mainSaveHeldRef.current = true;
          saveStatus.setState({ saveError: outcome });
        }
      }),
    [saveStatus]
  );
  const planImage = layout.floorPlanImage;
  // The image on screen stays confirmed, however many others are stored.
  useEffect(() => pinPlanImage(planImage ?? null), [planImage]);
  useEffect(() => {
    if (!planImage || isTourSession() || storedPlanImageRef(planImage)) return;
    void storePlanImage(planImage);
  }, [planImage]);
  // --- end #936 ---

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
    // Returns why the owed save failed, if it did. Nothing is flushed while
    // the saved house is still opening (#936).
    const flush = (layout: RoomLayout | null, leaving: boolean): SaveFailureReason | null => {
      if (mainSaveHeldRef.current || resolvingRef.current || layout === null || isTourSession()) return null;
      let failed: SaveFailureReason | null = null;
      if (pendingRef.current) {
        const result = saveLayout(layout);
        // Still pending after a failure: a later flush, or the debounced
        // save, retries once storage has room again.
        if (result.ok) {
          pendingRef.current = false;
          lastSavedJsonRef.current = result.json;
        } else {
          failed = result.reason;
        }
        pointOwed = true;
      }
      if (!pointOwed || isUntouched(layout)) return failed;
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
      return failed;
    };
    // Before an update's reload (#933): the pagehide that follows records the point.
    flushNowRef.current = () => {
      const failed = flush(layoutRef.current, false);
      if (!pendingRef.current || isTourSession()) return 'saved';
      return failed === 'newer' ? 'newer' : 'failed';
    };
    // A crash has already removed these listeners: pagehide is never a crash.
    const onPageHide = () => {
      flush(layoutRef.current, true);
    };
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

  const flushSave = useCallback(() => flushNowRef.current(), []);

  return { saveStatus, remoteLayout, clearRemoteLayout, tourHouse, keepTourCopy, leaveTour, flushSave };
}
