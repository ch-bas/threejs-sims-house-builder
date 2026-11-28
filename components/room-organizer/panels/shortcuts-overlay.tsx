'use client';

import { Suspense, lazy, useEffect, useSyncExternalStore } from 'react';
import { closeShortcutsOverlay, isShortcutsOverlayOpen, subscribeShortcutsOverlay } from '../lib/shortcut-overlay';

// The dialog itself loads on the first `?`: most sessions never ask.
const ShortcutsDialog = lazy(() => import('./shortcuts-dialog').then((module) => ({ default: module.ShortcutsDialog })));

/**
 * The `?` overlay's host (#932): the key table's shortcuts in a modal,
 * mounted once by the orchestrator under the confirm dialog. Closed when
 * the editor goes away.
 */
export function ShortcutsOverlayHost(): JSX.Element | null {
  const shown = useSyncExternalStore(subscribeShortcutsOverlay, isShortcutsOverlayOpen, () => false);
  useEffect(() => closeShortcutsOverlay, []);
  if (!shown) return null;
  return (
    <Suspense fallback={null}>
      <ShortcutsDialog onClose={closeShortcutsOverlay} />
    </Suspense>
  );
}
