'use client';

import { forwardRef, type KeyboardEventHandler, type ReactNode } from 'react';
import { Icon } from '../plotcraft/icon';

export interface HudCardCloseProps {
  label: string;
  onClick(): void;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
}

/** The small cross that dismisses a HUD card. */
export function HudCardClose({ label, onClick, onKeyDown }: HudCardCloseProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(onKeyDown ? { onKeyDown } : {})}
      aria-label={label}
      title="Dismiss"
      className="pc-tile"
      style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0 }}
    >
      <Icon name="close" size={14} />
    </button>
  );
}

export interface HudCardProps extends HudCardCloseProps {
  titleId: string;
  title: ReactNode;
  /** Small text beside the title: progress, a version. */
  aside?: ReactNode;
  /** An extra class on the card: a placement variant. */
  className?: string;
  children: ReactNode;
}

/**
 * The card the Getting started steps (#721) and What's new (#931) share:
 * a dark glass box at the top right, under the pills, with a heading, a
 * note beside it and a close button. Its painted box is a scene occluder.
 */
export const HudCard = forwardRef<HTMLElement, HudCardProps>(function HudCard(
  { titleId, title, aside, className, label, onClick, onKeyDown, children },
  ref
) {
  return (
    <section ref={ref} aria-labelledby={titleId} className={`pc-glass pc-glass--dark pc-first-steps${className ? ` ${className}` : ''}`} data-scene-occluder="">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h2 id={titleId} className="pc-hud-header" style={{ fontSize: 11, margin: 0, flex: 1 }}>
          {title}
        </h2>
        {aside !== undefined && (
          <span className="pc-blurb" style={{ fontSize: 11 }}>
            {aside}
          </span>
        )}
        <HudCardClose label={label} onClick={onClick} {...(onKeyDown ? { onKeyDown } : {})} />
      </div>
      {children}
    </section>
  );
});

/**
 * A card is going and had the keyboard: focus moves to the mode panel (the
 * current mode's button) rather than falling to the page.
 */
export function focusModePanel(): void {
  const panel = document.querySelector('.pc-mode-panel');
  (panel?.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? panel?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
}
