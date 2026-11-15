/**
 * One key table (#932): the keys the editor's window shortcuts and the
 * walker match, and the rows the shortcut sheet and the tooltips show. The
 * handlers import their key strings from here, and a test presses every key
 * on the shortcut hook to check each one that does something is listed, so
 * the sheet can't drift from the code. Shown platform-aware: ⌘ on a Mac,
 * Ctrl elsewhere (the handlers take either).
 *
 * Pure: no React, no DOM.
 */

/**
 * `event.key` values the editor's window shortcuts match
 * (hooks/use-keyboard-shortcuts). Letters are lower case: the hook lowers
 * the key first, so Caps Lock never disables one (#294).
 */
export const EDIT_KEYS = {
  undo: 'z',
  redo: 'y',
  duplicate: 'd',
  copy: 'c',
  paste: 'v',
  focus: 'f',
  rotate: 'r',
  lock: 'u',
  plan: '2',
  measurements: 'm',
  snap: 'g',
  signals: 'w',
  panels: 'p',
  earlier: '[',
  later: ']',
  floorUp: 'PageUp',
  floorDown: 'PageDown',
  deleteKey: 'Delete',
  backspace: 'Backspace',
  confirm: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  space: ' ',
} as const;

/**
 * The placement ghost's keys (hooks/use-placement-ghost), lower case: it
 * lowers `event.key` first.
 */
export const GHOST_KEYS = {
  turn: EDIT_KEYS.rotate,
  put: EDIT_KEYS.confirm.toLowerCase(),
  putToo: EDIT_KEYS.space,
  end: EDIT_KEYS.escape.toLowerCase(),
} as const;

