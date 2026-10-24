'use client';

import { useMediaQuery } from '../hooks/use-media-query';
import { COARSE_POINTER_QUERY } from '../lib/hud-layout';
import { COMPACT_OVERLAY_QUERY } from '../lib/overlay-queue';
import { Icon } from '../plotcraft/icon';
import type { CatalogItem } from '../lib/types';

export interface PlacementHintProps {
  /** Rendered while a keyboard placement is pending (#168)… */
  active: boolean;
  /** …or while a catalogue item is in hand as a placement ghost (#463 d). */
  ghost?: CatalogItem | null;
  /** Puts the ghost down: touch has no Escape key. */
  onCancel?(): void;
}

/**
 * Glass chip listing the keys that drive a pending keyboard placement, or
 * how to place the ghost in hand. Sits under the header stats, clear of the
 * catalog strip whose tile started it.
 */
export function PlacementHint({ active, ghost = null, onCancel }: PlacementHintProps): JSX.Element | null {
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  // A phone stacks the floor and wall pills on the right down to ~120 px.
  const compact = useMediaQuery(COMPACT_OVERLAY_QUERY);
  if (!active && !ghost) return null;
  return (
    <div
      className="pc-placement-hint"
      role="status"
      style={{
        position: 'absolute',
        // Below the header stats box, which wraps to two lines at narrow
        // desktop widths (#299); 72 sat inside it.
        top: compact ? 132 : 104,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        pointerEvents: 'none',
      }}
    >
      <div
        className="pc-glass pc-glass--dark"
        style={{
          padding: ghost ? '4px 4px 4px 12px' : '6px 12px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          borderRadius: 999,
          fontFamily: 'var(--pc-font-display)',
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
          color: 'var(--pc-cyan-glow)',
        }}
      >
        {ghost ? (
          <>
            <Icon name="target" size={14} />
            <span>
              {touch
                ? `Tap to place the ${ghost.name}`
                : `${ghost.name}: click to place · Shift+click for another · R rotate · Esc cancel`}
            </span>
            <button
              type="button"
              className="pc-tile"
              onClick={onCancel}
              style={{
                pointerEvents: 'auto',
                padding: '4px 10px',
                borderRadius: 999,
                fontFamily: 'inherit',
                fontWeight: 700,
                fontSize: 10,
                letterSpacing: 'var(--pc-tr-caps)',
                textTransform: 'uppercase',
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <Icon name="unlock" size={14} />
            <span>← ↑ → ↓ move · R rotate · Enter confirm · Esc cancel</span>
          </>
        )}
      </div>
    </div>
  );
}
