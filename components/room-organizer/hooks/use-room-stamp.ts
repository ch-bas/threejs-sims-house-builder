import { useCallback, useMemo, useRef, useState } from 'react';
import { planRoomStamp, stampPlacement, type RoomStampSpec, type StampContext, type StampPlan } from '../lib/room-stamp';
import type { Vec2 } from '../lib/types';
import type { HeldGesture } from '../three/drag-handlers';

export interface UseRoomStampParams {
  context: StampContext;
  /** The pointer on the floor, from the wall tool. */
  pointer: Vec2 | null;
  onPointer(x: number, z: number): void;
  /** Add the walls, as one dispatch. */
  onPlace(plan: StampPlan): void;
  onRefused(message: string): void;
}

export interface UseRoomStampResult {
  armed: boolean;
  /** Where a drop would land now; null with no pointer on the floor. */
  ghost: StampPlan | null;
  arm(spec: RoomStampSpec): void;
  cancel(): void;
  /** Press and release on the plan, which reports them one at a time. */
  press(x: number, z: number): void;
  release(x: number, z: number): void;
  cancelPress(): void;
  /** The same press in 3D: null with no stamp armed. */
  grabFloor(x: number, z: number): HeldGesture | null;
}

/**
 * The room stamp in hand (#724): a ghost follows the pointer, a click drops it
 * and a drag sizes it. The ghost is a pure function of the pointer, so the
 * house state stays untouched until the drop's one dispatch.
 */
export function useRoomStamp(params: UseRoomStampParams): UseRoomStampResult {
  const { context, pointer } = params;
  const [spec, setSpec] = useState<RoomStampSpec | null>(null);
  const [pressedAt, setPressedAt] = useState<Vec2 | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const specRef = useRef(spec);
  specRef.current = spec;
  const pressRef = useRef(pressedAt);
  pressRef.current = pressedAt;

  const { existingWalls, roomWidth, roomDepth, cutout, porch, hiddenWalls } = context;
  const ghost = useMemo(() => {
    if (!spec || !pointer) return null;
    const fit = { existingWalls, roomWidth, roomDepth, cutout, porch, hiddenWalls };
    return planRoomStamp(spec, stampPlacement(spec, pressedAt, pointer, fit), fit, 'stamp-ghost');
  }, [spec, pointer, pressedAt, existingWalls, roomWidth, roomDepth, cutout, porch, hiddenWalls]);

  const cancel = useCallback(() => {
    setSpec(null);
    setPressedAt(null);
  }, []);

  const cancelPress = useCallback(() => setPressedAt(null), []);

  const release = useCallback((x: number, z: number) => {
    const held = specRef.current;
    const from = pressRef.current;
    setPressedAt(null);
    if (!held) return;
    const p = paramsRef.current;
    // Random suffix so two stamps in the same millisecond can't collide.
    const seed = `stamp-${held.shape}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const plan = planRoomStamp(held, stampPlacement(held, from, { x, z }, p.context), p.context, seed);
    if (plan.refusal !== null) {
      p.onRefused(plan.refusal);
      return;
    }
    p.onPlace(plan);
    setSpec(null);
  }, []);

  const press = useCallback((x: number, z: number) => {
    if (specRef.current) setPressedAt({ x, z });
  }, []);

  const grabFloor = useCallback((x: number, z: number): HeldGesture | null => {
    if (!specRef.current) return null;
    setPressedAt({ x, z });
    paramsRef.current.onPointer(x, z);
    let last = { x, z };
    return {
      move(nextX, nextZ) {
        last = { x: nextX, z: nextZ };
        paramsRef.current.onPointer(nextX, nextZ);
      },
      end(commit, clicked) {
        if (commit || clicked) release(last.x, last.z);
        else setPressedAt(null);
      },
    };
  }, [release]);

  return { armed: spec !== null, ghost, arm: setSpec, cancel, press, release, cancelPress, grabFloor };
}