/** `event.code` values that walk (hooks/use-walkthrough via lib/walk-input). */
export const WALK_MOVE_CODES: readonly string[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
/** Held while walking: a sprint. */
export const WALK_SPRINT_CODES: readonly string[] = ['ShiftLeft', 'ShiftRight'];
/** Sits down or stands up (#463b). */
export const WALK_INTERACT_CODE = 'KeyE';

export type KeyContext = 'edit' | 'plan' | 'walk';

/**
 * One key of a chord. `Mod` is ⌘ on a Mac and Ctrl elsewhere; `Arrows` and
 * `WASD` stand for their four keys; `click` is a pointer press.
 */
export type KeyName = string;

export interface KeyBinding {
  id: string;
  /** What it does, as the sheet says it. */
  label: string;
  /** Alternatives, each a chord: `[['Mod', 'Y'], ['Mod', 'Shift', 'Z']]`. */
  keys: ReadonlyArray<readonly KeyName[]>;
  /** Only where a Mac's keys differ beyond ⌘ for Ctrl. */
  macKeys?: ReadonlyArray<readonly KeyName[]>;
  context: KeyContext;
}

export const KEYMAP: readonly KeyBinding[] = [
  { id: 'undo', label: 'Undo', keys: [['Mod', 'Z']], context: 'edit' },
  { id: 'redo', label: 'Redo', keys: [['Mod', 'Shift', 'Z'], ['Mod', 'Y']], context: 'edit' },
  { id: 'delete', label: 'Delete item or wall', keys: [['Delete'], ['Backspace']], context: 'edit' },
  { id: 'duplicate', label: 'Duplicate', keys: [['Mod', 'D']], context: 'edit' },
  { id: 'copy', label: 'Copy', keys: [['Mod', 'C']], context: 'edit' },
  { id: 'paste', label: 'Paste', keys: [['Mod', 'V']], context: 'edit' },
  { id: 'rotate', label: 'Rotate (Shift: 15°)', keys: [['R'], ['Shift', 'R']], context: 'edit' },
  { id: 'nudge', label: 'Nudge', keys: [['Arrows'], ['Shift', 'Arrows']], context: 'edit' },
  { id: 'lock', label: 'Lock / unlock', keys: [['U']], context: 'edit' },
  { id: 'focus', label: 'Focus on item', keys: [['F']], context: 'edit' },
  { id: 'step', label: 'Next / previous item (scene focused)', keys: [['Tab'], ['Shift', 'Tab']], context: 'edit' },
  { id: 'open', label: "Open the item's editor (scene focused)", keys: [['Enter']], context: 'edit' },
  { id: 'multi', label: 'Multi-select', keys: [['Mod', 'click']], context: 'edit' },
  { id: 'escape', label: 'Close the top menu, cancel, then deselect', keys: [['Escape']], context: 'edit' },
  { id: 'single', label: 'Select one item of a group', keys: [['Alt', 'click']], context: 'edit' },
  { id: 'place-keys', label: 'Confirm a keyboard placement', keys: [['Enter']], context: 'edit' },
  { id: 'place-ghost', label: 'Put down the item on the pointer', keys: [['Enter'], ['Space']], context: 'edit' },
  { id: 'place-more', label: 'Put it down and keep placing', keys: [['Shift', 'Enter'], ['Shift', 'Space']], context: 'edit' },
  { id: 'ghost-turn', label: 'Turn the item on the pointer (Shift: the other way)', keys: [['R'], ['Shift', 'R']], context: 'edit' },
  { id: 'photo-leave', label: 'Leave photo mode', keys: [['Escape']], context: 'edit' },
  { id: 'plan', label: '2D plan / 3D view', keys: [['2']], context: 'edit' },
  { id: 'measurements', label: 'Dimension labels', keys: [['M']], context: 'edit' },
  { id: 'snap', label: 'Snap to grid', keys: [['G']], context: 'edit' },
  { id: 'signals', label: 'Signals / coverage', keys: [['W']], context: 'edit' },
  { id: 'time', label: 'Time of day', keys: [['['], [']']], context: 'edit' },
  { id: 'floor', label: 'Switch floor', keys: [['PageUp'], ['PageDown']], context: 'edit' },
  { id: 'panels', label: 'Show / hide panels', keys: [['P']], context: 'edit' },
  { id: 'wall-free', label: 'Draw free of the angle steps and grid', keys: [['Shift']], context: 'plan' },
  { id: 'wall-length', label: 'Type a wall length', keys: [['0–9']], context: 'plan' },
  { id: 'walk', label: 'Walk', keys: [['WASD'], ['Arrows']], context: 'walk' },
  { id: 'sprint', label: 'Sprint', keys: [['Shift']], context: 'walk' },
  { id: 'sit', label: 'Sit down / stand up', keys: [['E']], context: 'walk' },
  { id: 'leave-walk', label: 'Free the mouse, again to leave', keys: [['Escape']], context: 'walk' },
];

export const KEY_CONTEXT_TITLES: Readonly<Record<KeyContext, string>> = {
  edit: 'Editing',
  plan: 'Drawing walls',
  walk: 'Walking through',
};

/** Whether the platform names Apple's keys (⌘, ⇧). */
export function isApplePlatform(platform: string | undefined, userAgent = ''): boolean {
  const name = platform ?? '';
  return /Mac|iPhone|iPad|iPod/i.test(name) || (name === '' && /Macintosh|iPhone|iPad/i.test(userAgent));
}

const KEY_LABELS: Readonly<Record<string, { mac: string; other: string }>> = {
  Mod: { mac: '⌘', other: 'Ctrl' },
  Shift: { mac: '⇧', other: 'Shift' },
  Alt: { mac: '⌥', other: 'Alt' },
  Delete: { mac: 'Del', other: 'Del' },
  Backspace: { mac: '⌫', other: 'Backspace' },
  Escape: { mac: 'Esc', other: 'Esc' },
  PageUp: { mac: 'PgUp', other: 'PgUp' },
  PageDown: { mac: 'PgDn', other: 'PgDn' },
  Enter: { mac: 'Return', other: 'Enter' },
  Arrows: { mac: 'Arrows', other: 'Arrows' },
};

const MODIFIERS: ReadonlySet<string> = new Set(['Mod', 'Shift', 'Alt']);

function keyLabel(key: KeyName, mac: boolean): string {
  const label = Object.hasOwn(KEY_LABELS, key) ? KEY_LABELS[key] : undefined;
  return label ? (mac ? label.mac : label.other) : key;
}

/** Apple writes modifiers in this order: ⌥ ⇧ ⌘ (⌃ first, unused here). */
const APPLE_MODIFIER_ORDER: readonly string[] = ['Alt', 'Shift', 'Mod'];

/**
 * A chord as the platform writes it: "Ctrl+Shift+Z" elsewhere; on a Mac the
 * modifiers in Apple's order, run together, then the key: "⇧⌘Z" (a word
 * keeps a "+": "⌘+click", "⇧+Tab").
 */
export function formatChord(chord: readonly KeyName[], mac: boolean): string {
  if (!mac) return chord.map((key) => keyLabel(key, false)).join('+');
  const modifiers = APPLE_MODIFIER_ORDER.filter((key) => chord.includes(key));
  const keys = chord.filter((key) => !MODIFIERS.has(key)).map((key) => keyLabel(key, true));
  const symbols = modifiers.map((key) => keyLabel(key, true)).join('');
  const rest = keys.join('+');
  if (symbols === '') return rest;
  if (rest === '') return symbols;
  return rest.length === 1 ? `${symbols}${rest}` : `${symbols}+${rest}`;
}

/** All of a binding's chords, " / " between them. */
export function formatBinding(binding: KeyBinding, mac: boolean): string {
  const chords = (mac ? binding.macKeys : undefined) ?? binding.keys;
  return chords.map((chord) => formatChord(chord, mac)).join(' / ');
}

export function keyBinding(id: string): KeyBinding | undefined {
  return KEYMAP.find((binding) => binding.id === id);
}

/** "Snap to grid (G)": a tooltip naming the key, from the table. */
export function withShortcut(text: string, id: string, mac: boolean): string {
  const binding = keyBinding(id);
  return binding ? `${text} (${formatBinding(binding, mac)})` : text;
}
