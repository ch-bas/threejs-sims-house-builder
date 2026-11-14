import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notifyRefused } from '../lib/editor-notices';
import { formatMetres } from '../lib/format';
import { entrancePlanOutline } from '../lib/street';
import { MIN_WALL_LENGTH, snapWallEndpoint, wallAngleDegrees, wallEndAtLength, type WallSnapResult } from '../lib/wall-snap';
import { useEvent } from './use-event';
import { useRoomStamp } from './use-room-stamp';
import { useShiftHeld } from './use-shift-held';
import type { LayoutActions } from './use-layout-state';
import type { RoomStampSpec } from '../lib/room-stamp';
import type { SoundCue } from '../lib/sounds';
import type { FloorLayout, RoomLayout } from '../lib/types';
import type { SelectedWall } from '../lib/wall-sides';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

type Point = { x: number; z: number };

export interface UseWallDraftOptions {
  layout: RoomLayout;
  activeFloor: FloorLayout;
  activeFloorIndex: number;
  drawWallMode: boolean;
  drawZoneMode: boolean;
  measurementMode: boolean;
  actions: Pick<LayoutActions, 'addInteriorWall' | 'addInteriorWalls'>;
  playCue: (cue: SoundCue) => void;
  setSelectedWall: Dispatch<SetStateAction<SelectedWall | null>>;
  /** Commits the history's pending step, so each wall is one undo step. Set once the history exists. */
  commitStepRef: MutableRefObject<() => void>;
}

/**
 * The wall tool: the draft's anchor and snapped tip, a typed length (#723),
 * the room stamp in hand (#724), and the resets when the tool or the floor
 * changes.
 */
