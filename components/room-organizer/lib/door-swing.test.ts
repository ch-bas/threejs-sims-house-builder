import { describe, expect, it } from 'vitest';
import {
  DOOR_CLEAR_RADIUS,
  DOOR_OPEN_ANGLE,
  DOOR_SENSE_RADIUS,
  DOOR_SHUT,
  DOOR_SWING_SECONDS,
  doorLeafAngle,
  requiredOpenness,
  stepDoorSwing,
  type DoorSwingState,
} from './door-swing';

const FRAME = 1 / 60;

/** Walk straight at the door along its local Z, from `fromZ` to `toZ`, at `speed` m/s. */
function walkThrough(fromZ: number, toZ: number, speed: number): Array<{ z: number; state: DoorSwingState }> {
  const frames: Array<{ z: number; state: DoorSwingState }> = [];
  let state = DOOR_SHUT;
  const dir = Math.sign(toZ - fromZ);
  for (let z = fromZ; dir * (toZ - z) > 0; z += dir * speed * FRAME) {
    state = stepDoorSwing(state, Math.abs(z), z, FRAME);
    frames.push({ z, state });
  }
  return frames;
}

describe('door swing (#605)', () => {
  it('stays shut, as the same object, with nobody near', () => {
    expect(stepDoorSwing(DOOR_SHUT, Infinity, 0, FRAME)).toBe(DOOR_SHUT);
    expect(stepDoorSwing(DOOR_SHUT, DOOR_SENSE_RADIUS + 0.01, 1, FRAME)).toBe(DOOR_SHUT);
  });

  it('opens at a steady rate within reach and shuts again once the walker is gone', () => {
    let state = DOOR_SHUT;
    const half = Math.round(DOOR_SWING_SECONDS / 2 / FRAME);
    for (let i = 0; i < half; i++) state = stepDoorSwing(state, DOOR_SENSE_RADIUS - 0.01, 1.7, FRAME);
    expect(state.open).toBeGreaterThan(0.4);
    expect(state.open).toBeLessThan(0.6);
    for (let i = 0; i < half * 2; i++) state = stepDoorSwing(state, 1.7, 1.7, FRAME);
    expect(state.open).toBe(1);
    for (let i = 0; i < half * 2 + 1; i++) state = stepDoorSwing(state, 5, 5, FRAME);
    expect(state.open).toBe(0);
    expect(doorLeafAngle(state)).toBe(0);
  });

  it('is fully open at the doorway, however fast the walker comes (sprint, a dropped frame)', () => {
    for (const speed of [1, 3, 6, 20]) {
      for (const { z, state } of walkThrough(3, -3, speed)) {
        expect(state.open, `speed ${speed} at z ${z.toFixed(2)}`).toBeGreaterThanOrEqual(requiredOpenness(Math.abs(z)));
        if (Math.abs(z) <= DOOR_CLEAR_RADIUS) expect(state.open).toBe(1);
      }
    }
    // One long frame right into the doorway.
    expect(stepDoorSwing(DOOR_SHUT, 0.2, 0.2, 0.5).open).toBe(1);
  });

  it('swings away from the walker, and keeps its side while open', () => {
    const fromRoom = walkThrough(3, -3, 3);
    const first = fromRoom.find((frame) => frame.state.open > 0)!;
    expect(first.z).toBeGreaterThan(0);
    expect(first.state.side).toBe(-1);
    // Through the doorway and out the other side, it never flips.
    expect(new Set(fromRoom.filter((frame) => frame.state.open > 0).map((frame) => frame.state.side))).toEqual(new Set([-1]));
    const fromOutside = walkThrough(-3, 3, 3).find((frame) => frame.state.open > 0)!;
    expect(fromOutside.state.side).toBe(1);
  });

  it('turns the leaf toward its side: square to the wall when open, eased in between', () => {
    expect(doorLeafAngle({ open: 1, side: 1 })).toBeCloseTo(-DOOR_OPEN_ANGLE);
    expect(doorLeafAngle({ open: 1, side: -1 })).toBeCloseTo(DOOR_OPEN_ANGLE);
    expect(doorLeafAngle({ open: 0.5, side: -1 })).toBeCloseTo(DOOR_OPEN_ANGLE / 2);
    // Eased: slower than linear near the ends.
    expect(doorLeafAngle({ open: 0.1, side: -1 })).toBeLessThan(0.1 * DOOR_OPEN_ANGLE);
  });

  it('jumps straight to open or shut with reduced motion', () => {
    expect(stepDoorSwing(DOOR_SHUT, 1.7, 1.7, FRAME, true).open).toBe(1);
    expect(stepDoorSwing({ open: 1, side: 1 }, 4, 4, FRAME, true).open).toBe(0);
  });
});
