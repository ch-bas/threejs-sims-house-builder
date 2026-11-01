'use client';

import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../hooks/use-media-query';
import { formatMetres, formatSize } from '../lib/format';
import { COARSE_POINTER_QUERY } from '../lib/hud-layout';
import { isTypingTarget } from '../lib/walk-input';
import { parseWallLength, type WallSnapKind } from '../lib/wall-snap';
import { Icon } from '../plotcraft/icon';
import { ChipButton } from './chip-controls';
import type { Vec2 } from '../lib/types';

export interface WallDrawStatus {
  hasAnchor: boolean;
  snapKind?: WallSnapKind;
  currentLength?: number | null;
  /** The draft's heading on the plan, degrees. */
  angle?: number | null;
  /** The pointer has shown a direction for a typed length. */
  aimed: boolean;
  /** A room stamp is in hand (#724). */
  stamp?: { size: { width: number; depth: number } | null; refusal: string | null } | null;
}

/** Tall enough that a row with nothing to say keeps the rows under it where they are. */
const ROW_HEIGHT = 15;

const SNAP_HINTS: Partial<Record<WallSnapKind, { text: string; color: string }>> = {
  vertex: { text: '⊙ Snapping to vertex', color: 'var(--pc-confirm-green)' },
  'on-wall': { text: '⊥ Snapping onto wall', color: 'var(--pc-confirm-green)' },
  'right-angle': { text: '⟂ Right-angle snap', color: 'var(--pc-cyan-glow)' },
  angle: { text: '∠ 15° step', color: 'var(--pc-cyan-glow)' },
};

/** A press on one of these points the typed wall when the pointer hasn't. */
const AIM_BUTTONS: ReadonlyArray<{ label: string; glyph: string; direction: Vec2 }> = [
  { label: 'Left', glyph: '←', direction: { x: -1, z: 0 } },
  { label: 'Up', glyph: '↑', direction: { x: 0, z: -1 } },
  { label: 'Down', glyph: '↓', direction: { x: 0, z: 1 } },
  { label: 'Right', glyph: '→', direction: { x: 1, z: 0 } },
];

/** What a key adds to the length field, or null when the view keeps the key. */
export function lengthKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return /^[0-9.,]$/.test(event.key) ? event.key : null;
}

export interface WallDrawChipProps {
  status: WallDrawStatus;
  /**
   * Place the next point `length` metres on, along `direction` or, when null,
   * the way the pointer shows. False keeps the field open: it said why not.
   */
  onLength?(length: number, direction: Vec2 | null): boolean;
  /** The field opened or closed: the draft holds its direction while it is open. */
  onFieldOpen?(open: boolean): void;
}

/**
 * The wall tool's chip: what the next click does, the draft's length and
 * angle, what caught it, and the field for an exact length (#723). Digits
 * typed in the view open the field, ahead of the keys they would otherwise
 * be (2 is the plan view). The chip lets clicks through to the scene, except
 * with the field open: a pointer on its way to Place is not aiming the wall.
 */
