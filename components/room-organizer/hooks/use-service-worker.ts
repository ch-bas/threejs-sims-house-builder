import { useEffect, useRef } from 'react';
import { syncBrowserServiceWorker } from '../lib/service-worker';

/** After the first frame, so the worker never competes with the engine download (#731). */
const AFTER_FIRST_FRAME_MS = 1_000;

/**
 * Registers the offline service worker once the first frame is on screen
 * (#933): the precache downloads every chunk, which must not slow the start.
 * Once per page; lib/service-worker.ts decides whether to register or remove.
 */
export function useServiceWorker(firstFrameDrawn: boolean): void {
  const done = useRef(false);
  useEffect(() => {
    if (!firstFrameDrawn || done.current) return undefined;
    const timer = window.setTimeout(() => {
      done.current = true;
      void syncBrowserServiceWorker();
    }, AFTER_FIRST_FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [firstFrameDrawn]);
}
