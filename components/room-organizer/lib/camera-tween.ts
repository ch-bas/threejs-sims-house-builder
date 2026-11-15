/**
 * Eased camera moves (#930): a preset, Fit or Focus glides from the current
 * pose to the new one instead of cutting. The orbit camera swings along an
 * arc around its (moving) target, so a preset a full side away goes round
 * the house rather than through it. Reduced motion keeps the cut.
 *
 * Pure: no React, no three.js. The camera hook samples a tween once per
 * animation frame and puts the exact end pose on the camera itself.
 */

export type TweenVec3 = readonly [number, number, number];

export interface CameraPose {
  position: TweenVec3;
  target: TweenVec3;
}

/** How long a camera move takes. */
export const CAMERA_TWEEN_MS = 350;
/** Closer than this (metres), a move isn't worth easing. */
const SAME_POSE_EPSILON = 1e-3;
/** An offset shorter than this has no usable direction: fall back to a line. */
const MIN_RADIUS = 1e-6;

/** Ease-out cubic: quick to leave, gentle to arrive. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const rest = 1 - clamped;
  return 1 - rest * rest * rest;
}

/** The move's duration: none with reduced motion or when the camera is already there. */
export function cameraTweenDuration(from: CameraPose, to: CameraPose, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return samePose(from, to) ? 0 : CAMERA_TWEEN_MS;
}

export function samePose(a: CameraPose, b: CameraPose): boolean {
  return near(a.position, b.position) && near(a.target, b.target);
}

function near(a: TweenVec3, b: TweenVec3): boolean {
  return Math.abs(a[0] - b[0]) < SAME_POSE_EPSILON && Math.abs(a[1] - b[1]) < SAME_POSE_EPSILON && Math.abs(a[2] - b[2]) < SAME_POSE_EPSILON;
}

interface Spherical {
  radius: number;
  /** From +Y down, 0..π (three.js convention). */
  phi: number;
  /** Around +Y, from +Z towards +X (three.js convention). */
  theta: number;
}

function toSpherical(x: number, y: number, z: number): Spherical {
  const radius = Math.hypot(x, y, z);
  if (radius < MIN_RADIUS) return { radius: 0, phi: 0, theta: 0 };
  return { radius, phi: Math.acos(Math.min(1, Math.max(-1, y / radius))), theta: Math.atan2(x, z) };
}

/** The shortest signed turn from `a` to `b`, in (-π, π]. */
function shortestTurn(a: number, b: number): number {
  let turn = (b - a) % (2 * Math.PI);
  if (turn > Math.PI) turn -= 2 * Math.PI;
  if (turn <= -Math.PI) turn += 2 * Math.PI;
  return turn;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The pose `t` (0..1, already eased) of the way from `from` to `to`. The
 * target moves in a straight line; the camera keeps its offset from it on
 * a sphere-like path: the distance changes geometrically (a zoom reads as
 * steady), the tilt linearly and the heading the short way round. At t = 1
 * the result is `to` exactly.
 */
export function interpolatePose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const target: TweenVec3 = [lerp(from.target[0], to.target[0], t), lerp(from.target[1], to.target[1], t), lerp(from.target[2], to.target[2], t)];
  const a = toSpherical(from.position[0] - from.target[0], from.position[1] - from.target[1], from.position[2] - from.target[2]);
  const b = toSpherical(to.position[0] - to.target[0], to.position[1] - to.target[1], to.position[2] - to.target[2]);
  if (a.radius < MIN_RADIUS || b.radius < MIN_RADIUS) {
    return {
      position: [lerp(from.position[0], to.position[0], t), lerp(from.position[1], to.position[1], t), lerp(from.position[2], to.position[2], t)],
      target,
    };
  }
  const radius = a.radius * Math.pow(b.radius / a.radius, t);
  const phi = lerp(a.phi, b.phi, t);
  const theta = a.theta + shortestTurn(a.theta, b.theta) * t;
  const sinPhi = Math.sin(phi);
  return {
    position: [target[0] + radius * sinPhi * Math.sin(theta), target[1] + radius * Math.cos(phi), target[2] + radius * sinPhi * Math.cos(theta)],
    target,
  };
}

export interface CameraTweenSample {
  pose: CameraPose;
  done: boolean;
}

export interface CameraTween {
  /** The pose at `now` (ms, the clock `start` came from). */
  sample(now: number): CameraTweenSample;
}

/** A move from `from` to `to`, starting at `start` (ms) and lasting `durationMs`. */
export function createCameraTween(from: CameraPose, to: CameraPose, start: number, durationMs: number): CameraTween {
  return {
    sample(now) {
      if (durationMs <= 0) return { pose: to, done: true };
      const progress = (now - start) / durationMs;
      if (progress >= 1) return { pose: to, done: true };
      return { pose: interpolatePose(from, to, easeOutCubic(progress)), done: false };
    },
  };
}
