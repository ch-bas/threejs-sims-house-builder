'use client';

import { useSyncExternalStore } from 'react';
import { isApplePlatform } from '../lib/keymap';

function subscribe(): () => void {
  return () => {};
}

function snapshot(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return isApplePlatform(nav.userAgentData?.platform || nav.platform, nav.userAgent);
}

/**
 * Whether keys are written the Mac way, ⌘ for Ctrl (#932). False on the
 * server and during hydration, so the static export's markup matches.
 */
export function useAppleKeys(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
