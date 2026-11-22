'use client';

import { useMediaQuery } from '../hooks/use-media-query';
import { COARSE_POINTER_QUERY } from '../lib/hud-layout';
import { isRunItem } from '../lib/item-run';
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
  /** With a fence or hedge in hand on the ground floor: run it round the whole lot (#915). */
  onRunRoundLot?(): void;
}

/** A portrait phone: the hint chip sits between the left camera buttons and the right edge. */
const NARROW_HINT_QUERY = '(max-width: 480px)';

const HINT_BUTTON_STYLE = {
  pointerEvents: 'auto',
  padding: '4px 10px',
  borderRadius: 999,
  fontFamily: 'inherit',
  fontWeight: 700,
  fontSize: 10,
  letterSpacing: 'var(--pc-tr-caps)',
  textTransform: 'uppercase',
} as const;

/** How to place the ghost: a fence, hedge or stepping stone also lays in runs (#915). */
function ghostHint(ghost: CatalogItem, touch: boolean): string {
  const runs = isRunItem(ghost.type);
  if (touch) return runs ? 'Tap to place · drag for a run' : `Tap to place the ${ghost.name}`;
  return runs
    ? `${ghost.name}: click to place · drag to lay a run · Shift for another · Esc cancel`
    : `${ghost.name}: click to place · Shift+click for another · R rotate · Esc cancel`;
}

/**
 * Glass chip listing the keys that drive a pending keyboard placement, or
 * how to place the ghost in hand. Sits under the header stats, clear of the
 * catalog strip whose tile started it.
 */
export function PlacementHint({ active, ghost = null, onCancel, onRunRoundLot }: PlacementHintProps): JSX.Element | null {
  const touch = useMediaQuery(COARSE_POINTER_QUERY);
  // A phone stacks the floor and wall pills on the right down to ~120 px.
  const compact = useMediaQuery(COMPACT_OVERLAY_QUERY);
  const narrow = useMediaQuery(NARROW_HINT_QUERY);
  // Narrow with the extra button: a tighter chip clears the camera buttons on the left.
  const tight = narrow && onRunRoundLot !== undefined;
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
          padding: ghost ? (tight ? '4px 4px 4px 8px' : '4px 4px 4px 12px') : '6px 12px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: tight ? 6 : 8,
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
            {/* A portrait phone has room for only a short line beside "Fence the lot" (#915), and none for the icon. */}
            {!tight && <Icon name="target" size={14} />}
            <span>{tight ? 'Drag for a run' : ghostHint(ghost, touch)}</span>
            {onRunRoundLot && (
              <button type="button" className="pc-tile" onClick={onRunRoundLot} style={HINT_BUTTON_STYLE}>
                {ghost.type === 'hedge' ? 'Hedge' : 'Fence'} the lot
              </button>
            )}
            <button type="button" className="pc-tile" onClick={onCancel} style={HINT_BUTTON_STYLE}>
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
