/**
 * In-app replacements for the native `alert` / `prompt` dialogs (#374).
 *
 * Hooks and panels that report an outcome (an export failed, a share link
 * was copied) or ask for a name (a zone just drawn on the plan) publish here;
 * one host component renders each channel. Plain module-level channels keep
 * the callers free of context plumbing — several of them are hooks outside
 * any provider, or effects that run long after the click.
 */

export type NoticeTone = 'info' | 'success' | 'error';

export interface Notice {
  id: number;
  message: string;
  tone: NoticeTone;
  /**
   * Text the user still has to copy by hand — the share link when the
   * clipboard refused it. A notice that carries one stays until dismissed.
   */
  copyText?: string;
  /** A button on the notice, such as "Undo" after a removal (#651). */
  action?: NoticeAction;
  /** A single-slot host keeps only the newest notice of a slot (#704). */
  slot?: string;
}

/**
 * The one button a notice may carry. `run` is called once, on the click,
 * and the notice then closes. It must check that it still applies: the
 * notice can outlive the state it was raised for.
 */
export interface NoticeAction {
  label: string;
  run(): void;
}

export interface NoticeOptions {
  copyText?: string;
  action?: NoticeAction;
  slot?: string;
}

type Listener<T> = (value: T) => void;

export interface Channel<T> {
  emit(value: T): void;
  /** Returns the unsubscribe function. */
  subscribe(listener: Listener<T>): () => void;
}

export function createChannel<T>(): Channel<T> {
  const listeners = new Set<Listener<T>>();
  return {
    emit(value) {
      for (const listener of [...listeners]) listener(value);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const notices = createChannel<Notice>();
let nextNoticeId = 1;

/** Show a non-blocking status message in the editor. */
export function notify(message: string, tone: NoticeTone = 'info', options: NoticeOptions = {}): Notice {
  const notice: Notice = {
    id: nextNoticeId++,
    message,
    tone,
    ...(options.copyText !== undefined ? { copyText: options.copyText } : {}),
    ...(options.action !== undefined ? { action: options.action } : {}),
    ...(options.slot !== undefined ? { slot: options.slot } : {}),
  };
  notices.emit(notice);
  return notice;
}

export function subscribeNotices(listener: Listener<Notice>): () => void {
  return notices.subscribe(listener);
}

/**
 * How long a notice stays up; errors, copy-by-hand links and notices with a
 * button linger. The host also pauses the countdown while the pointer or the
 * keyboard focus is on a notice with a button, so it never closes under the
 * user's hand.
 */
export function noticeDuration(notice: Notice): number | null {
  if (notice.copyText !== undefined) return null;
  return notice.tone === 'error' || notice.action !== undefined ? 7000 : 4000;
}

/** Plays a sound cue; the editor's `playCue`, which honours the mute switch. */
export type RefusedCue = (cue: 'refused') => void;

/**
 * A refused edit (#588, #642): the `refused` cue and an error notice that
 * says why. Every refusal a click can meet goes through here, so none is
 * silent and none plays its cue twice.
 */
export function notifyRefused(message: string, playCue: RefusedCue): Notice {
  playCue('refused');
  return notify(message, 'error');
}

/** How long a refusal's notice is up (`noticeDuration`): a repeat inside it stacks a copy. */
const REFUSAL_SHOWN_MS = 7000;

let lastRefusal: { message: string; at: number } | null = null;

/**
 * `notifyRefused` for what can repeat, a held key or a run of tries (#635):
 * every try gets the cue, and no copy of a notice still on screen is raised.
 */
export function notifyRefusedOnce(message: string, playCue: RefusedCue, now: number = performance.now()): void {
  if (lastRefusal?.message === message && now - lastRefusal.at < REFUSAL_SHOWN_MS) {
    playCue('refused');
    return;
  }
  lastRefusal = { message, at: now };
  notifyRefused(message, playCue);
}

/** How to free a locked item, by input: a phone has no U key (#635). */
function unlockHint(touch: boolean): string {
  return touch ? 'Tap Unlock' : 'Press U or Unlock';
}

/** The line under a locked item's actions: why Rotate and Centre are off. */
export function lockedNote(touch: boolean): string {
  return `Locked in place. ${unlockHint(touch)} to move or turn it.`;
}

/** The notice when a key or drag meets a locked item, or `count` of them (#635). */
export function lockedMessage(subject: string | number, touch: boolean): string {
  const who = typeof subject === 'number' ? `These ${subject} items are` : `${subject} is`;
  return `${who} locked. ${unlockHint(touch)} to move or turn ${typeof subject === 'number' ? 'them' : 'it'}.`;
}

/** What a removal toast says: the item's name, or how many went. */
export function removedMessage(names: readonly string[], from?: string): string {
  const what = names.length === 1 ? (names[0] ?? 'item') : `${names.length} items`;
  return from === undefined ? `Removed ${what}` : `Removed ${what} from ${from}`;
}

/** Names of the items in `before` that `after` no longer holds. */
export function removedNames(
  before: readonly { id: string; name: string }[],
  after: readonly { id: string }[]
): string[] {
  const kept = new Set(after.map((item) => item.id));
  return before.filter((item) => !kept.has(item.id)).map((item) => item.name);
}

/** Said when a notice's Undo no longer applies: the house moved on. */
export const UNDO_STALE_MESSAGE = 'The house has changed since. Use Undo in the toolbar (Ctrl+Z) to step back.';

/** Each Undo notice makes the one before it stale (#704). */
const UNDO_NOTICE_SLOT = 'undo';

/**
 * "Removed Sofa · Undo" (#651): an info notice whose button undoes the edit
 * that raised it. `current` reads the state the edit left; the button only
 * undoes while that state is still the one on screen, so it can never undo
 * a later, unrelated edit. Otherwise it points to the toolbar's Undo.
 */
export function notifyWithUndo(message: string, history: { current(): unknown; undo(): void }): Notice {
  const after = history.current();
  return notify(message, 'info', {
    slot: UNDO_NOTICE_SLOT,
    action: {
      label: 'Undo',
      run() {
        if (Object.is(history.current(), after)) history.undo();
        else notify(UNDO_STALE_MESSAGE, 'info');
      },
    },
  });
}

const zoneNameRequests = createChannel<string>();

/**
 * A zone was just drawn on the plan under a default name: ask for a better
 * one inline, without blocking the editor.
 */
export function requestZoneName(zoneId: string): void {
  zoneNameRequests.emit(zoneId);
}

export function subscribeZoneNameRequests(listener: Listener<string>): () => void {
  return zoneNameRequests.subscribe(listener);
}
