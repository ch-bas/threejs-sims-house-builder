'use client';

import { useSyncExternalStore } from 'react';
import { currentAnnouncement, subscribeAnnouncements } from '../lib/announce';

const NOTHING = (): string => '';

/**
 * The editor's one polite status line (#929), rendered once by the
 * orchestrator: what `announce()` last said. Visually hidden.
 */
export function Announcer(): JSX.Element {
  const text = useSyncExternalStore(subscribeAnnouncements, () => currentAnnouncement().text, NOTHING);
  return (
    <p role="status" className="sr-only" data-announcer="">
      {text}
    </p>
  );
}
