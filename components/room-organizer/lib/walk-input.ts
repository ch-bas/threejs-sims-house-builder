/**
 * Keyboard and frame-time rules for the first-person walker (#421). Pure, so
 * the walkthrough hook's RAF loop stays thin and the rules are testable.
 */

const WALK_MOVEMENT_KEYS: ReadonlySet<string> = new Set([
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
 * step: Ctrl+D duplicates. Shift stays: it sprints.
 */
export function startsWalking(event: KeyChord): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return WALK_MOVEMENT_KEYS.has(event.code);
}

/**
 * Whether a keydown is the walker's interact key: `E` sits down or stands up
 * (#463b). A held key's auto-repeat isn't a second press, and a chord is a
 * shortcut, not an interaction.
 */
export function interacts(event: KeyChord & { repeat: boolean }): boolean {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.code === 'KeyE';
}

/**
 * Whether a keydown or keyup must drop every held key. macOS never sends the
 * keyup of any key released while Cmd is down, so W held before a Cmd+Z and
 * let go during it would march the walker on. Dropping on both Cmd edges
 * costs only a re-press of a key still held.
 */
export function releasesHeldKeys(event: { key: string }): boolean {
  return event.key === 'Meta';
}

/**
 * Whether a key event's target takes typing: an input, a textarea, a select
 * or anything contentEditable (#558). The one guard every window key
 * handler uses: the walker (so on a touch walk Escape in the catalogue
 * search doesn't leave EXPLORE and a `w` typed there doesn't switch the
 * touch stick off), the editor shortcuts and the placement ghost.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (typeof element?.tagName !== 'string') return false;
  return element.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

/** A push under this share of the stick's throw is a resting thumb, not a step. */
export const STICK_DEAD_ZONE = 0.12;
/** The share of the throw that walks at full speed: the rest of the way is headroom before the sprint (#688). */
export const STICK_WALK_THROW = 0.8;
/** The sprint starts at this share of the throw, the knob at the rim (#688)… */
export const STICK_SPRINT_ON = 0.97;
/** …and holds until the thumb eases back under this one, so a thumb resting at the rim doesn't flicker. */
export const STICK_SPRINT_OFF = 0.88;

/** What the touch stick says: the walk (x right, y forward, in [−1, 1]), where its knob sits, and a sprint. */
export interface StickReading {
  x: number;
  y: number;
  knobX: number;
  knobY: number;
  sprint: boolean;
}

/**
 * The stick read from the thumb's offset from its centre, in screen pixels
 * (y down), with `reach` the knob's throw. The walk grows with the push up
 * to full speed at `STICK_WALK_THROW`; at the rim it sprints, as Shift does
 * on a keyboard, until the thumb eases back past `STICK_SPRINT_OFF`.
 * `sprinting` is the last reading's sprint.
 */
export function readStick(dx: number, dy: number, reach: number, sprinting = false): StickReading {
  const length = Math.hypot(dx, dy);
  const clamp = length > reach ? reach / length : 1;
  const knobX = dx * clamp;
  const knobY = dy * clamp;
  const push = Math.min(1, length / reach);
  if (push < STICK_DEAD_ZONE) return { x: 0, y: 0, knobX, knobY, sprint: false };
  const speed = Math.min(1, push / STICK_WALK_THROW) / push;
  const sprint = push >= (sprinting ? STICK_SPRINT_OFF : STICK_SPRINT_ON);
  return { x: (knobX / reach) * speed, y: (-knobY / reach) * speed, knobX, knobY, sprint };
}
