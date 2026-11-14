import { useRoomEditor, useSelection } from '../contexts';
import { HARD_BUDGET_SELL_BACK_NOTE, isHardBudgetOn, loadTemplateUnderBudget, SELL_BACK_RATE } from '../lib/budget';
import { CURRENCY_SYMBOL } from '../lib/constants';
import { notify, notifyRefused } from '../lib/editor-notices';
import { confirmReplace, snapshotBeforeReplace } from '../lib/restore-point';
import { markLayoutLoaded } from './use-achievements';
import { useEvent } from './use-event';
import { layoutStore } from './use-layout-store';
import type { ROOM_TEMPLATES, RoomTemplateKey } from '../lib/constants';

export type RoomTemplate = (typeof ROOM_TEMPLATES)[RoomTemplateKey];

/**
 * A template over the current house, through the whole-house load path:
 * the Templates panel and the first-run start chooser (#721) share it.
 * Resolves true once the template replaced the house, false when it was
 * refused (hard budget) or the replace question was declined.
 */
export function useLoadTemplate(): (template: RoomTemplate) => Promise<boolean> {
  const { actions, history, playCue } = useRoomEditor();
  const { selectOnly } = useSelection();
  return useEvent(async (template: RoomTemplate) => {
    // The hard budget and its write-off stay the player's; under it
    // a template is a purchase, refused before asking (#691).
    const label = `${template.name} template`;
    const house = layoutStore.getState().layout;
    const asked = loadTemplateUnderBudget(house, template, label);
    if (asked.refusal !== null) {
      notifyRefused(asked.refusal, playCue);
      return false;
    }
    const note = isHardBudgetOn(house) ? HARD_BUDGET_SELL_BACK_NOTE : '';
    if (!(await confirmReplace(house, `the ${label}`, { note }))) return false;
    // Read again after the answer: another tab's version may have
    // been adopted while it asked, and its budget is what counts.
    const current = layoutStore.getState().layout;
    const load = loadTemplateUnderBudget(current, template, label);
    if (load.refusal !== null) {
      notifyRefused(load.refusal, playCue);
      return false;
    }
    snapshotBeforeReplace(current);
    history.commitNow();
    actions.applyLayout({
      ...load.layout,
      floors: load.layout.floors.map((floor) => ({ ...floor, items: [...floor.items] })),
    });
    markLayoutLoaded();
    if (load.writtenOff > 0) {
      notify(`The furniture it replaced sold back at ${Math.round(SELL_BACK_RATE * 100)}%: ${CURRENCY_SYMBOL}${load.writtenOff.toLocaleString()} written off.`, 'info');
    }
    selectOnly(null);
    return true;
  });
}
