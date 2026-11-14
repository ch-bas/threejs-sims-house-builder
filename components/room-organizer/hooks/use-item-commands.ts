import { useCallback } from 'react';
import { purchasePrice, purchaseRefusal } from '../lib/budget';
import { buildPasteItems, copyToClipboard } from '../lib/clipboard';
import { CAMERA_BRACKET_ARM } from '../lib/constants';
import { lockedMessage, notifyRefused, notifyRefusedOnce, notifyWithUndo, removedMessage } from '../lib/editor-notices';
import { COARSE_POINTER_QUERY } from '../lib/hud-layout';
import { randomSuffix } from '../lib/ids';
import { reseatWallMountedItem, settleWallMountedItem } from '../lib/opening-snap';
import { ENTRANCE_WALL_ID } from '../lib/street';
import { selectionTurns } from './layout-reducer';
import { useEvent } from './use-event';
import { layoutStore } from './use-layout-store';
import type { LayoutActions } from './use-layout-state';
import type { SelectionActions } from './use-selection-actions';
import type { SoundCue } from '../lib/sounds';
import type { EntrancePlanOutline } from '../lib/street';
import type { FloorLayout, RoomLayout, WallId } from '../lib/types';

/** Whether an item landed: the reducer refuses adds and copies on a full floor. */
function itemExists(id: string): boolean {
  return layoutStore.getState().layout.floors.some((floor) => floor.items.some((item) => item.id === id));
}

export interface UseItemCommandsOptions {
  layout: RoomLayout;
  activeFloor: FloorLayout;
  activeFloorIndex: number;
  /** The recess's span of the front wall on this storey (#394). */
  frontGap: EntrancePlanOutline | null;
  actions: LayoutActions;
  commitHistoryNow: () => void;
  undoHistory: () => void;
  playCue: (cue: SoundCue) => void;
  exploring: boolean;
  selection: Pick<SelectionActions, 'allSelectedIds' | 'selectOnly' | 'setSelectedItemId' | 'setExtraSelectedIds' | 'setSelectedWall'>;
}

/**
 * What the editor does to the selected items (rotate, twist, remove,
 * duplicate, copy, paste, nudge, lock) and the refusals that go with it, so
 * each plays one cue through the shared helpers (#460) and keeps the
 * selection on what exists.
 */
