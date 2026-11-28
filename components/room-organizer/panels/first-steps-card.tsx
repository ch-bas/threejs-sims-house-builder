'use client';

import { memo, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { useEditorView, useEditorViewActions, useRoomEditor, useSelection, useViewSettings } from '../contexts';
import { holdFocusReturn } from '../hooks/use-dialog-focus';
import { useEvent } from '../hooks/use-event';
import {
  dismissFirstSteps,
  markFirstStep,
  useFirstStepsDone,
  useFirstStepsOffered,
  useFirstStepsProgress,
} from '../hooks/use-first-steps';
import { armGhostPlacement, armKeyboardPlacement } from '../hooks/use-keyboard-placement';
import { useMediaQuery } from '../hooks/use-media-query';
import { usePhotoModeActive } from '../hooks/use-photo-mode';
import { useSetGameMode } from '../hooks/use-set-game-mode';
import { useWhatsNewState } from '../hooks/use-whats-new';
import { FURNITURE_CATALOG } from '../lib/constants';
import { FIRST_STEPS, firstStepTips, nextFirstStep, type FirstStepId } from '../lib/first-steps';
import { COARSE_POINTER_QUERY, COMPACT_DOCK_QUERY } from '../lib/hud-layout';
import { HudCard, HudCardClose, focusModePanel } from './hud-card';
import type { CatalogItem } from '../lib/types';
import type { SelectedWall } from '../lib/wall-sides';

export interface FirstStepsCardProps {
  placeCatalogItem(catalogItem: CatalogItem, position?: { x: number; z: number }): string;
  onShareLink(): Promise<void>;
  onSelectedWallChange(wall: SelectedWall | null): void;
}

const DOOR: CatalogItem | undefined = FURNITURE_CATALOG.find((entry) => entry.type === 'door');

/**
 * The Getting started card (#721): draw a room, add a door, furnish it, walk
 * through it, share it. Offered once the start chooser is answered, until
 * dismissed. Each step's button arms the tool it names, and the next step
 * shows the tips that matter for it. On a phone it is one thin line over the
 * dock, a scene occluder like the rest of the HUD.
 */
export const FirstStepsCard = memo(function FirstStepsCard({ placeCatalogItem, onShareLink, onSelectedWallChange }: FirstStepsCardProps): JSX.Element | null {
  const { layout, isReady, error } = useRoomEditor();
  const offered = useFirstStepsOffered();
  const done = useFirstStepsDone();
  useFirstStepsProgress(layout, offered);
  const gameMode = useEditorView((state) => state.gameMode);
  const view = useViewSettings('drawWallMode', 'walkthroughMode', 'view2D');
  const { toggle } = useEditorViewActions();
  const setMode = useSetGameMode(onSelectedWallChange);
  const photo = usePhotoModeActive();
  const compact = useMediaQuery(COMPACT_DOCK_QUERY);
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  const { selectOnly } = useSelection();
  const cardRef = useRef<HTMLElement>(null);
  // What's new (#931) has the same place on screen: it goes first.
  const whatsNew = useWhatsNewState();

  // EXPLORE is the walk through: doing it is the step.
  const walking = view.walkthroughMode && !view.view2D;
  useEffect(() => {
    if (offered && walking) markFirstStep('walk');
  }, [offered, walking]);

  // From the keyboard (a click with no pointer behind it), the door is placed
  // as Enter on a catalogue tile places it, ready to nudge; from a pointer
  // it is picked up as a ghost to put down.
  const arm = useEvent((id: FirstStepId, event?: MouseEvent<HTMLButtonElement>) => {
    const fromKeyboard = event?.detail === 0;
    const control = event?.currentTarget ?? null;
    switch (id) {
      case 'room':
        if (gameMode !== 'build') setMode('build');
        if (!view.drawWallMode) toggle('drawWallMode');
        return;
      case 'door': {
        if (gameMode !== 'build') setMode('build');
        // The ghost is the wall tool's to refuse: put the tool down.
        if (view.drawWallMode) toggle('drawWallMode');
        const pickUp = () => {
          if (!DOOR) return;
          if (fromKeyboard) {
            armKeyboardPlacement();
            const placed = placeCatalogItem(DOOR);
            if (!placed) return;
            selectOnly(placed);
            // The keyboard goes to the door's editor, and comes back here after.
            if (control) {
              holdFocusReturn(control);
              control.blur();
            }
            return;
          }
          // As a tap on the Door tile: the door follows the pointer until placed.
          armGhostPlacement();
          placeCatalogItem(DOOR);
        };
        // A mode switch puts any ghost down once it lands: pick up after it.
        if (gameMode !== 'build') window.setTimeout(pickUp, 0);
        else pickUp();
        return;
      }
      case 'furnish':
        setMode('buy');
        return;
      case 'walk':
        setMode('live');
        return;
      case 'share':
        void onShareLink();
        return;
      default:
        return;
    }
  });

  // Held keys repeat: one press, one step, never a second door (#721).
  const onStepKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
  };

  // The card is going: focus moves to the mode panel (the current mode's
  // button, where the steps lead) rather than falling to the page.
  const dismiss = useEvent(() => {
    const card = cardRef.current;
    const active = document.activeElement;
    const hadFocus = card !== null && active instanceof Node && card.contains(active);
    dismissFirstSteps();
    if (hadFocus) focusModePanel();
  });

  if (!offered || !isReady || error || walking || photo || whatsNew !== 'closed') return null;

  const next = nextFirstStep(done);
  const count = FIRST_STEPS.filter((step) => done.has(step.id)).length;
  const progress = `${count} of ${FIRST_STEPS.length} done`;

  const closeButton = <HudCardClose label="Dismiss getting started" onClick={dismiss} onKeyDown={onStepKeyDown} />;

  if (compact) {
    return (
      <section ref={cardRef} aria-label="Getting started" className="pc-glass pc-glass--dark pc-first-steps pc-first-steps--line" data-scene-occluder="">
        <span className="pc-hud-header" style={{ fontSize: 10, flexShrink: 0 }} aria-label={progress}>
          {count}/{FIRST_STEPS.length}
        </span>
        <span className="pc-body" style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {next ? next.title : 'All done. Enjoy the house!'}
        </span>
        {next && (
          <button type="button" onClick={(event) => arm(next.id, event)} onKeyDown={onStepKeyDown} className="pc-tile pc-tile--active pc-first-steps__go">
            {next.action}
          </button>
        )}
        {closeButton}
      </section>
    );
  }

  return (
    <HudCard
      ref={cardRef}
      titleId="pc-first-steps-title"
      title="Getting started"
      aside={progress}
      label="Dismiss getting started"
      onClick={dismiss}
      onKeyDown={onStepKeyDown}
    >
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {FIRST_STEPS.map((step) => {
          const isDone = done.has(step.id);
          const isNext = next?.id === step.id;
          return (
            <li key={step.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 }}>
                <span aria-hidden className={`pc-first-steps__mark${isDone ? ' pc-first-steps__mark--done' : ''}`}>
                  {isDone ? '✓' : ''}
                </span>
                <span
                  className="pc-body"
                  style={{
                    flex: 1,
                    fontSize: 13,
                    color: isDone ? 'var(--pc-paper-soft)' : undefined,
                    textDecoration: isDone ? 'line-through' : undefined,
                  }}
                >
                  {step.title}
                  {isDone && <span className="sr-only"> (done)</span>}
                </span>
                {!isDone && (
                  <button
                    type="button"
                    onClick={(event) => arm(step.id, event)}
                    onKeyDown={onStepKeyDown}
                    className={`pc-tile pc-first-steps__go${isNext ? ' pc-tile--active' : ''}`}
                  >
                    {step.action}
                  </button>
                )}
              </div>
              {isNext && (
                <ul className="pc-first-steps__tips">
                  {firstStepTips(step.id, touch).map((tip) => (
                    <li key={tip.title}>
                      <strong>{tip.title}:</strong> {tip.body}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {!next && (
        <p className="pc-body" style={{ fontSize: 13, margin: '8px 0 0' }}>
          All done. Enjoy the house!
        </p>
      )}
    </HudCard>
  );
});
