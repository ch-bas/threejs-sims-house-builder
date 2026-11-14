import { useCallback, useEffect, useMemo, useState } from 'react';
import { saveCustomSet } from '../lib/custom-sets';
import { notify } from '../lib/editor-notices';
import { expandSelection, groupIdsIn, isWholeGroup } from '../lib/groups';
import { randomSuffix } from '../lib/ids';
import type { LayoutActions } from './use-layout-state';
import type { SelectionContextValue } from '../contexts/selection-context';
import type { SoundCue } from '../lib/sounds';
import type { FloorLayout, FurnitureItem } from '../lib/types';
import type { SelectedWall, WallSide } from '../lib/wall-sides';
import type { Dispatch, SetStateAction } from 'react';

export interface UseSelectionActionsOptions {
  activeFloor: FloorLayout;
  activeFloorIndex: number;
  actions: Pick<LayoutActions, 'setGroup' | 'clearGroup'>;
  playCue: (cue: SoundCue) => void;
}

export interface SelectionActions {
  selectedItemId: string | null;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  extraSelectedIds: ReadonlySet<string>;
  setExtraSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  selectedWall: SelectedWall | null;
  setSelectedWall: Dispatch<SetStateAction<SelectedWall | null>>;
  selectedItem: FurnitureItem | null;
  allSelectedIds: ReadonlySet<string>;
  /** Make `id` the sole selection (null clears). */
  selectOnly(id: string | null): void;
  /** A click in either view: group expansion, toggling, promotion. */
  handleSelect(id: string, mode: 'replace' | 'toggle' | 'single'): void;
  handleInteriorWallSelect(id: string | null, side?: WallSide): void;
  /** No items selected; the extras always start over as a fresh set. */
  clearItemSelection(): void;
  deselectAll(): void;
  selectFromKeyboard(id: string): void;
  selectionIsGroup: boolean;
  selectionHasGroups: boolean;
  groupSelection(): void;
  ungroupSelection(): void;
  saveSelectionAsSet(name: string): boolean;
  /** The selection context's value. */
  selectionValue: SelectionContextValue;
}

/**
 * The editor's selection: the primary item, the extras of a multi-select and
 * the selected wall, with the guards that keep them pointing at things that
 * exist (#117, #224), group expansion (#154) and custom sets (#302).
 */
