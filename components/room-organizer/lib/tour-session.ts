import { isShareHash, isShareHashWithinBudget } from './share';

/**
 * The shared-link tour (#722). A `#layout=` hash opens the house read-only:
 * EXPLORE's gating, a slim banner, no welcome and no autosave, until the
 * visitor keeps a copy or goes back to their own house.
 *
 * - `touring`: the shared house is on screen and the visitor's save is untouched.
 * - `kept`: they kept a copy; it is their house now, saved as usual. The
 *   welcome stays away for the rest of the page, as it would offer to
 *   replace the house just kept.
 * - `none`: an ordinary session, also after "Build your own" or a link that
 *   failed to open.
 *
 * Page state, not house state: it lives here rather than in the layout or
 * the view store, so the first render of the editor already knows it.
 */
export type TourPhase = 'none' | 'touring' | 'kept';

/** The phase a page opens in, from its location hash. */
export function tourPhaseForHash(hash: string): TourPhase {
  // A hash over the budget is refused before decoding (#332): no tour.
  return isShareHash(hash) && isShareHashWithinBudget(hash) ? 'touring' : 'none';
}

let phase: TourPhase | null = null;
const listeners = new Set<() => void>();

/** The page's tour phase, read from the hash on first use. */
export function tourPhase(): TourPhase {
  if (phase === null) phase = tourPhaseForHash(typeof window === 'undefined' ? '' : window.location.hash);
  return phase;
}

/** Whether the shared house is being toured, read-only and unsaved. */
export function isTourSession(): boolean {
  return tourPhase() === 'touring';
}

export function setTourPhase(next: TourPhase): void {
  if (tourPhase() === next) return;
  phase = next;
  for (const listener of [...listeners]) listener();
}

/** Returns the unsubscribe function. */
export function subscribeTourPhase(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: forget the phase, so the next read takes the hash again. */
export function resetTourPhaseForTests(): void {
  phase = null;
}
