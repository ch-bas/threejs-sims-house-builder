import { useCallback } from 'react';
import { notify, type RefusedCue } from '../lib/editor-notices';
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
  /** Drops the selection, the selected wall and the distance points. */
  clearTransientSelection: () => void;
}

export interface HouseLoading {
  saveStatus: SaveStatusStore;
  remoteLayout: RoomLayout | null;
  clearRemoteLayout(): void;
  adoptRemoteLayout(): void;
  /** The shared house being toured (#722), once decoded. */
  tourHouse: RoomLayout | null;
  keepTourCopy(playCue: RefusedCue): void;
  leaveTour(): void;
}

/**
 * The whole-house loads the editor makes on its own: the house the session
 * opens on (a share link's opens as a tour), a toured house kept (#722), and
 * another tab's save adopted (#123). Each follows the load rules: a restore point
 * and a history commit before a replacement, and loads earn nothing (#450).
 */
export function useHouseLoading({
  layout,
  actions,
  commitHistoryNow,
  clearHistory,
  clearTransientSelection,
}: UseHouseLoadingOptions): HouseLoading {
  const { saveStatus, remoteLayout, clearRemoteLayout, tourHouse, keepTourCopy, leaveTour } = useLayoutPersistence({
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
    // Keep a copy (#722), once the copy is saved: the rest of an ordinary
    // whole-house load. The persistence copied the stored house aside and
    // took its restore point first, and refuses when it can't.
    onKeepTourCopy: useCallback(
      (house: RoomLayout, copiedAside: boolean) => {
        commitHistoryNow();
        actions.applyLayout(house);
        markLayoutLoaded();
        clearTransientSelection();
        // The tour had nothing to undo, and an undo step back to the same
        // house would change nothing: the history starts at the copy.
        clearHistory(layoutStore.getState().layout);
        const name = house.name.trim() || 'the shared house';
        notify(
          copiedAside
            ? `Kept a copy of “${name}”: it saves here now. Your previous house is kept as a recovered copy in Manage → Saved Layouts → History.`
            : `Kept a copy of “${name}”: it saves here now.`,
          'success'
        );
      },
      [actions, commitHistoryNow, clearHistory, clearTransientSelection]
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

  return { saveStatus, remoteLayout, clearRemoteLayout, adoptRemoteLayout, tourHouse, keepTourCopy, leaveTour };
}