export function useSelectionActions({ activeFloor, activeFloorIndex, actions, playCue }: UseSelectionActionsOptions): SelectionActions {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedWall, setSelectedWall] = useState<SelectedWall | null>(null);
  const [extraSelectedIds, setExtraSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const handleInteriorWallSelect = useCallback((id: string | null, side?: WallSide) => {
    setSelectedWall(id === null ? null : { id, kind: 'interior', ...(side ? { side } : {}) });
  }, []);

  // Floor switch: drop the selection (it lives on the previous floor). Ahead
  // of the guards below, so a promotion they make on the same switch stands.
  useEffect(() => {
    setSelectedItemId(null);
    setSelectedWall(null);
    setExtraSelectedIds(new Set());
    // activeFloor.id: removing floor 0 (or reordering) can change WHICH floor
    // is active while the index stays 0 — keying on the index alone carried
    // the deleted floor's selection onto its replacement (#117).
  }, [activeFloorIndex, activeFloor.id]);

  // Ghost-selection guard: whenever the floor's items change (undo/redo,
  // import, clear floor, deletes from any path), drop selected ids that no
  // longer exist; a vanished primary promotes the first surviving extra (#117).
  useEffect(() => {
    const ids = new Set(activeFloor.items.map((item) => item.id));
    const primaryGone = selectedItemId !== null && !ids.has(selectedItemId);
    const hasStaleExtras = Array.from(extraSelectedIds).some((id) => !ids.has(id));
    if (!primaryGone && !hasStaleExtras) return;
    const liveExtras = Array.from(extraSelectedIds).filter((id) => ids.has(id));
    if (primaryGone) setSelectedItemId(liveExtras.shift() ?? null);
    setExtraSelectedIds(new Set(liveExtras));
  }, [activeFloor.items, selectedItemId, extraSelectedIds]);

  // Same guard for a selected interior wall: undo/redo past its creation (or
  // any path that removes it) would otherwise leave the paint panel open and
  // dispatching against a wall that no longer exists (#224).
  useEffect(() => {
    if (selectedWall?.kind !== 'interior') return;
    const exists = (activeFloor.interiorWalls ?? []).some((wall) => wall.id === selectedWall.id);
    if (!exists) setSelectedWall(null);
  }, [activeFloor.interiorWalls, selectedWall]);

  // Make `id` the sole selection (null clears). The one way panels set a
  // primary — pairing the two setters at every call site is how stale extras
  // leaked into later group operations (#117).
  const selectOnly = useCallback((id: string | null) => {
    setSelectedItemId(id);
    setExtraSelectedIds((extras) => (extras.size === 0 ? extras : new Set()));
  }, []);

  const clearItemSelection = useCallback(() => {
    setSelectedItemId(null);
    setExtraSelectedIds(new Set());
  }, []);

  // Plain reads + flat setter calls. The previous version computed the
  // promotion inside a nested setState updater and read the result back
  // synchronously — that only works on React's eager-evaluation path, and
  // StrictMode's double-invoked updaters ran the toggle twice (#117).
  //
  // Persistent groups (#154) expand HERE, not in the canvas handlers: both
  // the 3D raycast and the 2D hit-test report the clicked id and modifier,
  // and this one place turns a grouped id into its whole group, so the two
  // views can't drift. 'replace' selects the group with the clicked member
  // as primary; 'toggle' adds or removes the whole group; 'single'
  // (Alt+click) is the escape hatch that picks one member on its own.
  const handleSelect = useCallback(
    (id: string, mode: 'replace' | 'toggle' | 'single') => {
      const members = mode === 'single' ? new Set([id]) : expandSelection(activeFloor.items, id);
      if (mode !== 'toggle') {
        if (members.size === 1) {
          selectOnly(id);
          return;
        }
        setSelectedItemId(id);
        const extras = new Set(members);
        extras.delete(id);
        setExtraSelectedIds(extras);
        return;
      }
      if (selectedItemId === null) {
        setSelectedItemId(id);
        const extras = new Set(members);
        extras.delete(id);
        setExtraSelectedIds(extras);
        return;
      }
      const allIn = Array.from(members).every(
        (member) => member === selectedItemId || extraSelectedIds.has(member)
      );
      const next = new Set(extraSelectedIds);
      if (allIn) {
        // Toggling off: drop every member. If the primary was among them,
        // promote a surviving extra (keeping the rest of the multi-select
        // intact) or clear the selection entirely.
        for (const member of members) next.delete(member);
        if (members.has(selectedItemId)) {
          const [promoted] = next;
          if (promoted === undefined) {
            setSelectedItemId(null);
            setExtraSelectedIds(new Set());
            return;
          }
          next.delete(promoted);
          setSelectedItemId(promoted);
        }
        setExtraSelectedIds(next);
        return;
      }
      for (const member of members) {
        if (member !== selectedItemId) next.add(member);
      }
      setExtraSelectedIds(next);
    },
    [activeFloor.items, selectedItemId, extraSelectedIds, selectOnly]
  );

  const allSelectedIds = useMemo(() => {
    const set = new Set(extraSelectedIds);
    if (selectedItemId) set.add(selectedItemId);
    return set;
  }, [selectedItemId, extraSelectedIds]);

  const selectedItem = useMemo(
    () => (selectedItemId ? activeFloor.items.find((item) => item.id === selectedItemId) ?? null : null),
    [activeFloor.items, selectedItemId]
  );

  // Persistent groups (#154). Group merges whatever is selected — members of
  // other groups included — into one fresh group; Ungroup frees every
  // selected item. The selection itself is untouched either way, so a
  // freshly grouped set stays selected and draggable.
  const selectionIsGroup = useMemo(
    () => isWholeGroup(activeFloor.items, allSelectedIds),
    [activeFloor.items, allSelectedIds]
  );
  const selectionHasGroups = useMemo(
    () => groupIdsIn(activeFloor.items, allSelectedIds).size > 0,
    [activeFloor.items, allSelectedIds]
  );
  const groupSelection = useCallback(() => {
    if (allSelectedIds.size < 2) return;
    actions.setGroup(allSelectedIds);
  }, [actions, allSelectedIds]);
  const ungroupSelection = useCallback(() => {
    actions.clearGroup(allSelectedIds);
  }, [actions, allSelectedIds]);

  // Custom sets (#302): the selection, normalised around its centroid, under
  // a name the user picks — typed into the selection chip (#374). Groups
  // inside it are kept and come back as fresh groups when the set is placed.
  const saveSelectionAsSet = useCallback((name: string) => {
    const items = activeFloor.items.filter((item) => allSelectedIds.has(item.id));
    if (items.length < 2 || !name.trim()) return false;
    const saved = saveCustomSet(items, name, { idTag: randomSuffix() });
    if (!saved) {
      notify('Could not save the set — browser storage is full.', 'error');
      return false;
    }
    notify(`Saved “${saved.name}” to Furniture Sets.`, 'success');
    playCue('success');
    return true;
  }, [activeFloor.items, allSelectedIds, playCue]);

  const deselectAll = useCallback(() => selectOnly(null), [selectOnly]);
  // #650: Tab on the focused scene picked an item; a selected wall lets go, as on a click.
  const selectFromKeyboard = useCallback(
    (id: string) => {
      handleInteriorWallSelect(null);
      handleSelect(id, 'replace');
    },
    [handleInteriorWallSelect, handleSelect]
  );

  const selectionValue = useMemo<SelectionContextValue>(
    () => ({
      selectedItemId,
      setSelectedItemId,
      selectedItem,
      extraSelectedIds,
      setExtraSelectedIds,
      allSelectedIds,
      selectOnly,
    }),
    [selectedItemId, setSelectedItemId, selectedItem, extraSelectedIds, setExtraSelectedIds, allSelectedIds, selectOnly]
  );

  return {
    selectedItemId,
    setSelectedItemId,
    extraSelectedIds,
    setExtraSelectedIds,
    selectedWall,
    setSelectedWall,
    selectedItem,
    allSelectedIds,
    selectOnly,
    handleSelect,
    handleInteriorWallSelect,
    clearItemSelection,
    deselectAll,
    selectFromKeyboard,
    selectionIsGroup,
    selectionHasGroups,
    groupSelection,
    ungroupSelection,
    saveSelectionAsSet,
    selectionValue,
  };
}
