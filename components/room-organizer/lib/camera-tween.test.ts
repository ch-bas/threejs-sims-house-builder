import { describe, expect, it } from 'vitest';
import { CAMERA_TWEEN_MS, cameraTweenDuration, createCameraTween, easeOutCubic, interpolatePose, storeySlidePose } from './camera-tween';
import type { CameraPose } from './camera-tween';

const front: CameraPose = { position: [0, 4, 10], target: [0, 1, 0] };
const back: CameraPose = { position: [0, 4, -10], target: [0, 1, 0] };
const east: CameraPose = { position: [10, 4, 0], target: [0, 1, 0] };

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

describe('easeOutCubic', () => {
  it('runs from 0 to 1, rising all the way and slowing at the end', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    let previous = 0;
    for (let i = 1; i <= 20; i++) {
      const value = easeOutCubic(i / 20);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
    // Ease-out: more than half the way at the halfway mark.
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('clamps outside 0..1', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('interpolatePose', () => {
  it('starts at the old pose and ends exactly at the new one', () => {
    expect(interpolatePose(front, east, 0)).toBe(front);
    expect(interpolatePose(front, east, 1)).toBe(east);
  });

  it('swings round the target instead of cutting through the house', () => {
    // Front to back: a straight line passes through the target; the arc keeps its distance.
    for (let i = 1; i < 10; i++) {
      const pose = interpolatePose(front, back, i / 10);
      expect(distance(pose.position, pose.target)).toBeCloseTo(distance(front.position, front.target), 6);
    }
  });

  it('turns the short way round', () => {
    // From the front (+Z) to the east (+X) is a quarter turn through +X+Z, not three quarters.
    const mid = interpolatePose(front, east, 0.5);
    expect(mid.position[0]).toBeGreaterThan(0);
    expect(mid.position[2]).toBeGreaterThan(0);
  });

  it('never dips below the lower of the two tilts', () => {
    const low: CameraPose = { position: [8, 2, 0], target: [0, 0, 0] };
    const high: CameraPose = { position: [0, 9, -1], target: [0, 0, 0] };
    for (let i = 0; i <= 10; i++) {
      const pose = interpolatePose(low, high, i / 10);
      expect(pose.position[1]).toBeGreaterThan(0);
    }
  });

  it('zooms steadily: the distance changes by the same factor each step', () => {
    const far: CameraPose = { position: [0, 0, 16], target: [0, 0, 0] };
    const close: CameraPose = { position: [0, 0, 1], target: [0, 0, 0] };
    expect(interpolatePose(far, close, 0.5).position[2]).toBeCloseTo(4, 9);
  });

  it('moves the target in a straight line', () => {
    const from: CameraPose = { position: [5, 5, 5], target: [0, 0, 0] };
    const to: CameraPose = { position: [7, 9, 5], target: [2, 4, 0] };
    expect(interpolatePose(from, to, 0.5).target).toEqual([1, 2, 0]);
  });

  it('falls back to a line when a pose has no offset from its target', () => {
    const degenerate: CameraPose = { position: [0, 0, 0], target: [0, 0, 0] };
    const pose = interpolatePose(degenerate, east, 0.5);
    expect(pose.position[0]).toBeCloseTo(5, 9);
  });
});

describe('createCameraTween', () => {
  it('lands exactly on the end pose once the time is up', () => {
    const tween = createCameraTween(front, east, 1000, CAMERA_TWEEN_MS);
    expect(tween.sample(1000).pose.position).toEqual(front.position);
    const middle = tween.sample(1000 + CAMERA_TWEEN_MS / 2);
    expect(middle.done).toBe(false);
    const end = tween.sample(1000 + CAMERA_TWEEN_MS);
    expect(end.done).toBe(true);
    expect(end.pose).toBe(east);
    expect(tween.sample(1000 + 10 * CAMERA_TWEEN_MS).pose).toBe(east);
  });

  it('a zero duration is today’s cut', () => {
    const sample = createCameraTween(front, east, 0, 0).sample(0);
    expect(sample.done).toBe(true);
    expect(sample.pose).toBe(east);
  });
});

describe('cameraTweenDuration', () => {
  it('is zero with reduced motion or with nowhere to go', () => {
    expect(cameraTweenDuration(front, east, true)).toBe(0);
    expect(cameraTweenDuration(front, { position: [0, 4, 10.0001], target: [0, 1, 0] }, false)).toBe(0);
    expect(cameraTweenDuration(front, east, false)).toBe(CAMERA_TWEEN_MS);
  });
});

describe('storeySlidePose (floor switches)', () => {
  it('moves the target to the new storey and the camera by the same rise, as the cut did', () => {
    const end = storeySlidePose(east, 4.5);
    expect(end.target).toEqual([0, 4.5, 0]);
    expect(end.position).toEqual([10, 7.5, 0]);
    expect(storeySlidePose(end, 1)).toEqual(east);
  });

  it('glides straight up: the heading, the tilt and the distance hold all the way', () => {
    const end = storeySlidePose(front, 7);
    for (let i = 1; i < 10; i++) {
      const pose = interpolatePose(front, end, easeOutCubic(i / 10));
      expect(pose.position[0]).toBeCloseTo(0, 9);
      expect(pose.position[2]).toBeCloseTo(10, 9);
      expect(pose.position[1] - pose.target[1]).toBeCloseTo(3, 9);
    }
  });
});
