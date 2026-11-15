import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createChannel } from '../lib/editor-notices';
import {
  FIRST_STEPS,
  firstStepsEarned,
  loadFirstSteps,
  saveFirstSteps,
  type FirstStepId,
  type FirstStepsRecord,
} from '../lib/first-steps';
import { isLoadedLayout } from './use-achievements';
import type { RoomLayout } from '../lib/types';

/**
 * The Getting started card's state (#721): the stored record (offered or
 * dismissed, and the steps done) and whether the card shows in this tab.
 * Module-level, so the editor can mark a step (a share, the walk) from
 * wherever it happens.
 */
let record: FirstStepsRecord | null | undefined;
/** Steps done before the card was offered, kept for when it is. */
let sessionDone: ReadonlySet<FirstStepId> = new Set();
let showing: boolean | undefined;
/** Help asked for the card in this tab (#931): it shows even over a kept shared house. */
let asked = false;
const changed = createChannel<void>();

function subscribe(listener: () => void): () => void {
  return changed.subscribe(listener);
}

function stored(): FirstStepsRecord | null {
  // Read lazily: the prerender has no storage.
  if (record === undefined) record = loadFirstSteps();
  return record;
}

function isShowing(): boolean {
  if (showing === undefined) showing = stored()?.card === 'offered';
  return showing;
}

function doneSteps(): ReadonlySet<FirstStepId> {
  return stored()?.done ?? sessionDone;
}

function markDone(ids: readonly FirstStepId[]): void {
  const done = doneSteps();
  const fresh = ids.filter((id) => !done.has(id));
  if (fresh.length === 0) return;
  const next = new Set([...done, ...fresh]);
  const current = stored();
  if (current) {
    // All five done: the card says so this once, and is retired for good.
    const card = current.card === 'offered' && FIRST_STEPS.every((step) => next.has(step.id)) ? 'dismissed' : current.card;
    record = { card, done: next };
    saveFirstSteps(record);
  } else {
    sessionDone = next;
  }
  changed.emit();
}

/** The player did a step that isn't in the house: walked through it, shared it. */
export function markFirstStep(id: FirstStepId): void {
  markDone([id]);
}

/**
 * The start chooser was answered: offer the card, unless it was offered (or
 * dismissed) before.
 */
export function offerFirstSteps(): void {
  if (stored() !== null) return;
  record = { card: 'offered', done: sessionDone };
  saveFirstSteps(record);
  showing = true;
  changed.emit();
}

export function dismissFirstSteps(): void {
  record = { card: 'dismissed', done: doneSteps() };
  saveFirstSteps(record);
  showing = false;
  changed.emit();
}

/**
 * Help → Getting started (#931): the card again, dismissed or never
 * offered, with the ticks it had.
 */
export function reopenFirstSteps(): void {
  record = { card: 'offered', done: doneSteps() };
  saveFirstSteps(record);
  showing = true;
  asked = true;
  changed.emit();
}

function wasAsked(): boolean {
  return asked;
}

/** Whether Help asked for the card in this tab. */
export function useFirstStepsAsked(): boolean {
  return useSyncExternalStore(subscribe, wasAsked, () => false);
}

/** Whether the card shows: offered by the start chooser and not dismissed in this tab. */
export function useFirstStepsOffered(): boolean {
  return useSyncExternalStore(subscribe, isShowing, () => false);
}

const NONE: ReadonlySet<FirstStepId> = new Set();

export function useFirstStepsDone(): ReadonlySet<FirstStepId> {
  return useSyncExternalStore(subscribe, doneSteps, () => NONE);
}

/**
 * Follows the house: an edit that raises a step's count does the step, a
 * whole-house load (`markLayoutLoaded`) does none, as for achievements.
 */
export function useFirstStepsProgress(layout: RoomLayout, enabled: boolean): void {
  const lastRef = useRef<RoomLayout | null>(null);
  useEffect(() => {
    const before = lastRef.current;
    if (before === layout) return;
    lastRef.current = layout;
    if (!enabled) return;
    const change = before === null || isLoadedLayout(layout) ? 'loaded' : 'edit';
    markDone(firstStepsEarned(change, before, layout, doneSteps()));
  }, [layout, enabled]);
}

/** Tests only: a fresh session. */
export function resetFirstStepsForTests(): void {
  record = undefined;
  sessionDone = new Set();
  showing = undefined;
  asked = false;
}
