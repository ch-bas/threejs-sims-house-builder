/**
 * Keyboard and frame-time rules for the first-person walker (#421). Pure, so
 * the walkthrough hook's RAF loop stays thin and the rules are testable.
 */

export const WALK_MOVEMENT_KEYS: ReadonlySet<string> = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
]);

/**
 * The longest frame the walker integrates, in seconds. Anything up to it
 * covers its full distance, so walking speed holds down to 10 fps; a longer
 * gap (a backgrounded tab, a GC pause) is cut short instead of teleporting.
 * The collision resolve substeps by distance, so a long step can't tunnel.
 */
export const WALK_MAX_FRAME_SECONDS = 0.1;

/** Seconds to integrate for a frame that took `elapsedMs`. */
export function walkFrameSeconds(elapsedMs: number): number {
  return Math.min(WALK_MAX_FRAME_SECONDS, Math.max(0, elapsedMs / 1000));
}

interface KeyChord {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Whether a keydown starts walking. A Ctrl/Cmd/Alt chord is a shortcut, not a
 * step: Ctrl+D duplicates, and macOS never sends the keyup of a key pressed
 * while Cmd is held, so the walker would march on. Shift stays: it sprints.
 */
export function startsWalking(event: KeyChord): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return WALK_MOVEMENT_KEYS.has(event.code);
}
