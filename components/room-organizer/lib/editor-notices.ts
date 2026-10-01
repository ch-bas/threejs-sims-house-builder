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
}

export interface NoticeOptions {
  copyText?: string;
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
  };
  notices.emit(notice);
  return notice;
}

export function subscribeNotices(listener: Listener<Notice>): () => void {
  return notices.subscribe(listener);
}

/** How long a notice stays up; errors and copy-by-hand links linger. */
export function noticeDuration(notice: Notice): number | null {
  if (notice.copyText !== undefined) return null;
  return notice.tone === 'error' ? 7000 : 4000;
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
