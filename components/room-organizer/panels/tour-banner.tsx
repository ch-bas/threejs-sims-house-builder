'use client';

import { Icon } from '../plotcraft/icon';
import type { KeyboardEvent } from 'react';

export interface TourBannerProps {
  /** The toured house's name; null while its link is still opening. */
  name: string | null;
  /** The walk's own HUD has the screen then, and its exit button. */
  walking: boolean;
  /** The 2D plan is showing: the bar carries its switch on a phone, where the walls pill drops it. */
  plan: boolean;
  onTogglePlan(): void;
  onWalk(): void;
  onKeepCopy(): void;
  onBuildOwn(): void;
}

/** A held Enter or Space presses once, not once per repeat. */
function swallowRepeat(event: KeyboardEvent<HTMLButtonElement>): void {
  if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
}

/**
 * The shared-link tour's whole HUD but the floors and the camera (#722): the
 * house's name top left, where the title badge sits, and the three things a
 * visitor can do in a bar at the bottom, in thumb reach on a phone.
 */
export function TourBanner({ name, walking, plan, onTogglePlan, onWalk, onKeepCopy, onBuildOwn }: TourBannerProps): JSX.Element {
  const ready = name !== null;
  const shownName = ready ? name.trim() || 'Untitled Home' : 'Opening…';
  return (
    <>
      <div className="pc-tour-name" style={{ position: 'absolute', top: 16, left: 16, zIndex: 30 }}>
        <div
          className="pc-glass pc-glass--dark"
          data-scene-occluder=""
          role="status"
          style={{ padding: '8px 14px 8px 10px', display: 'flex', alignItems: 'center', gap: 10, maxWidth: 320 }}
        >
          <span
            aria-hidden
            style={{
              height: 32,
              width: 32,
              borderRadius: 10,
              background: 'rgba(127,243,255,0.18)',
              border: '1px solid var(--pc-cyan-glow)',
              color: 'var(--pc-cyan-glow)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Icon name="home" size={16} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="pc-hud-header" style={{ display: 'block', fontSize: 9, opacity: 0.85 }}>
              Shared house · look around
            </span>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--pc-font-display)',
                fontWeight: 800,
                fontSize: 15,
                lineHeight: 1.2,
                color: 'var(--pc-paper)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {shownName}
            </span>
          </span>
        </div>
      </div>

      {!walking && (
      <div
        className="pc-tour-bar"
        role="group"
        aria-label="Shared house"
      >
        <div className="pc-glass pc-glass--dark pc-tour-bar__box" data-scene-occluder="">
          {/* The name's place on a phone, where the top belongs to the pills. */}
          <span className="pc-tour-bar__name" aria-hidden>
            {shownName}
          </span>
          <button
            type="button"
            className={`pc-tile pc-tour-button pc-tour-plan${plan ? ' pc-tile--active' : ''}`}
            onKeyDown={swallowRepeat}
            aria-pressed={plan}
            aria-label="2D plan"
            disabled={!ready}
            onClick={onTogglePlan}
          >
            2D
          </button>
          <button type="button" className="pc-tile pc-tour-button" onKeyDown={swallowRepeat} disabled={!ready} onClick={onWalk}>
            Walk through
          </button>
          <button
            type="button"
            className="pc-tile pc-tile--active pc-tour-button"
            onKeyDown={swallowRepeat}
            disabled={!ready}
            title="Make this house yours: it saves in this browser, and yours is kept in History"
            onClick={onKeepCopy}
          >
            Keep a copy
          </button>
          <button type="button" className="pc-tile pc-tour-button" onKeyDown={swallowRepeat} title="Leave this house for your own" onClick={onBuildOwn}>
            Build your own
          </button>
        </div>
      </div>
      )}
    </>
  );
}
