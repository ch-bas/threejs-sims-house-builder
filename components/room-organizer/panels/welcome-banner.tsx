'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import { useMediaQuery } from '../hooks/use-media-query';
import { COARSE_POINTER_QUERY, welcomeTips } from '../lib/hud-layout';
import { Icon } from '../plotcraft/icon';

const STORAGE_KEY = 'standalone-room-organizer-welcome-dismissed';

export function WelcomeBanner(): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const tips = welcomeTips(useMediaQuery(COARSE_POINTER_QUERY));
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

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

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  }, []);

  // A11y: focus the primary action on mount, close on Escape, and keep Tab
  // focus trapped inside the modal dialog (it renders with aria-modal="true").
  useDialogFocus(visible, dialogRef, { initialFocusRef: primaryButtonRef, onEscape: dismiss, trap: true });

  if (!visible) return null;

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
      aria-label="Welcome to the game"
      onClick={dismiss}
    >
      <div
        ref={dialogRef}
        className="pc-glass pc-glass--dark"
        style={{
          width: 'min(520px, 100%)',
          padding: '22px 24px',
          // A landscape phone is shorter than the tips (#307): the list
          // scrolls and the button stays in view.
          maxHeight: 'calc(100dvh - 32px)',
          display: 'flex',
          flexDirection: 'column',
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
              Welcome to the game
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
            // Room for the bullets' glow inside the scroller, which would
            // clip it; the negative margin keeps the text where it was.
            padding: '14px 16px',
            margin: '-14px -16px 4px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          {tips.map((tip) => (
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
          ref={primaryButtonRef}
          type="button"
          onClick={dismiss}
          className="pc-tile pc-tile--active"
          style={{
            flexShrink: 0,
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
