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
  /** Destructive: the confirming button is drawn as a warning. */
  danger?: boolean;
}

export interface ConfirmRequest {
  id: number;
  title: string;
  body: string | null;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
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
