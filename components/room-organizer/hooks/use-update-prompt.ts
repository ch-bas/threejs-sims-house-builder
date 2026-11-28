import { useEffect, useRef, useSyncExternalStore } from 'react';
import { confirmOpen } from '../lib/confirm-dialog';
import { notify, notifyRefused, type RefusedCue } from '../lib/editor-notices';
import { isPhotoMode } from '../lib/photo-mode';
import { applyUpdate, subscribeUpdateReady, updateKind, type SaveFlush, type UpdateKind } from '../lib/service-worker';
import { isTypingTarget } from '../lib/walk-input';

/**
 * Dialogs that hold the page: the start chooser and the welcome card
 * included, the side drawer (an aside, a panel the player works in) not.
 */
const MODAL_DIALOGS = 'div[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
/** How often a held-back offer looks again for a calm moment. */
const CALM_POLL_MS = 2_000;
/** The notice closes by itself; a tab in view offers again after this long. */
export const REOFFER_MS = 30 * 60 * 1000;
/** Offers per update, the first included: a reminder, never a nag. */
export const MAX_OFFERS = 3;

export const UPDATE_MESSAGES: Record<UpdateKind, string> = {
  newer: 'A new version is ready',
  stale: 'This tab is on an older version',
};
export const UPDATE_ACTION_NAME = 'Reload to open the new version';
export const UPDATE_NOT_SAVED = 'Your latest change isn’t saved yet, so the page wasn’t reloaded. Check the save status, then try again.';
export const UPDATE_NEWER_SAVED =
  'Another tab saved a newer version of your house, so the page wasn’t reloaded. Choose Save here anyway, or reload that tab first.';
export const UPDATE_STUCK = 'The new version didn’t start, so nothing was changed. Try Reload again in a moment.';
export const UPDATE_NOT_NOW = 'Finish what you’re doing first, then reload to update.';

export interface UseUpdatePromptOptions {
  /**
   * False while something is under way that no offer may interrupt: EXPLORE,
   * photo mode, the walk, a held placement ghost, a wall draft with a point
   * placed, zone or ground drawing.
   */
  calm: boolean;
  /** A drag or a wall gesture under way. */
  isHoldActive(): boolean;
  /** Saves a change still waiting for the autosave. */
  flushSave(): SaveFlush;
  playCue: RefusedCue;
}

/**
 * The update prompt (#933): once a newer build's worker waits for this page
 * of the older build, a calm "A new version is ready · Reload" notice; once
 * another tab's update moved this tab's worker on, "This tab is on an older
 * version · Reload". Raised only while nothing is under way (no drag, no
 * dialog, no focused text field, `calm`), and again in a tab in view after
 * `REOFFER_MS`, `MAX_OFFERS` in all. Reload saves first, then hands over
 * (lib/service-worker.ts `applyUpdate`).
 */
export function useUpdatePrompt({ calm, isHoldActive, flushSave, playCue }: UseUpdatePromptOptions): void {
  const kind = useSyncExternalStore(subscribeUpdateReady, updateKind, () => null);
  const latest = useRef({ calm, isHoldActive, flushSave, playCue });
  latest.current = { calm, isHoldActive, flushSave, playCue };
  // Per kind: a stale tab is told again even after a newer offer.
  const offers = useRef<{ kind: UpdateKind | null; count: number; at: number }>({ kind: null, count: 0, at: 0 });

  useEffect(() => {
    if (!kind || !calm) return undefined;
    if (offers.current.kind !== kind) offers.current = { kind, count: 0, at: 0 };
    const busy = (): boolean =>
      !latest.current.calm ||
      latest.current.isHoldActive() ||
      isPhotoMode() ||
      confirmOpen() ||
      document.querySelector(MODAL_DIALOGS) !== null ||
      isTypingTarget(document.activeElement);
    const offer = (): void => {
      const seen = offers.current;
      if (seen.count >= MAX_OFFERS || (seen.count > 0 && Date.now() - seen.at < REOFFER_MS)) return;
      if (document.visibilityState !== 'visible' || busy()) return;
      offers.current = { kind, count: seen.count + 1, at: Date.now() };
      notify(UPDATE_MESSAGES[kind], 'info', {
        slot: 'update',
        action: {
          label: 'Reload',
          name: UPDATE_ACTION_NAME,
          keepOpen: true,
          run: async () => {
            const { flushSave: flush, playCue: cue } = latest.current;
            if (busy()) {
              notifyRefused(UPDATE_NOT_NOW, cue);
              return false;
            }
            const outcome = await applyUpdate({ flushSave: flush, reload: () => window.location.reload(), container: navigator.serviceWorker });
            if (outcome === 'not-saved') notifyRefused(UPDATE_NOT_SAVED, cue);
            if (outcome === 'newer-saved') notifyRefused(UPDATE_NEWER_SAVED, cue);
            if (outcome === 'stuck') notifyRefused(UPDATE_STUCK, cue);
            return outcome === 'reloading' || outcome === 'gone';
          },
        },
      });
    };
    offer();
    const timer = window.setInterval(offer, CALM_POLL_MS);
    document.addEventListener('visibilitychange', offer);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', offer);
    };
  }, [kind, calm]);
}
