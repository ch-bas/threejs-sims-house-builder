import { useRoomEditor, useSelection } from '../contexts';
import { challengeLayout, isUntouchedChallengeLot, type Challenge } from '../lib/challenges';
import { formatMoney } from '../lib/format';
import { confirmReplace, snapshotBeforeReplace } from '../lib/restore-point';
import { markLayoutLoaded } from './use-achievements';
import { useEvent } from './use-event';
import { layoutStore } from './use-layout-store';

/**
 * Start a challenge brief (#909): an empty house of the brief's lot with its
 * funds, through the whole-house load path, like a template. The brief sets
 * its own funds and hard budget: it is a new game, not a purchase. Resolves
 * true once the brief replaced the house, false when the replace question
 * was declined.
 */
export function useStartChallenge(): (challenge: Challenge) => Promise<boolean> {
  const { actions, history } = useRoomEditor();
  const { selectOnly } = useSelection();
  return useEvent(async (challenge: Challenge) => {
    const house = layoutStore.getState().layout;
    // A brief's lot nothing was done on is as good as the starting house.
    // Otherwise the question says the funds change with the house: nothing
    // is sold back, the old house and its funds come back on undo.
    const note = ` The challenge brings its own funds, ${formatMoney(challenge.funds)}, with the hard budget on; this house's funds come back with it.`;
    if (!isUntouchedChallengeLot(house) && !(await confirmReplace(house, `the ${challenge.name} challenge`, { note }))) return false;
    // The house on screen now: asking takes time, and another tab's
    // version may have been adopted meanwhile.
    snapshotBeforeReplace(layoutStore.getState().layout);
    history.commitNow();
    actions.applyLayout(challengeLayout(challenge, Date.now()));
    markLayoutLoaded();
    selectOnly(null);
    return true;
  });
}
