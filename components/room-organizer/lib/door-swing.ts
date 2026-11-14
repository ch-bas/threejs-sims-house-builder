/**
 * How a door swings open in EXPLORE (#605): pure maths, no Three.js.
 *
 * A door opens as someone walks up to it and shuts again behind them. Its
 * openness runs from 0 (shut, as the plan, the exports and DESIGN show it)
 * to 1 (square to the wall) at a steady rate, eased into an angle. However
 * fast the walker comes, the leaf is never less open than their distance
 * asks (`requiredOpenness`): by the doorway it stands fully open, so the
 * walk collider's gap is always a real one. It swings away from the walker,
 * on the side chosen as it starts to open, and keeps that side until shut.
 */

/** The pivot group that carries a door's leaf and handle (three/builders). */
export const DOOR_LEAF_NAME = 'door-leaf';

/** A walker this close to a door's centre (m, in plan) opens it. */
export const DOOR_SENSE_RADIUS = 1.8;
/** This close the leaf is fully open, whatever the frame time. */
export const DOOR_CLEAR_RADIUS = 0.9;
/** A full swing, shut to open or back, takes this long (s). */
export const DOOR_SWING_SECONDS = 0.45;
/** Fully open: square to the wall, as the plan's swing arc draws it. */
export const DOOR_OPEN_ANGLE = Math.PI / 2;

export interface DoorSwingState {
  /** 0 shut … 1 fully open. */
  open: number;
  /** The side of the wall the leaf swings to: +1 the door's local +Z (into the room), −1 the other. */
  side: 1 | -1;
}

export const DOOR_SHUT: DoorSwingState = Object.freeze({ open: 0, side: 1 });

/** The least the door may be open with a walker `distance` away: 0 out of reach, 1 at the doorway. */
export function requiredOpenness(distance: number): number {
  if (!(distance < DOOR_SENSE_RADIUS)) return 0;
  if (distance <= DOOR_CLEAR_RADIUS) return 1;
  return (DOOR_SENSE_RADIUS - distance) / (DOOR_SENSE_RADIUS - DOOR_CLEAR_RADIUS);
}

/**
 * One frame of a door's swing. `distance` is the nearest walker's distance
 * from the door's centre in plan (Infinity for none), `localZ` where that
 * walker stands across the wall (the door's local Z: + into the room), and
 * `seconds` the frame time. Returns `state` itself when nothing changed.
 */
export function stepDoorSwing(
  state: DoorSwingState,
  distance: number,
  localZ: number,
  seconds: number,
  reducedMotion = false
): DoorSwingState {
  const target = distance < DOOR_SENSE_RADIUS ? 1 : 0;
  const rate = Math.max(0, seconds) / DOOR_SWING_SECONDS;
  let open = reducedMotion
    ? target
    : target > state.open
      ? Math.min(target, state.open + rate)
      : Math.max(target, state.open - rate);
  open = Math.max(open, requiredOpenness(distance));
  // The side is chosen as the door starts to open: away from the walker.
  const side: 1 | -1 = state.open === 0 && open > 0 ? (localZ > 0 ? -1 : 1) : state.side;
  if (open === state.open && side === state.side) return state;
  return { open, side };
}

/** Smoothstep: the leaf starts and stops gently. */
function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * The pivot's `rotation.y` for a swing state. The leaf runs from its hinge
 * along local +X, which a turn of θ about Y carries to (cos θ, −sin θ), so
 * swinging to local +Z is a negative turn.
 */
export function doorLeafAngle(state: DoorSwingState): number {
  if (state.open <= 0) return 0;
  return -state.side * ease(state.open) * DOOR_OPEN_ANGLE;
}
