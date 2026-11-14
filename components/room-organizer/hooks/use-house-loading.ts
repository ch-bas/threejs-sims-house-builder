import { useCallback } from 'react';
import { notifyWithUndo } from '../lib/editor-notices';
import { snapshotBeforeReplace } from '../lib/restore-point';
import { markLayoutLoaded } from './use-achievements';
import { useLayoutPersistence, type SaveStatusStore } from './use-layout-persistence';
import { layoutStore } from './use-layout-store';
import type { LayoutActions } from './use-layout-state';
import type { RoomLayout } from '../lib/types';

export interface UseHouseLoadingOptions {
  layout: RoomLayout;
  actions: Pick<LayoutActions, 'applyLayout'>;
  commitHistoryNow: () => void;
  clearHistory: (baseline: RoomLayout) => void;
  undoHistory: () => void;
  /** Drops the selection, the selected wall and the distance points. */
  clearTransientSelection: () => void;
}

export interface HouseLoading {
  saveStatus: SaveStatusStore;
  remoteLayout: RoomLayout | null;
  clearRemoteLayout(): void;
  adoptRemoteLayout(): void;
}

/**
 * The whole-house loads the editor makes on its own: the house the session
 * opens on, a share link opened over the player's house (#573), and another
 * tab's save adopted (#123). Each follows the load rules: a restore point
 * and a history commit before a replacement, and loads earn nothing (#450).
 */
export function useHouseLoading({
  layout,
  actions,
  commitHistoryNow,
  clearHistory,
  undoHistory,
  clearTransientSelection,
}: UseHouseLoadingOptions): HouseLoading {
  const { saveStatus, remoteLayout, clearRemoteLayout } = useLayoutPersistence({
    layout,
    onHydrate: useCallback(
      (saved: RoomLayout) => {
        actions.applyLayout(saved);
        // The saved or shared house the session opens on earns nothing (#450).
        markLayoutLoaded();
        clearTransientSelection();
        // The store dispatch is synchronous, so this is the exact (normalised)
        // layout the next render shows — an explicit baseline (#354).
        clearHistory(layoutStore.getState().layout);
      },
      [actions, clearHistory, clearTransientSelection]
    ),
    // A share link over the player's own house, once they said yes (#573):
    // an ordinary replacement, one Ctrl+Z from the house it replaced.
    onOpenShared: useCallback(
      (shared: RoomLayout) => {
        snapshotBeforeReplace(layoutStore.getState().layout);
        commitHistoryNow();
        actions.applyLayout(shared);
        markLayoutLoaded();
        clearTransientSelection();
        notifyWithUndo('Opened the shared house. Undo brings yours back; it is also kept in Manage → Saved Layouts → History.', {
          current: () => layoutStore.getState().layout,
          undo: undoHistory,
        });
      },
      [actions, commitHistoryNow, clearTransientSelection, undoHistory]
    ),
  });

  // Adopt the snapshot another tab saved (#123). Deliberately a plain
  // applyLayout, not the hydrate path: it lands as a normal history entry, so
  // switching to the other tab's version is one Ctrl+Z away from being undone.
  const adoptRemoteLayout = useCallback(() => {
    if (!remoteLayout) return;
    snapshotBeforeReplace(layout);
    // An edit still in the debounce window keeps its own undo step (#555).
    commitHistoryNow();
    actions.applyLayout(remoteLayout);
    markLayoutLoaded();
    clearTransientSelection();
    clearRemoteLayout();
  }, [remoteLayout, layout, actions, commitHistoryNow, clearTransientSelection, clearRemoteLayout]);

  return { saveStatus, remoteLayout, clearRemoteLayout, adoptRemoteLayout };
}
