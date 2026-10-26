import { useEditorView } from '../contexts';

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
