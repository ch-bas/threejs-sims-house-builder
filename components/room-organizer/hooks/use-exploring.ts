import { useEditorView } from '../contexts';
import { useTourPhase } from './use-tour-phase';

/**
 * Why a house-editing control is off: EXPLORE looks around and never edits
 * the house (#339, #643). The controls that edit it are disabled there with
 * this as their hint.
 */
export const NOT_WHILE_EXPLORING = 'Not while exploring — switch to DESIGN or FURNISH to change the house';

/** Whether the editor is in EXPLORE, where nothing edits the house (#643). */
export function useExploring(): boolean {
  return useEditorView((state) => state.gameMode === 'live');
}

/** The same hint over a shared house, which is edited by keeping a copy (#722). */
export const NOT_WHILE_TOURING = 'A shared house — Keep a copy to edit it';

/** The hint on a house-editing control that EXPLORE turns off, tour-aware (#722). */
export function useNotWhileExploring(): string {
  return useTourPhase() === 'touring' ? NOT_WHILE_TOURING : NOT_WHILE_EXPLORING;
}
