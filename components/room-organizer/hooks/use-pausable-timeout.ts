import { useEffect, useRef } from 'react';
import { useEvent } from './use-event';

/**
 * Calls `onDone` once `key` has been `running` for `durationMs` in total.
 * Pausing keeps what is left, so a toast interrupted by another resumes
 * instead of starting over; a new key starts a fresh countdown. A null key
 * or duration never fires (a notice that stays until dismissed).
 */
export function usePausableTimeout(
  key: string | number | null,
  running: boolean,
  durationMs: number | null,
  onDone: () => void
): void {
  const left = useRef<{ key: string | number; remaining: number } | null>(null);
  const done = useEvent(onDone);
  useEffect(() => {
    if (key === null || durationMs === null || !running) return undefined;
    if (left.current?.key !== key) left.current = { key, remaining: durationMs };
    const entry = left.current;
    const started = Date.now();
    const timer = window.setTimeout(() => {
      entry.remaining = 0;
      done();
    }, entry.remaining);
    return () => {
      window.clearTimeout(timer);
      entry.remaining = Math.max(0, entry.remaining - (Date.now() - started));
    };
  }, [key, running, durationMs, done]);
}
