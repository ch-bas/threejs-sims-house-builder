'use client';

import { useEffect } from 'react';
import { Icon } from '../plotcraft/icon';
import type { Achievement } from '../lib/achievements';

const AUTO_DISMISS_MS = 4500;

export interface AchievementToastProps {
  pending: readonly Achievement[];
  onDismiss(): void;
}

export function AchievementToast({
  pending,
  onDismiss,
}: AchievementToastProps): JSX.Element | null {
  useEffect(() => {
    if (pending.length === 0) return undefined;
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [pending, onDismiss]);

  if (pending.length === 0) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 pointer-events-none"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {pending.map((achievement) => (
        <div
          key={achievement.id}
          className="pc-glass pc-glass--dark pointer-events-auto"
          role="status"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '12px 14px',
            maxWidth: 320,
            animation: 'pcHaloPulse 1.6s ease-in-out infinite',
          }}
        >
          <div
            aria-hidden
            style={{
              height: 36,
              width: 36,
              borderRadius: 10,
              background: 'rgba(127,243,255,0.20)',
              border: '1px solid var(--pc-cyan-glow)',
              color: 'var(--pc-cyan-glow)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Icon name="sparkle" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              className="pc-hud-header"
              style={{ fontSize: 9, margin: 0, opacity: 0.85 }}
            >
              Achievement Unlocked
            </p>
            <p
              style={{
                margin: '2px 0 0',
                fontFamily: 'var(--pc-font-display)',
                fontWeight: 700,
                fontSize: 13,
                color: 'var(--pc-paper)',
              }}
            >
              {achievement.name}
            </p>
            <p
              className="pc-blurb"
              style={{ margin: '2px 0 0', fontSize: 11, lineHeight: 1.35 }}
            >
              {achievement.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="pc-tile"
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              animation: 'none',
            }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
