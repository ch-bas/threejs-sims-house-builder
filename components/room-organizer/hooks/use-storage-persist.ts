import { useEffect, useRef } from 'react';
import {
  persistPrompts,
  queryPersistence,
  readStorageCare,
  recordPersistAnswer,
  requestPersistence,
  shouldAskToPersist,
} from '../lib/backup-reminder';
import { isLoadedLayout } from './use-achievements';
import type { RoomLayout } from '../lib/types';

/** The browser's StorageManager, or undefined where there is none. */
export function browserStorageManager(): StorageManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

/**
 * Asks the browser to keep the site's storage after the player's first edit
 * of a session (#928): not on a whole-house load (`markLayoutLoaded`), so
 * opening a share link or a template asks nothing. At most once a session;
 * `shouldAskToPersist` decides whether a no is asked again.
 */
export function useAskToKeepStorage(layout: RoomLayout): void {
  const lastRef = useRef<RoomLayout | null>(null);
  const askedRef = useRef(false);
  useEffect(() => {
    const before = lastRef.current;
    if (before === layout) return;
    lastRef.current = layout;
    if (before === null || isLoadedLayout(layout) || askedRef.current) return;
    askedRef.current = true;
    const now = Date.now();
    const prompts = typeof navigator !== 'undefined' && persistPrompts(navigator.userAgent);
    if (!shouldAskToPersist(readStorageCare(), { now, prompts })) return;
    const manager = browserStorageManager();
    void (async () => {
      // Granted already (installed app, an earlier yes): record it, no prompt.
      if ((await queryPersistence(manager)) === true) {
        recordPersistAnswer('granted', now);
        return;
      }
      const answer = await requestPersistence(manager);
      if (answer) recordPersistAnswer(answer, Date.now());
    })();
  }, [layout]);
}
