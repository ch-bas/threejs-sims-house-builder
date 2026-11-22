'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useViewSettings } from '../contexts';
import { sceneOccluderRects } from '../hooks/scene-occluders';
import { BACK_LAYER, useBackDismiss } from '../hooks/use-back-dismiss';
import { usePhotoModeActive } from '../hooks/use-photo-mode';
import { EDIT_KEYS } from '../lib/keymap';
import { NEED_KINDS } from '../lib/npc-needs';
import { isTypingTarget } from '../lib/walk-input';
import { CARD_EDGE, placeWalkerCard, type WalkerCards } from '../lib/walker-card';
import { NEED_BAR_LABELS, WANT_LINES, walkerActivity, walkerName } from '../lib/walker-card-text';

/**
 * Back closes the card before the item popover beside it, as Escape does
 * (the card's key handler runs first, in the capture phase), and after the
 * drawer and any dialog over it.
 */
export const WALKER_CARD_BACK_LAYER = BACK_LAYER.itemSheet + 5;

/**
 * The walker card (#906): a tap on a walker opens it beside the tap, with
 * the walker's name, what it is doing, and a bar per need, refreshed twice
 * a second by the walk (hooks/use-npcs.ts). Not over a walk or a photo;
 * Close, Escape, back or a tap on empty floor closes it, and so does the
 * walker leaving the view. Loaded on the first tap, with its words.
 */
export function WalkerCard({ cards }: { cards: WalkerCards }): JSX.Element | null {
  const card = useSyncExternalStore(cards.subscribe, cards.snapshot, nullSnapshot);
  const view = useViewSettings('walkthroughMode');
  const photo = usePhotoModeActive();
  const shown = card !== null && !view.walkthroughMode && !photo;
  const boxRef = useRef<HTMLElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const anchor = cards.anchor();

  useBackDismiss(shown, WALKER_CARD_BACK_LAYER, cards.close);

  // Capture, so Escape closes the card and nothing else: not the selection,
  // not a placement. One step per press. A modal over the card (the drawer,
  // a confirm) takes Escape first, as it takes back.
  useEffect(() => {
    if (!shown) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== EDIT_KEYS.escape || isTypingTarget(event.target) || modalOpen()) return;
      event.stopPropagation();
      if (event.repeat) return;
      cards.close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shown, cards]);

  // Beside the tap, kept on screen and clear of the HUD (the scene
  // occluders, and the phone's item sheet while it is open): above and to
  // the right, else wherever fits. Measured again whenever the card's
  // height can change.
  const anchorX = anchor?.x ?? Number.NaN;
  const anchorY = anchor?.y ?? Number.NaN;
  const wants = card?.wants ?? null;
  const line = card ? walkerActivity(card.doing) : '';
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!shown || !box) return;
    const x = Number.isFinite(anchorX) ? anchorX : window.innerWidth / 2;
    const y = Number.isFinite(anchorY) ? anchorY : window.innerHeight / 2;
    const { left, top } = placeWalkerCard(
      { x, y },
      { width: box.offsetWidth, height: box.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      sceneOccluderRects()
    );
    setPlace((last) => (last && last.left === left && last.top === top ? last : { left, top }));
  }, [shown, anchorX, anchorY, wants, line]);

  if (!shown) return null;
  const name = walkerName(card.seed);
  return (
    <section
      ref={boxRef}
      className="pc-glass pc-glass--dark"
      aria-label={`${name}, a walker`}
      style={{ ...CARD, ...(place ?? { left: CARD_EDGE, top: CARD_EDGE, visibility: 'hidden' }) }}
    >
      <div style={HEADER}>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>{name}</span>
        <button type="button" className="pc-walker-card-close" onClick={cards.close} aria-label={`Close ${name}’s card`} title="Close">
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p style={LINE}>{line}</p>
      <ul style={BARS}>
        {NEED_KINDS.map((need) => {
          const percent = Math.round(card.needs[need] * 100);
          return (
            <li key={need} style={ROW}>
              <span style={LABEL}>{NEED_BAR_LABELS[need]}</span>
              <span
                role="meter"
                aria-label={NEED_BAR_LABELS[need]}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={`${percent}%`}
                style={TRACK}
              >
                <span style={{ ...FILL, width: `${percent}%`, background: wants === need ? LOW : FULL }} />
              </span>
            </li>
          );
        })}
      </ul>
      {wants && <p style={WANT}>{WANT_LINES[wants]}</p>}
    </section>
  );
}

function nullSnapshot(): null {
  return null;
}

/** A modal surface is open over the card: it owns Escape. */
function modalOpen(): boolean {
  for (const element of document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="alertdialog"]')) {
    if (element.getClientRects().length > 0) return true;
  }
  return false;
}

/** A met need's bar, and one the walker can't meet: both read on the dark glass. */
const FULL = '#9BE87F';
const LOW = 'var(--pc-demolish-ink)';

const CARD: React.CSSProperties = {
  position: 'fixed',
  zIndex: 32,
  width: 200,
  padding: '8px 10px 10px',
  borderRadius: 14,
  fontFamily: 'var(--pc-font-display)',
  fontSize: 12,
  color: 'var(--pc-paper)',
};

const HEADER: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };

const LINE: React.CSSProperties = { margin: '0 0 6px', fontWeight: 500, opacity: 0.9 };

const BARS: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 };

const ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };

const LABEL: React.CSSProperties = { width: 52, flex: 'none', fontWeight: 500 };

const TRACK: React.CSSProperties = {
  flex: 1,
  height: 8,
  borderRadius: 999,
  background: 'rgba(255, 255, 255, 0.18)',
  overflow: 'hidden',
};

const FILL: React.CSSProperties = { display: 'block', height: '100%', borderRadius: 999 };

const WANT: React.CSSProperties = { margin: '6px 0 0', fontWeight: 600, color: LOW };
