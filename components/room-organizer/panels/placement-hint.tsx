'use client';

import { Icon } from '../plotcraft/icon';

export interface PlacementHintProps {
  /** Rendered only while a keyboard placement is pending (#168). */
  active: boolean;
}

/**
 * Glass chip listing the keys that drive a pending keyboard placement. Sits
 * under the header stats, clear of the catalog strip whose tile started it.
 */
export function PlacementHint({ active }: PlacementHintProps): JSX.Element | null {
  if (!active) return null;
  return (
    <div
      className="pc-placement-hint"
      role="status"
      style={{
        position: 'absolute',
        top: 72,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        pointerEvents: 'none',
      }}
    >
      <div
        className="pc-glass pc-glass--dark"
        style={{
          padding: '6px 12px',
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
        <Icon name="unlock" size={14} />
        <span>← ↑ → ↓ move · R rotate · Enter confirm · Esc cancel</span>
      </div>
    </div>
  );
}
