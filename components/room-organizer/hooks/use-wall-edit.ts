import { useCallback, useRef, type MutableRefObject } from 'react';
import { ENTRANCE_WALL_ID, entrancePlanOutline } from '../lib/street';
import { dragWalls, planWallMove, wallPatches, type WallGrip, type WallPatch } from '../lib/wall-edit';
import type { FloorLayout, FurnitureItem, InteriorWall, RoomLayout } from '../lib/types';
import type { HeldGesture } from '../three/drag-handlers';

/** What a wall gesture shows while it is held: never in state, so nothing rebuilds per move. */
export interface WallMovePreview {
  walls: InteriorWall[];
  items: FurnitureItem[];
  /** The walls that moved, for the 3D ghosts. */
  moved: readonly InteriorWall[];
  /** Why a release here would change nothing. */
  refusal: string | null;
}

export interface WallGrabInfo {
  wallId: string;
  grip: WallGrip;
  x: number;
  z: number;
  /** This press is selecting the wall (the plan): it may start dragging too. */
  fresh?: boolean;
}

export interface UseWallEditParams {
  /** Off in EXPLORE, with a placement ghost in hand, during the walk and for the tools that take presses. */
  enabled: boolean;
  /** A press may drag a wall it is only now selecting: DESIGN on the plan, where a press has no camera to move. */
  pressDrags: boolean;
  layout: RoomLayout;
  activeFloor: FloorLayout;
  activeFloorIndex: number;
  selectedWallId: string | null;
  /** Shows the moved walls in the 3D scene, or clears them (null). */
  ghostsRef: MutableRefObject<((preview: WallMovePreview | null) => void) | null>;
  onMove(patches: readonly WallPatch[]): void;
  onRefused(message: string): void;
}

export interface UseWallEditResult {
  /** A press on a selected wall: the gesture to feed, or null to leave the press alone. */
  grabWall(info: WallGrabInfo): HeldGesture | null;
  /** The held gesture's preview, for the plan's ghost repaint. */
  wallMovePreview(): WallMovePreview | null;
  /** A wall is held: the keys that change the house wait for the release. */
  isHoldingWall(): boolean;
  /** Esc: drop the held gesture, its release commits nothing. True if there was one. */
  cancelWallHold(): boolean;
}

/**
 * The gesture of moving a wall, in both views (#718): each move computes the
 * floor's next walls from the state at the press and paints a preview, the
 * release dispatches once. The state changing under it (an undo, another tab)
 * calls it off rather than commit a stale move.
 */
export function useWallEdit(params: UseWallEditParams): UseWallEditResult {
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const previewRef = useRef<WallMovePreview | null>(null);
  const holdRef = useRef<{ cancelled: boolean } | null>(null);

  const clearPreview = useCallback((): void => {
    previewRef.current = null;
    paramsRef.current.ghostsRef.current?.(null);
  }, []);

  const grabWall = useCallback((info: WallGrabInfo): HeldGesture | null => {
    const p = paramsRef.current;
    const walls = p.activeFloor.interiorWalls;
    const selected = p.selectedWallId === info.wallId || (info.fresh === true && p.pressDrags);
    if (!p.enabled || !selected || !walls?.some((wall) => wall.id === info.wallId)) return null;
    const floor = p.activeFloor;
    const grab = { wallId: info.wallId, grip: info.grip, at: { x: info.x, z: info.z }, walls };
    const context = {
      roomWidth: p.layout.width,
      roomDepth: p.layout.height,
      cutout: p.layout.cutout,
      porch: entrancePlanOutline(p.layout, p.activeFloorIndex),
    };
    let refused = false;
    const hold = { cancelled: false };
    holdRef.current = hold;
    return {
      move(x, z, free) {
        if (hold.cancelled) return;
        if (info.wallId === ENTRANCE_WALL_ID) {
          // Once per gesture: the wall can't follow, and every move would ask.
          if (!refused) paramsRef.current.onRefused("The porch's back wall moves with the entrance.");
          refused = true;
          return;
        }
        if (paramsRef.current.activeFloor.interiorWalls !== walls) {
          clearPreview();
          return;
        }
        const next = dragWalls(grab, { x, z }, { roomWidth: context.roomWidth, roomDepth: context.roomDepth, cutout: context.cutout, free });
        if (!next) return;
        const plan = planWallMove(floor, wallPatches(walls, next), context);
        const preview: WallMovePreview = {
          walls: next,
          items: plan && !('refusal' in plan) ? plan.items : floor.items,
          moved: next.filter((wall, index) => wall !== walls[index]),
          refusal: plan && 'refusal' in plan ? plan.refusal : null,
        };
        previewRef.current = preview;
        paramsRef.current.ghostsRef.current?.(preview);
      },
      end(commit) {
        if (holdRef.current === hold) holdRef.current = null;
        if (hold.cancelled) return;
        const preview = previewRef.current;
        clearPreview();
        const latest = paramsRef.current;
        if (!commit || !preview || latest.activeFloor.interiorWalls !== walls) return;
        // The wall stopped being this gesture's to move while it was held.
        if (!latest.enabled || latest.selectedWallId !== info.wallId) return;
        if (preview.refusal !== null) {
          latest.onRefused(preview.refusal);
          return;
        }
        const patches = wallPatches(walls, preview.walls);
        if (patches.length > 0) latest.onMove(patches);
      },
    };
  }, [clearPreview]);

  const wallMovePreview = useCallback(() => previewRef.current, []);
  const isHoldingWall = useCallback(() => holdRef.current !== null, []);
  const cancelWallHold = useCallback((): boolean => {
    const hold = holdRef.current;
    if (!hold) return false;
    hold.cancelled = true;
    holdRef.current = null;
    clearPreview();
    return true;
  }, [clearPreview]);
  return { grabWall, wallMovePreview, isHoldingWall, cancelWallHold };
}
