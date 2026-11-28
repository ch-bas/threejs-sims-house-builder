import { useSyncExternalStore } from 'react';
import { settleSeenVersion } from '../lib/app-version';
import { createChannel } from '../lib/editor-notices';
import type { TourPhase } from '../lib/tour-session';

/**
 * Whether the What's new card (#931) shows in this tab: `update` once per
 * page load after an update, `asked` when Help opened it. Module-level, so
 * the orchestrator offers it, Help opens it and the Getting started card
 * (which shares its place) steps aside, without props. The card itself and
 * its lines load only once it opens.
 */
export type WhatsNewState = 'closed' | 'update' | 'asked';

let state: WhatsNewState = 'closed';
/** The version this browser had opened before this page load. */
let seenBefore: string | null = null;
let offered = false;
const changed = createChannel<void>();

function set(next: WhatsNewState): void {
  if (state === next) return;
  state = next;
  changed.emit();
}

/** An update came since the last visit: show the card, once per page load. */
export function offerWhatsNew(seen: string | null): void {
  if (offered) return;
  offered = true;
  seenBefore = seen;
  set('update');
}

/** Help → What's new. */
export function openWhatsNew(): void {
  set('asked');
}

/** Closed: shown and dismissed, or nothing to tell. Either way this version is seen. */
export function closeWhatsNew(): void {
  if (state !== 'closed') settleSeenVersion();
  set('closed');
}

/** The card is on screen: this version is seen (#931). */
export function whatsNewShown(): void {
  settleSeenVersion();
}

/** The version seen before this page load, for the card's own check. */
export function whatsNewSeenBefore(): string | null {
  return seenBefore;
}

export function whatsNewState(): WhatsNewState {
  return state;
}

export function useWhatsNewState(): WhatsNewState {
  return useSyncExternalStore(changed.subscribe, whatsNewState, () => 'closed');
}

export interface WhatsNewScene {
  state: WhatsNewState;
  tourPhase: TourPhase;
  /** The editor is up: the scene is ready and no error screen shows. */
  ready: boolean;
  exploring: boolean;
  photo: boolean;
}

/**
 * Whether the editor mounts the card now. Never in a tour; over a house
 * kept from one only when Help asked, as for Getting started; and not in
 * EXPLORE or photo mode, which it waits out (the state stays open).
 */
export function whatsNewMounts(scene: WhatsNewScene): boolean {
  if (scene.state === 'closed' || !scene.ready || scene.exploring || scene.photo) return false;
  return scene.tourPhase === 'none' || (scene.tourPhase === 'kept' && scene.state === 'asked');
}

/** Tests only: a fresh page load. */
export function resetWhatsNewForTests(): void {
  state = 'closed';
  seenBefore = null;
  offered = false;
}