export function WallDrawChip({ status, onLength, onFieldOpen }: WallDrawChipProps): JSX.Element {
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  const [text, setText] = useState<string | null>(null);
  const { hasAnchor } = status;
  const open = text !== null;
  // Place or not is settled as the field opens: the pointer leaving the scene
  // for the chip must not swap the buttons under it.
  const aimedRef = useRef(status.aimed);
  if (!open) aimedRef.current = status.aimed;

  useEffect(() => {
    onFieldOpen?.(open);
  }, [open, onFieldOpen]);

  // No draft, no length: an Escape or a floor switch can end it under the field.
  useEffect(() => {
    if (!hasAnchor) setText(null);
  }, [hasAnchor]);

  useEffect(() => {
    if (!hasAnchor || open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = lengthKey(event);
      if (key === null || isTypingTarget(event.target)) return;
      // Ahead of the shortcuts' own window listener.
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) setText(key);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [hasAnchor, open]);

  const length = text === null ? null : parseWallLength(text);
  const place = (direction: Vec2 | null): void => {
    if (length !== null && onLength?.(length, direction)) setText(null);
  };

  const row = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'var(--pc-font-display)',
    fontWeight: 700,
    fontSize: 11,
    color: 'var(--pc-paper)',
  } as const;
  const hint = status.snapKind ? SNAP_HINTS[status.snapKind] : undefined;

  return (
    <div
      // Top-centre like the other tool chips: the top-right corner is the
      // floor and wall pills, which covered it (#473).
      className={`pc-top-chip pc-wall-hint absolute left-1/2 pc-glass pc-glass--dark${open ? ' pointer-events-auto' : ''}`}
      style={{
        top: 104,
        transform: 'translateX(-50%)',
        zIndex: 31,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 200,
      }}
    >
      {status.stamp ? (
        <>
          <div style={row}>
            <Icon name="brick" size={14} />
            {touch ? 'Tap to place · drag to size' : 'Click to place · drag to size · Esc to cancel'}
          </div>
          {status.stamp.size && (
            <div className="pc-blurb" style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', paddingLeft: 20 }}>
              {formatSize(status.stamp.size.width, status.stamp.size.depth)}
            </div>
          )}
          {status.stamp.refusal && (
            <div className="pc-blurb" style={{ fontSize: 11, paddingLeft: 20 }}>
              ⚠ {status.stamp.refusal}
            </div>
          )}
        </>
      ) : hasAnchor ? (
        <>
          <div style={row}>
            <Icon name="brick" size={14} />
            {touch ? 'Tap to extend · tap Walls to stop' : 'Click to extend · Esc to stop'}
          </div>
          <div className="pc-blurb" style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', paddingLeft: 20, minHeight: ROW_HEIGHT }}>
            {status.currentLength !== undefined && status.currentLength !== null && (
              <>
                {formatMetres(status.currentLength, 2)}
                {status.angle !== undefined && status.angle !== null ? ` · ${status.angle}°` : ''}
              </>
            )}
          </div>
          <div
            style={{
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 600,
              fontSize: 11,
              color: hint?.color,
              paddingLeft: 20,
              minHeight: ROW_HEIGHT,
            }}
          >
            {hint?.text}
            {status.snapKind === 'angle' && !touch ? ' · Shift for free' : ''}
          </div>
          {onLength && !open && (
            <div className="pointer-events-auto" style={{ paddingLeft: 20, paddingTop: 2, color: 'var(--pc-paper)', alignSelf: 'flex-start' }}>
              <ChipButton title="Type the wall's length: digits open this too" onClick={() => setText('')}>
                Type length
              </ChipButton>
            </div>
          )}
          {open && (
            <form
              className="pointer-events-auto"
              style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 20, paddingTop: 2, color: 'var(--pc-paper)', alignSelf: 'flex-start' }}
              // A press on its buttons leaves the focus in the field, whose blur closes it.
              onMouseDown={(event) => {
                if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
              }}
              onSubmit={(event) => {
                event.preventDefault();
                if (aimedRef.current) place(null);
              }}
            >
              <input
                // Opened by a key or a tap: the next key belongs here.
                autoFocus
                className="pc-chip-name"
                aria-label="Wall length in metres"
                inputMode="decimal"
                autoComplete="off"
                value={text}
                onChange={(event) => setText(event.target.value)}
                // Left, the digits go back to the view. Not for another window:
                // the field is still the page's focus when that comes back.
                onBlur={(event) => {
                  if (document.activeElement !== event.target) setText(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  // Closes the field; the draft stays for the next Escape.
                  event.preventDefault();
                  event.stopPropagation();
                  setText(null);
                }}
                style={{
                  width: 64,
                  minWidth: 0,
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 999,
                  border: '1px solid rgba(255, 255, 255, 0.45)',
                  background: 'rgba(0, 0, 0, 0.25)',
                  color: 'var(--pc-paper)',
                  fontFamily: 'var(--pc-font-body)',
                  fontWeight: 600,
                  fontSize: 12,
                }}
              />
              <span aria-hidden>m</span>
              {aimedRef.current && (
                <ChipButton type="submit" title="Place the wall at this length, the way the preview points" disabled={length === null}>
                  Place
                </ChipButton>
              )}
              {AIM_BUTTONS.map(({ label, glyph, direction }) => {
                const name = `Place the wall going ${label.toLowerCase()}`;
                return (
                  <ChipButton key={label} title={name} ariaLabel={name} disabled={length === null} onClick={() => place(direction)}>
                    {glyph}
                  </ChipButton>
                );
              })}
            </form>
          )}
        </>
      ) : (
        <div style={row}>
          <Icon name="brick" size={14} />
          {touch ? 'Tap to place the first wall point' : 'Click to place the first wall point'}
        </div>
      )}
    </div>
  );
}
