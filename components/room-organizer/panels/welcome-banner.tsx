'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import { useLoadTemplate } from '../hooks/use-load-template';
import { ROOM_TEMPLATES, type RoomTemplateKey } from '../lib/constants';
import { parseLayoutJson } from '../lib/persistence';
import { isUntouched } from '../lib/restore-point';
import { safeGetItem, safeSetItem } from '../lib/safe-storage';
import { STORAGE_KEY as HOUSE_KEY } from '../lib/saved-house';
import { isShareHash } from '../lib/share';
import { Icon } from '../plotcraft/icon';
import { PlanThumb } from './plan-thumb';
import { TEMPLATE_KEYS, templateName } from './templates-panel';

const STORAGE_KEY = 'standalone-room-organizer-welcome-dismissed';

/**
 * Whether this visit opens on the start chooser: a first run only. Not on a
 * share link (the visitor came to see that house), and not over a house the
 * player built, even with the flag gone: "Start empty" would keep it and a
 * template would replace it. A save that can't be read counts as built.
 */
export function opensOnStartChooser(dismissed: string | null, hash: string, savedHouse: string | null): boolean {
  if (dismissed === '1' || isShareHash(hash)) return false;
  if (savedHouse === null) return true;
  const house = parseLayoutJson(savedHouse);
  return house !== null && isUntouched(house);
}

const THUMB_WIDTH = 132;
const THUMB_HEIGHT = 84;

/**
 * The first-run start chooser (#721): an empty lot, one of the templates, or
 * a template picked at random. A template goes through the whole-house load
 * path (`useLoadTemplate`), so it is one undo away and earns nothing. Shown
 * once; any answer, Escape or a click outside closes it for good.
 */
export function WelcomeBanner(): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const loadTemplate = useLoadTemplate();
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

  // In an effect: the prerender has no storage.
  useEffect(() => {
    setVisible(opensOnStartChooser(safeGetItem(STORAGE_KEY), window.location.hash, safeGetItem(HOUSE_KEY)));
  }, []);

  const dismiss = useCallback(() => {
    safeSetItem(STORAGE_KEY, '1');
    setVisible(false);
  }, []);

  const start = (key: RoomTemplateKey) => {
    // Closed first: a house already on screen asks before it is replaced,
    // and that question must not open under this dialog.
    dismiss();
    void loadTemplate(ROOM_TEMPLATES[key]);
  };

  const surprise = () => {
    const key = TEMPLATE_KEYS[Math.floor(Math.random() * TEMPLATE_KEYS.length)];
    if (key) start(key);
  };

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
      aria-labelledby="pc-welcome-title"
      onClick={dismiss}
    >
      <div
        ref={dialogRef}
        className="pc-glass pc-glass--dark"
        style={{
          width: 'min(560px, 100%)',
          padding: '22px 24px',
          // A landscape phone is shorter than the chooser (#307): the
          // templates scroll and the buttons stay in view.
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
            marginBottom: 10,
            flexShrink: 0,
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
              flexShrink: 0,
            }}
          >
            <Icon name="sparkle" size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              id="pc-welcome-title"
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

        <p className="pc-body" style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.45, flexShrink: 0 }}>
          <span style={{ color: 'var(--pc-paper-soft)' }}>
            Build walls and doors in DESIGN, fill the rooms in FURNISH, then look around in EXPLORE. How would you like to start?
          </span>
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flexShrink: 0, marginBottom: 14 }}>
          <button
            ref={primaryButtonRef}
            type="button"
            onClick={dismiss}
            className="pc-tile pc-tile--active"
            style={CHOICE_STYLE}
          >
            Start empty
          </button>
          <button type="button" onClick={surprise} className="pc-tile" style={CHOICE_STYLE}>
            <Icon name="sparkle" size={14} /> Surprise me with a template
          </button>
        </div>

        <p
          id="pc-welcome-templates"
          className="pc-hud-header"
          style={{ fontSize: 10, margin: '0 0 8px', flexShrink: 0 }}
        >
          Or pick a template
        </p>
        <ul
          aria-labelledby="pc-welcome-templates"
          style={{
            listStyle: 'none',
            // Room for the tiles' hover lift inside the scroller, which
            // would clip it; the negative margin keeps them where they were.
            padding: '4px 4px',
            margin: '-4px -4px 0',
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_WIDTH + 14}px, 1fr))`,
            gap: 8,
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          {TEMPLATE_KEYS.map((key) => (
            <li key={key} style={{ display: 'flex' }}>
              <button
                type="button"
                onClick={() => start(key)}
                className="pc-tile"
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  padding: 6,
                  borderRadius: 12,
                  cursor: 'pointer',
                }}
              >
                <PlanThumb
                  layout={ROOM_TEMPLATES[key]}
                  width={THUMB_WIDTH}
                  height={THUMB_HEIGHT}
                  style={{ borderRadius: 8, background: 'var(--pc-paper-soft)', display: 'block' }}
                />
                <span
                  style={{
                    fontFamily: 'var(--pc-font-display)',
                    fontWeight: 700,
                    fontSize: 12,
                    letterSpacing: '0.01em',
                    lineHeight: 1.2,
                    textAlign: 'center',
                  }}
                >
                  {templateName(key)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const CHOICE_STYLE = {
  // Side by side where they fit, stacked on a phone.
  flex: '1 1 200px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '10px 14px',
  borderRadius: 12,
  fontFamily: 'var(--pc-font-display)',
  fontWeight: 800,
  fontSize: 13,
  letterSpacing: 'var(--pc-tr-mode)',
  textTransform: 'uppercase',
  textAlign: 'center',
  // A narrow phone wraps the longer label rather than spill out of the dialog.
  minWidth: 0,
} as const;
