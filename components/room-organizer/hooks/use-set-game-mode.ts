import { useEditorViewActions, useSelection, useViewSettings } from '../contexts';
import { useEvent } from './use-event';
import type { GameMode } from '../lib/types';
import type { SelectedWall } from '../lib/wall-sides';

/**
 * Switching DESIGN / FURNISH / EXPLORE with what each switch brings along:
 * the mode panel and the First steps card (#721) share it.
 */
export function useSetGameMode(onSelectedWallChange: (wall: SelectedWall | null) => void): (mode: GameMode) => void {
  const view = useViewSettings('drawWallMode', 'walkthroughMode');
  const { toggle, setView, setGameMode } = useEditorViewActions();
  const { selectOnly } = useSelection();
  return useEvent((mode: GameMode) => {
    setGameMode(mode);
    // The wall tool lives in DESIGN only; don't leave the draw mode
    // (and its paint/stamp panels) armed with no tile to disarm it (#151).
    if (mode !== 'build' && view.drawWallMode) toggle('drawWallMode');
    if (mode === 'live') {
      // EXPLORE is for looking around: drop the selection so its
      // popover doesn't float over the walkthrough (#339).
      selectOnly(null);
      onSelectedWallChange(null);
      // Walkthrough needs the 3D view — the hook requires `!view2D`, so
      // entering Live from the 2D top-down view is otherwise a silent
      // no-op (see #67). Drop view2D as we switch walkthrough on.
      setView((v) => ({ ...v, view2D: false, walkthroughMode: true }));
    } else if (view.walkthroughMode) {
      toggle('walkthroughMode');
    }
  });
}