export function useWallDraft({
  layout,
  activeFloor,
  activeFloorIndex,
  drawWallMode,
  drawZoneMode,
  measurementMode,
  actions,
  playCue,
  setSelectedWall,
  commitStepRef,
}: UseWallDraftOptions) {
  const [wallDraft, setWallDraft] = useState<Point | null>(null);
  const [pointerWorld, setPointerWorld] = useState<Point | null>(null);

  // Shift draws free of the angle steps and the grid (#723).
  const wallFree = useShiftHeld(drawWallMode);
  const snapWallPoint = useCallback(
    (point: Point) =>
      snapWallEndpoint({
        point,
        existingWalls: activeFloor.interiorWalls ?? [],
        fromPoint: wallDraft,
        roomWidth: layout.width,
        roomDepth: layout.height,
        cutout: layout.cutout,
        free: wallFree,
      }),
    [activeFloor.interiorWalls, wallDraft, layout.width, layout.height, layout.cutout, wallFree]
  );
  const wallTipUnderPointer = useMemo(
    () => (drawWallMode && pointerWorld ? snapWallPoint(pointerWorld) : null),
    [drawWallMode, pointerWorld, snapWallPoint]
  );
  // With the length field open the draft holds still: the pointer is on its
  // way to the field's buttons, and the preview shows where Place will go.
  const [wallLengthOpen, setWallLengthOpen] = useState(false);
  const wallHeldTipRef = useRef<WallSnapResult | null>(null);
  const wallSnapResult = wallLengthOpen ? wallHeldTipRef.current : wallTipUnderPointer;
  // Which way the draft points, kept while the pointer is away at the length
  // field (#723). A new anchor starts it over.
  const wallAimRef = useRef<Point | null>(null);
  // A point rounds off the pointer that placed it: that gap is no direction,
  // only the pointer moving on is. A finger never does, and picks one instead.
  const wallPlacedByRef = useRef<Point | null>(null);
  if (!wallLengthOpen && wallDraft && wallTipUnderPointer && pointerWorld !== wallPlacedByRef.current) {
    const x = wallTipUnderPointer.point.x - wallDraft.x;
    const z = wallTipUnderPointer.point.z - wallDraft.z;
    if (Math.hypot(x, z) >= MIN_WALL_LENGTH) {
      wallAimRef.current = { x, z };
      wallHeldTipRef.current = wallTipUnderPointer;
    }
  }

  // The one way a wall point lands, clicked or typed (#723).
  const placeWallPoint = useCallback(
    (point: Point) => {
      wallAimRef.current = null;
      wallHeldTipRef.current = null;
      wallPlacedByRef.current = pointerWorld;
      if (!wallDraft) {
        setWallDraft(point);
        return;
      }
      // Reject zero-length walls (two clicks on the same vertex).
      const length = Math.hypot(point.x - wallDraft.x, point.z - wallDraft.z);
      if (length < MIN_WALL_LENGTH) {
        setWallDraft(null);
        return;
      }
      const id = `wall-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      // A segment is one undo step, however quickly the next follows.
      commitStepRef.current();
      actions.addInteriorWall({
        id,
        x1: wallDraft.x,
        z1: wallDraft.z,
        x2: point.x,
        z2: point.z,
      });
      // Chain: keep the just-placed endpoint as the start of the next wall.
      setWallDraft(point);
    },
    [wallDraft, actions, pointerWorld, commitStepRef]
  );

  // The room stamp in hand (#724): it takes the wall tool's clicks.
  const stampRef = useRef<{ armed: boolean; release(x: number, z: number): void }>({ armed: false, release: () => {} });
  /** A click on the floor, if the wall tool takes it: true when it did. */
  const handleWallClick = useCallback(
    (x: number, z: number): boolean => {
      if (stampRef.current.armed) {
        stampRef.current.release(x, z);
        return true;
      }
      if (drawWallMode) {
        placeWallPoint(snapWallPoint({ x, z }).point);
        return true;
      }
      return false;
    },
    [drawWallMode, placeWallPoint, snapWallPoint]
  );

  const handleFloorPointerMove = useCallback((x: number, z: number) => {
    setPointerWorld({ x, z });
  }, []);

  const handleFloorPointerLeave = useCallback(() => {
    setPointerWorld(null);
  }, []);

  // A typed length: the draft's direction unless a button named one (#723).
  const handleWallLength = (length: number, direction: Point | null): boolean => {
    const aim = direction ?? wallAimRef.current;
    if (!wallDraft || !aim) return false;
    const end = wallEndAtLength(wallDraft, aim, length, layout.width, layout.height, layout.cutout);
    if (!end) {
      notifyRefused(`A ${formatMetres(length)} wall from here runs past the outside wall.`, playCue);
      return false;
    }
    placeWallPoint(end);
    return true;
  };

  // The tools that take every press leave a selected wall's handles with
  // nothing to do.
  useEffect(() => {
    if (drawWallMode || drawZoneMode || measurementMode) setSelectedWall(null);
  }, [drawWallMode, drawZoneMode, measurementMode, setSelectedWall]);

  const planPorch = useMemo(
    () => (drawWallMode ? entrancePlanOutline(layout, activeFloorIndex) : null),
    [drawWallMode, layout, activeFloorIndex]
  );
  const stampContext = useMemo(
    () => ({
      existingWalls: activeFloor.interiorWalls ?? [],
      roomWidth: layout.width,
      roomDepth: layout.height,
      cutout: layout.cutout,
      porch: planPorch,
      hiddenWalls: activeFloor.hiddenWalls,
    }),
    [activeFloor.interiorWalls, activeFloor.hiddenWalls, layout.width, layout.height, layout.cutout, planPorch]
  );
  const roomStamp = useRoomStamp({
    context: stampContext,
    pointer: drawWallMode ? pointerWorld : null,
    onPointer: handleFloorPointerMove,
    onPlace: (plan) => {
      commitStepRef.current();
      // One dispatch, so one Undo takes the whole room back.
      actions.addInteriorWalls(plan.walls);
      playCue('place');
    },
    onRefused: (message) => notifyRefused(message, playCue),
  });
  stampRef.current = roomStamp;
  const { cancel: cancelStamp } = roomStamp;
  const armStamp = useEvent((spec: RoomStampSpec) => {
    setWallDraft(null);
    roomStamp.arm(spec);
  });
  const stampGhost = useMemo(() => {
    const ghost = roomStamp.ghost;
    if (!ghost) return null;
    const { centerX: x, centerZ: z, width, depth } = ghost.placement;
    return { walls: ghost.walls, x, z, width, depth, refused: ghost.refusal !== null };
  }, [roomStamp.ghost]);

  // Reset wall draft + wall selection whenever draw mode flips off.
  useEffect(() => {
    if (!drawWallMode) {
      setWallDraft(null);
      setSelectedWall(null);
      setPointerWorld(null);
      cancelStamp();
    }
  }, [drawWallMode, cancelStamp, setSelectedWall]);

  // Floor switch: drop any in-progress wall draft (it lives on the previous
  // floor). activeFloor.id: a removed floor 0 leaves the index at 0 (#117).
  useEffect(() => {
    setWallDraft(null);
    cancelStamp();
  }, [activeFloorIndex, activeFloor.id, cancelStamp]);

  /** Escape: puts the stamp down, else drops the draft; true when it did either. */
  const escapeDraft = useCallback((): boolean => {
    if (roomStamp.armed) {
      cancelStamp();
      return true;
    }
    if (wallDraft) {
      setWallDraft(null);
      return true;
    }
    return false;
  }, [roomStamp.armed, cancelStamp, wallDraft]);

  // What the wall tool's chip says.
  const wallDrawStatus = drawWallMode
    ? {
        hasAnchor: wallDraft !== null,
        ...(wallSnapResult ? { snapKind: wallSnapResult.kind } : {}),
        currentLength:
          wallDraft && wallSnapResult
            ? Math.hypot(
                wallSnapResult.point.x - wallDraft.x,
                wallSnapResult.point.z - wallDraft.z
              )
            : null,
        angle: wallDraft && wallSnapResult ? wallAngleDegrees(wallDraft, wallSnapResult.point) : null,
        aimed: wallAimRef.current !== null,
        stamp: roomStamp.armed
          ? {
              size: stampGhost ? { width: stampGhost.width, depth: stampGhost.depth } : null,
              refusal: roomStamp.ghost?.refusal ?? null,
            }
          : null,
      }
    : null;

  return {
    wallDraft,
    wallSnapResult,
    wallDrawStatus,
    handleWallClick,
    handleWallLength,
    setWallLengthOpen,
    handleFloorPointerMove,
    handleFloorPointerLeave,
    roomStamp,
    cancelStamp,
    armStamp,
    stampGhost,
    escapeDraft,
  };
}