export function useItemCommands({
  layout,
  activeFloor,
  activeFloorIndex,
  frontGap,
  actions,
  commitHistoryNow,
  undoHistory,
  playCue,
  exploring,
  selection,
}: UseItemCommandsOptions) {
  const { allSelectedIds, selectOnly, setSelectedItemId, setExtraSelectedIds, setSelectedWall } = selection;

  // Re-seat a wall-mounted camera against its wall. A flush camera's body moves
  // to whichever side it faces (so the body + cone start at the wall surface
  // instead of passing through it); a bracketed camera stands off the wall by a
  // fixed arm, independent of facing, so it can pan freely. `bracket` overrides
  // the stored flag for the moment a user toggles the mount style.
  const reseatCamera = useCallback(
    (id: string, rotation: number, bracket?: boolean) => {
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (item?.type !== 'security-camera' || !item.position) return;
      const bracketed = bracket ?? item.cameraBracket ?? false;
      const pos = reseatWallMountedItem({
        position: item.position,
        itemWidth: item.width,
        itemDepth: item.depth,
        roomWidth: layout.width,
        roomDepth: layout.height,
        interiorWalls: activeFloor.interiorWalls ?? [],
        cutout: layout.cutout,
        rotation,
        ...(bracketed ? { bracketArm: CAMERA_BRACKET_ARM } : {}),
      });
      actions.moveItem(id, pos.x, pos.z);
    },
    [activeFloor.items, activeFloor.interiorWalls, layout.width, layout.height, layout.cutout, actions]
  );

  // A key or plan drag that met a lock (#635): says why, the way a budget
  // refusal does, since the cue alone is off by default.
  const refuseLocked = useCallback(
    (subject: string | number) => {
      notifyRefusedOnce(lockedMessage(subject, window.matchMedia(COARSE_POINTER_QUERY).matches), playCue);
    },
    [playCue]
  );

  // Locked items are immune to rotation — group rotates orbit items around
  // the centroid, so rotating a set containing a locked item would move it
  // (#115). The unlocked subset still rotates about its own centroid.
  const unlockedSelectedIds = useCallback(() => {
    const lockedIds = new Set(activeFloor.items.filter((item) => item.locked).map((item) => item.id));
    return new Set(Array.from(allSelectedIds).filter((id) => !lockedIds.has(id)));
  }, [activeFloor.items, allSelectedIds]);

  // Returns whether anything actually rotated. A real rotation plays the
  // rotate cue, a refused one (locked) the refused cue: a locked item's no-op
  // used to chime anyway, audibly lying about what happened (#209, #460).
  const rotateItemHandler = useCallback(
    (id: string): boolean => {
      if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
        const unlocked = unlockedSelectedIds();
        // Doors and windows stay on their walls (#583): a selection of only
        // those turns nothing, so the cue must not say it did.
        if (unlocked.size === 0) {
          refuseLocked(allSelectedIds.size);
          return false;
        }
        if (!selectionTurns(activeFloor.items, unlocked)) {
          playCue('refused');
          return false;
        }
        actions.rotateSelection(unlocked, Math.PI / 2);
        playCue('rotate');
        return true;
      }
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (!item) return false;
      if (item.locked) {
        refuseLocked(item.name);
        return false;
      }
      if (item.type === 'security-camera') {
        // A flush camera can only face into the room or straight out, so Rotate
        // flips 180° along its wall's in/out axis. A bracketed camera pans freely.
        const step = item.cameraBracket ? Math.PI / 2 : Math.PI;
        const next = ((item.rotation ?? 0) + step) % (Math.PI * 2);
        actions.setRotation(id, next);
        reseatCamera(id, next);
        playCue('rotate');
        return true;
      }
      const next = ((item.rotation ?? 0) + Math.PI / 2) % (Math.PI * 2);
      actions.setRotation(id, next);
      playCue('rotate');
      return true;
    },
    [allSelectedIds, unlockedSelectedIds, activeFloor.items, actions, reseatCamera, playCue, refuseLocked]
  );

  // Shift+R's 15° turn and each step of a two-finger twist (#689), which
  // plays its cue on the first step only (`cue`).
  const rotateItemByHandler = useCallback(
    (id: string, radians: number, cue = true) => {
      if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
        const unlocked = unlockedSelectedIds();
        if (unlocked.size === 0) {
          refuseLocked(allSelectedIds.size);
          return;
        }
        if (!selectionTurns(activeFloor.items, unlocked)) {
          playCue('refused');
          return;
        }
        actions.rotateSelection(unlocked, radians);
        if (cue) playCue('rotate');
        return;
      }
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (!item) return;
      if (item.locked) {
        refuseLocked(item.name);
        return;
      }
      // In [0, 2π): a twist turns both ways.
      const turn = Math.PI * 2;
      const next = ((((item.rotation ?? 0) + radians) % turn) + turn) % turn;
      actions.setRotation(id, next);
      reseatCamera(id, next);
      if (cue) playCue('rotate');
    },
    [allSelectedIds, unlockedSelectedIds, activeFloor.items, actions, reseatCamera, playCue, refuseLocked]
  );
  // A twist is only offered for what it would turn: otherwise the two
  // fingers stay the camera's pinch, never a refusal (#689).
  const canTwistItem = useCallback(
    (id: string) => {
      if (exploring) return false;
      const turning = allSelectedIds.size > 1 && allSelectedIds.has(id) ? unlockedSelectedIds() : new Set([id]);
      return selectionTurns(activeFloor.items, turning);
    },
    [exploring, allSelectedIds, unlockedSelectedIds, activeFloor.items]
  );

  // Toggle a camera's stand-off bracket. Enabling it keeps the current facing
  // and lifts the camera onto the arm; disabling it snaps the camera back flush
  // and re-locks facing to the wall's inward normal.
  const toggleCameraBracket = useCallback(
    (id: string) => {
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (item?.type !== 'security-camera') return;
      // The toggle moves the camera on/off its arm; a locked camera must not
      // move — and the reducer would now refuse the setRotation/moveItem half
      // anyway, leaving the bracket flag desynced from the position (#209).
      if (item.locked) return;
      const next = !item.cameraBracket;
      actions.updateItem(id, { cameraBracket: next });
      const rotation = next ? item.rotation ?? 0 : item.wallRotation ?? item.rotation ?? 0;
      if (!next) actions.setRotation(id, rotation);
      reseatCamera(id, rotation, next);
    },
    [activeFloor.items, actions, reseatCamera]
  );

  /**
   * Hard budget (#463e): true, after telling the player, when a buy costing
   * `price` is over what's left. The selection is left alone and the
   * refused cue plays instead of the place one: nothing was bought.
   */
  const refuseOverBudget = useCallback((price: number): boolean => {
    const refusal = purchaseRefusal(layoutStore.getState().layout, price);
    if (refusal === null) return false;
    notifyRefused(refusal, playCue);
    return true;
  }, [playCue]);

  // Removal toasts (#651): "Removed Sofa", with an Undo button that steps
  // back over exactly this removal. Nothing removed, no toast.
  const offerRemovalUndo = useCallback(
    (before: RoomLayout, ids: readonly string[]) => {
      if (layoutStore.getState().layout === before) return;
      const wanted = new Set(ids);
      const names = before.floors.flatMap((floor) => floor.items).filter((item) => wanted.has(item.id)).map((item) => item.name);
      if (names.length === 0) return;
      notifyWithUndo(removedMessage(names), { current: () => layoutStore.getState().layout, undo: undoHistory });
    },
    [undoHistory]
  );

  // Wrap layout actions with the side-effect of clearing the selection when
  // the targeted item disappears. Discrete actions (delete, duplicate, add,
  // paste) each get an undo step of their own (#425).
  const removeItem = useCallback(
    (id: string) => {
      commitHistoryNow();
      const before = layoutStore.getState().layout;
      // Demolish sells back: 80 % refunded under the hard budget (#463e).
      actions.sellItems([id]);
      offerRemovalUndo(before, [id]);
      playCue('remove');
      setSelectedItemId((current) => (current === id ? null : current));
      setExtraSelectedIds((extras) => {
        if (!extras.has(id)) return extras;
        const next = new Set(extras);
        next.delete(id);
        return next;
      });
    },
    [actions, commitHistoryNow, offerRemovalUndo, playCue, setSelectedItemId, setExtraSelectedIds]
  );

  const removeSelected = useCallback(() => {
    if (allSelectedIds.size === 0) return;
    // A lock pins position, not existence: every placed item is locked after
    // placement and drag, so deletion ignores it like Demolish does (#358).
    if (!activeFloor.items.some((item) => allSelectedIds.has(item.id))) return;
    commitHistoryNow();
    const before = layoutStore.getState().layout;
    actions.sellItems([...allSelectedIds]);
    offerRemovalUndo(before, [...allSelectedIds]);
    playCue('remove');
    setSelectedItemId(null);
    setExtraSelectedIds(new Set());
  }, [actions, commitHistoryNow, activeFloor.items, allSelectedIds, offerRemovalUndo, playCue, setSelectedItemId, setExtraSelectedIds]);

  // Delete on the keyboard: the whole selection when the item is part of it.
  const removeItemOrSelection = useCallback(
    (id: string) => {
      if (allSelectedIds.size > 1 && allSelectedIds.has(id)) {
        removeSelected();
        return;
      }
      removeItem(id);
    },
    [allSelectedIds, removeSelected, removeItem]
  );

  // Duplicate the current selection. For a multi-select every selected item is
  // copied (each offset by the reducer) and the copies become the new
  // selection, so the result is a clean set of duplicates rather than one new
  // copy mixed in with the stale originals' ids.
  // The reducer refuses a copy on a full floor; only copies that landed are
  // selected and chimed for, and a refusal sounds as one (#460).
  const duplicateSelected = useCallback(
    (primaryId: string) => {
      // Hard budget (#463e): all the copies or none, and say why — the
      // reducer would refuse an unaffordable copy silently.
      const copying =
        allSelectedIds.size > 1 && allSelectedIds.has(primaryId)
          ? activeFloor.items.filter((item) => allSelectedIds.has(item.id))
          : activeFloor.items.filter((item) => item.id === primaryId);
      if (refuseOverBudget(purchasePrice(copying))) return;
      commitHistoryNow();
      const multi = allSelectedIds.size > 1 && allSelectedIds.has(primaryId);
      // Duplicate the primary first so it becomes the new primary, then the
      // remaining selected items in a stable order.
      const others = multi ? Array.from(allSelectedIds).filter((id) => id !== primaryId) : [];
      const copies = [primaryId, ...others].map((id) => actions.duplicateItem(id)).filter(itemExists);
      const [newPrimary, ...newExtras] = copies;
      if (newPrimary === undefined) {
        playCue('refused');
        return;
      }
      playCue('place');
      setSelectedItemId(newPrimary);
      // A single copy clears stale extras, so the selection is only the copy.
      setExtraSelectedIds(new Set(newExtras));
    },
    [actions, commitHistoryNow, allSelectedIds, activeFloor.items, refuseOverBudget, playCue, setSelectedItemId, setExtraSelectedIds]
  );

  // Every catalog add chimes once (#460): 'place' for an item that landed,
  // 'refused' when the reducer refused it (a full floor). '' = not added.
  const chimePlacement = useCallback(
    (id: string): string => {
      if (!id) return id;
      if (!itemExists(id)) {
        playCue('refused');
        return '';
      }
      playCue('place');
      return id;
    },
    [playCue]
  );

  // A plan drag doesn't reach use-item-drag on a locked item, so the refusal
  // is here. In 3D the same press orbits the camera, which is no refusal.
  const handleLockedDrag = useEvent((id: string) => {
    const item = activeFloor.items.find((entry) => entry.id === id);
    if (item?.locked && !exploring) refuseLocked(item.name);
  });

  const refuseZone = useCallback((message: string) => notifyRefused(message, playCue), [playCue]);

  // Furniture clipboard (#153): copy normalizes the selection around its
  // centroid; paste rebuilds it on the ACTIVE floor (cross-floor paste is the
  // point), settled/clamped, unlocked, and selected — one undo entry.
  const copySelectionToClipboard = useCallback(() => {
    const items = activeFloor.items.filter((item) => allSelectedIds.has(item.id));
    return copyToClipboard(items) > 0;
  }, [activeFloor.items, allSelectedIds]);

  const pasteFromClipboard = useCallback(() => {
    const built = buildPasteItems({
      roomWidth: layout.width,
      roomDepth: layout.height,
      cutout: layout.cutout,
      interiorWalls: activeFloor.interiorWalls ?? [],
      idTag: randomSuffix(),
      floorIndex: activeFloorIndex,
    });
    if (built.length === 0) return false;
    if (refuseOverBudget(purchasePrice(built))) return false;
    commitHistoryNow();
    actions.addItems(built);
    selectOnly(built[0]!.id);
    if (built.length > 1) {
      setExtraSelectedIds(new Set(built.slice(1).map((item) => item.id)));
    }
    playCue('place');
    return true;
  }, [layout.width, layout.height, layout.cutout, activeFloor.interiorWalls, activeFloorIndex, actions, commitHistoryNow, selectOnly, setExtraSelectedIds, playCue, refuseOverBudget]);

  // Arrow nudges settle wall-mounted items back onto their wall the way
  // drag release does — a nudged door slides along its wall instead of
  // translating into the room as a free slab (#116).
  const nudgeItem = useCallback(
    (id: string, x: number, z: number) => {
      const item = activeFloor.items.find((entry) => entry.id === id);
      const settled = item
        ? settleWallMountedItem(
            item,
            { x, z },
            layout.width,
            layout.height,
            activeFloor.interiorWalls ?? [],
            frontGap,
            layout.cutout
          )
        : null;
      if (settled) actions.updateItem(id, settled);
      else actions.moveItem(id, x, z);
    },
    [activeFloor.items, activeFloor.interiorWalls, layout.width, layout.height, layout.cutout, frontGap, actions]
  );

  const toggleLock = useCallback(
    (id: string) => {
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (!item) return;
      // The selection follows the primary item, as the Lock tile reads.
      const ids = allSelectedIds.size > 1 && allSelectedIds.has(id) ? allSelectedIds : [id];
      for (const member of ids) actions.setLocked(member, !item.locked);
    },
    [activeFloor.items, allSelectedIds, actions]
  );

  const refuseLockedItem = useCallback(
    (id: string) => {
      const item = activeFloor.items.find((entry) => entry.id === id);
      if (item) refuseLocked(item.name);
    },
    [activeFloor.items, refuseLocked]
  );

  const removeInteriorWall = useCallback(
    (id: string) => {
      if (id === ENTRANCE_WALL_ID) {
        notifyRefusedOnce("The porch's back wall goes with the entrance: remove the entrance instead.", playCue);
        return;
      }
      actions.removeInteriorWall(id);
      setSelectedWall(null);
    },
    [actions, playCue, setSelectedWall]
  );

  // Keep the selection (and the auto-opened paint panel) after hiding an
  // exterior wall so the Wall Visibility toggles stay reachable to restore it.
  const toggleExteriorWall = useCallback(
    (id: string) => {
      actions.toggleExteriorWall(id as WallId);
    },
    [actions]
  );

  return {
    rotateItemHandler,
    rotateItemByHandler,
    canTwistItem,
    toggleCameraBracket,
    refuseLocked,
    refuseOverBudget,
    removeItem,
    removeItemOrSelection,
    duplicateSelected,
    chimePlacement,
    handleLockedDrag,
    refuseZone,
    copySelectionToClipboard,
    pasteFromClipboard,
    nudgeItem,
    toggleLock,
    refuseLockedItem,
    removeInteriorWall,
    toggleExteriorWall,
  };
}
