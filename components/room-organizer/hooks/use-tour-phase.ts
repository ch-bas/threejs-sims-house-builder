import { useSyncExternalStore } from 'react';
import { subscribeTourPhase, tourPhase, type TourPhase } from '../lib/tour-session';

/** The page's shared-link tour phase (#722), re-rendering when it changes. */
export function useTourPhase(): TourPhase {
  return useSyncExternalStore(subscribeTourPhase, tourPhase, () => 'none');
}
