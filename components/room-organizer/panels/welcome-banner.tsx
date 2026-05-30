'use client';

import { useEffect, useState } from 'react';
import { Icon } from '../plotcraft/icon';

const STORAGE_KEY = 'standalone-room-organizer-welcome-dismissed';

interface Tip {
  title: string;
  body: string;
}

const TIPS: readonly Tip[] = [
  { title: 'Drag from catalog', body: 'Drop any catalog item onto the lot to place it exactly where you let go.' },
  { title: 'Move in 3D', body: 'Click and drag furniture, or select and nudge with the arrow keys — Shift to fly.' },
  { title: 'Snap toggles', body: 'Grid, Wall, and Items snaps keep your placements tidy.' },
  { title: 'Themes & sets', body: 'One-click templates rebuild the room. Library saves named layouts.' },
  { title: 'Walkthrough', body: 'Switch to LIVE to wander your Sim home with WASD + Shift to sprint.' },
  { title: 'Multi-select', body: 'Ctrl-click to add items to a selection. Delete clears them all.' },
];

export function WelcomeBanner(): JSX.Element | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissed =
        typeof window !== 'undefined' &&
        window.localStorage.getItem(STORAGE_KEY) === '1';
      setVisible(!dismissed);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 30, 40, 0.45)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 60,
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to PlotCraft"
      onClick={dismiss}
    >
      <div
        className="pc-glass pc-glass--dark"
        style={{
          width: 'min(520px, 100%)',
          padding: '22px 24px',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div
            aria-hidden
            style={{
              height: 44,
              width: 44,
              borderRadius: 12,
              background: 'rgba(127,243,255,0.18)',
              border: '1px solid var(--pc-cyan-glow)',
              color: 'var(--pc-cyan-glow)',
              display: 'grid',
              placeItems: 'center',
              boxShadow: 'var(--pc-halo-cyan-soft)',
            }}
          >
            <Icon name="sparkle" size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--pc-font-display)',
                fontWeight: 800,
                fontSize: 22,
                letterSpacing: '-0.01em',
                color: 'var(--pc-paper)',
                lineHeight: 1.1,
              }}
            >
              Welcome to PlotCraft
            </p>
            <p
              className="pc-hud-header"
              style={{ fontSize: 10, opacity: 0.85, margin: '2px 0 0' }}
            >
              A 3D home builder for the modern web
            </p>
          </div>
        </div>

        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {TIPS.map((tip) => (
            <li
              key={tip.title}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}
            >
              <span
                aria-hidden
                style={{
                  marginTop: 7,
                  height: 6,
                  width: 6,
                  borderRadius: 999,
                  background: 'var(--pc-cyan-glow)',
                  boxShadow: 'var(--pc-halo-cyan-soft)',
                  flexShrink: 0,
                }}
              />
              <p
                className="pc-body"
                style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}
              >
                <strong
                  style={{
                    fontFamily: 'var(--pc-font-display)',
                    fontWeight: 700,
                    letterSpacing: '0.01em',
                  }}
                >
                  {tip.title}:
                </strong>{' '}
                <span style={{ color: 'var(--pc-paper-soft)' }}>{tip.body}</span>
              </p>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={dismiss}
          className="pc-tile pc-tile--active"
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 12,
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: 'var(--pc-tr-mode)',
            textTransform: 'uppercase',
          }}
        >
          Let&apos;s Build
        </button>
      </div>
    </div>
  );
}
