import { useCallback, useSyncExternalStore } from 'react';
import { useRoomEditor } from '../contexts';
import { purchasePrice, purchaseRefusal } from '../lib/budget';
import { copyRoomToClipboard, roomOnClipboard, subscribeClipboard } from '../lib/clipboard';
import { notify, notifyRefusedOnce } from '../lib/editor-notices';
import { randomSuffix } from '../lib/ids';
import { pasteSpot, planRoomTransfer, type RoomArrangement, type RoomTransfer, type RoomTransferResult } from '../lib/room-transfer';

export interface RoomTransferCommands {
  /** The room on the clipboard, kept current across copies anywhere. */
  copiedRoom: RoomArrangement | null;
  /** Move, mirror or copy a room: one action, one undo step, one cue. Null when refused or a no-op. */
  transferRoom(transfer: RoomTransfer): RoomTransferResult | null;
  /** Paste the copied room on the active storey, where it was or beside it. */
  pasteRoom(): RoomTransferResult | null;
  copyRoom(room: RoomArrangement, name: string): void;
  /** A refusal with its one cue, raised once while it is on screen. */
  refuse(message: string): void;
}

const noRoom = (): null => null;

/**
 * The room transfer commands (#925): the one place their cues play, the
 * hard budget is asked and the history step is cut. The room chip only calls these.
 */
export function useRoomTransfer(): RoomTransferCommands {
  const { layout, activeFloor, activeFloorIndex, actions, playCue, history } = useRoomEditor();
  const copiedRoom = useSyncExternalStore(subscribeClipboard, roomOnClipboard, noRoom);

  const refuse = useCallback((message: string) => notifyRefusedOnce(message, playCue), [playCue]);

  const transferRoom = useCallback(
    (transfer: RoomTransfer): RoomTransferResult | null => {
      const plan = planRoomTransfer(layout, activeFloorIndex, transfer);
      if (!plan) return null;
      if ('refusal' in plan) {
        refuse(plan.refusal);
        return null;
      }
      if (transfer.kind === 'copy' || transfer.kind === 'paste') {
        const known = new Set(activeFloor.items.map((item) => item.id));
        const refusal = purchaseRefusal(layout, purchasePrice(plan.floor.items.filter((item) => !known.has(item.id))));
        if (refusal) {
          refuse(refusal);
          return null;
        }
      }
      history.commitNow();
      actions.transferRoom(transfer);
      playCue(transfer.kind === 'mirror' ? 'rotate' : 'place');
      return plan;
    },
    [layout, activeFloorIndex, activeFloor.items, actions, history, playCue, refuse]
  );

  const pasteRoom = useCallback((): RoomTransferResult | null => {
    const room = roomOnClipboard();
    if (!room) return null;
    const idTag = randomSuffix();
    const spot = pasteSpot(layout, activeFloorIndex, room, idTag);
    if ('refusal' in spot) {
      refuse(spot.refusal);
      return null;
    }
    return transferRoom({ kind: 'paste', room, idTag, ...spot });
  }, [layout, activeFloorIndex, refuse, transferRoom]);

  const copyRoom = useCallback((room: RoomArrangement, name: string) => {
    copyRoomToClipboard(room);
    notify(`Copied ${name}: Paste room puts it on any storey.`, 'success');
  }, []);

  return { copiedRoom, transferRoom, pasteRoom, copyRoom, refuse };
}
