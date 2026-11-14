/**
 * Photo mode (#626): the HUD steps aside so the player frames a shot of
 * the 3D scene, and a button saves it as a PNG, drawn at twice the screen's
 * resolution. No React and no Three.js here: a module-level switch that the
 * View options menu flips and the editor follows (like the notices,
 * lib/editor-notices.ts), and the capture's size.
 */

import { exportFileName } from './plan-export/download';

/** The longest edge a photo is drawn at (px), on a desktop or a tablet. */
export const PHOTO_MAX_EDGE = 4096;
/** On a phone: a 4096 px frame with its multisampled buffers is too much memory. */
export const PHOTO_MAX_EDGE_PHONE = 3072;
/** A photo is drawn at this many times the scene's own resolution. */
export const PHOTO_SCALE = 2;

/**
 * The renderer's pixel ratio for a photo of a `cssWidth` × `cssHeight`
 * canvas drawn at `screenRatio` on screen: twice that, but with its longer
 * edge no more than `maxEdge` pixels.
 */
export function photoPixelRatio(cssWidth: number, cssHeight: number, screenRatio: number, maxEdge: number): number {
  const longest = Math.max(cssWidth, cssHeight);
  const wanted = Math.max(screenRatio, 0) * PHOTO_SCALE;
  if (!(longest > 0)) return wanted;
  return Math.min(wanted, maxEdge / longest);
}

/** `<house>-photo.png`, through the one naming rule for downloads. */
export function photoFileName(houseName: string): string {
  return exportFileName(houseName, 'png', 'photo');
}

/** The walk's own keys (lib/walk-input): they move the camera and edit nothing. */
const WALK_CODES: ReadonlySet<string> = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight',
]);

export type PhotoKey = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>;

export interface PhotoKeyTarget {
  /** Focus is inside the shutter bar. */
  inBar: boolean;
  /** Focus is on one of the shutter's buttons. */
  onBarButton: boolean;
  /** The first-person walk is on. */
  walking: boolean;
}

/**
 * Whether a key may reach the page in photo mode: the shutter's own Tab,
 * Enter and Space, and the walk's keys while walking. Everything else
 * (undo, the view keys, paste, the time keys…) would act on a house whose
 * HUD is hidden, so it stops. Escape, which leaves, is the caller's.
 */
export function photoKeyPasses(event: PhotoKey, target: PhotoKeyTarget): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (target.inBar && event.key === 'Tab') return true;
  if (target.onBarButton && (event.key === 'Enter' || event.key === ' ')) return true;
  return target.walking && WALK_CODES.has(event.code);
}

/** What photo mode hands focus back to as it ends: the control that opened it. */
export interface FocusReturn {
  focus(): void;
  readonly isConnected: boolean;
}

type Listener = (active: boolean) => void;

let active = false;
let returnFocus: FocusReturn | null = null;
const listeners = new Set<Listener>();

function set(next: boolean): void {
  if (next === active) return;
  active = next;
  for (const listener of listeners) listener(active);
}

/** Whether photo mode is on. */
export function isPhotoMode(): boolean {
  return active;
}

/**
 * Turn photo mode on: the editor hides its HUD and shows the shutter.
 * `opener` gets focus back when it ends.
 */
export function enterPhotoMode(opener: FocusReturn | null = null): void {
  if (active) return;
  returnFocus = opener;
  set(true);
}

/** The control to hand focus back to, once: cleared as it is read. */
export function takePhotoFocusReturn(): FocusReturn | null {
  const opener = returnFocus;
  returnFocus = null;
  return opener;
}

/** Turn photo mode off. */
export function leavePhotoMode(): void {
  set(false);
}

/** Follow photo mode; returns the unsubscribe. */
export function subscribePhotoMode(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
