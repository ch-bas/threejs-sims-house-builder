/**
 * The in-app replacement for `window.confirm` (#649).
 *
 * Native dialogs freeze the render loop and the autosave, ignore the theme
 * and look nothing like the editor. `askConfirm` queues a question instead
 * and resolves with the answer; one host (`panels/confirm-dialog.tsx`) shows
 * the oldest open question. A module-level queue, like `editor-notices`,
 * keeps callers free of context plumbing: several are hooks outside any
 * provider, or effects that run long after the click. A question asked
 * before the host mounts waits for it.
 */

export interface ConfirmOptions {
  /** The question, short: "Delete set “Reading nook”?" */
  title: string;
  /** What happens next, or what is kept. */
  body?: string;
  /** The confirming button; defaults to "OK". */
  confirmLabel?: string;
  /** The cancelling button; defaults to "Cancel". */
  cancelLabel?: string;
  /** Destructive: the confirming button is drawn as a warning, and Cancel starts focused. */
  danger?: boolean;
  /** The button that starts focused; by default Cancel when `danger`, else the confirm. */
  focus?: 'confirm' | 'cancel';
  /**
   * False when the question must be answered with a button or Escape: a
   * click beside the dialog then does nothing. Defaults to true (cancels).
   */
  backdropCancels?: boolean;
}

/**
 * How long after opening the dialog ignores Enter, its buttons and its
 * backdrop: the rest of the gesture that opened it (a held Enter, the second
 * click of a double-click) must never answer a question nobody has read.
 */
export const CONFIRM_GRACE_MS = 300;

export interface ConfirmRequest {
  id: number;
  title: string;
  body: string | null;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  focus: 'confirm' | 'cancel';
  backdropCancels: boolean;
}

interface Pending {
  request: ConfirmRequest;
  resolve(answer: boolean): void;
}

let queue: readonly Pending[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** Ask the player; resolves true on confirm, false on cancel or Escape. */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const request: ConfirmRequest = {
      id: nextId++,
      title: options.title,
      body: options.body ?? null,
      confirmLabel: options.confirmLabel ?? 'OK',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      danger: options.danger ?? false,
      focus: options.focus ?? (options.danger ? 'cancel' : 'confirm'),
      backdropCancels: options.backdropCancels ?? true,
    };
    queue = [...queue, { request, resolve }];
    emit();
  });
}

/** The question on screen: the oldest one not yet answered. */
export function currentConfirm(): ConfirmRequest | null {
  return queue[0]?.request ?? null;
}

/** Answer question `id`; a stale id (already answered) does nothing. */
export function answerConfirm(id: number, answer: boolean): void {
  const pending = queue.find((entry) => entry.request.id === id);
  if (!pending) return;
  queue = queue.filter((entry) => entry !== pending);
  emit();
  pending.resolve(answer);
}

/** For `useSyncExternalStore`; returns the unsubscribe function. */
export function subscribeConfirm(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The question asked last and not yet answered, or null. */
export function newestConfirmId(): number | null {
  return queue[queue.length - 1]?.request.id ?? null;
}

/** Whether question `id` still waits for an answer. */
export function isConfirmPending(id: number): boolean {
  return queue.some((entry) => entry.request.id === id);
}

/** True while a question waits for an answer: window key handlers stand back. */
export function confirmOpen(): boolean {
  return queue.length > 0;
}

/** Cancel every open question (tests; a torn-down editor). */
export function cancelPendingConfirms(): void {
  const pending = queue;
  if (pending.length === 0) return;
  queue = [];
  emit();
  for (const entry of pending) entry.resolve(false);
}
