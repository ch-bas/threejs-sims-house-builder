'use client';

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { useEvent } from '../hooks/use-event';
import { useMediaQuery } from '../hooks/use-media-query';
import { usePausableTimeout } from '../hooks/use-pausable-timeout';
import { COMPACT_OVERLAY_QUERY, statusToastInSlot, toastsHeldBack } from '../lib/overlay-queue';
import { Icon } from '../plotcraft/icon';
import { OverlayStackPortal } from './overlay-stack';
import type { Achievement } from '../lib/achievements';

const AUTO_DISMISS_MS = 4500;
/** A queued phone toast is shorter-lived: the next one is waiting. */
const COMPACT_DISMISS_MS = 3500;
/** Gap between the desktop toast and the mode panel under it. */
const MODE_PANEL_GAP = 12;

/**
 * Whether the phone dock's ⋯ tray is open. It grows upward from the bottom,
 * and in landscape its value rows reach the toast slot under the top pills,
 * so a toast waits while it is open.
 */
function subscribeTrayOpen(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-more-open'] });
  return () => observer.disconnect();
}
function trayOpen(): boolean {
  return document.querySelector('.pc-mode-panel[data-more-open]') !== null;
}

/** Room left between the toast and the item popover beside it. */
const POPOVER_GAP = 12;

function subscribeDom(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { subtree: true, childList: true });
  window.addEventListener('resize', onChange);
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', onChange);
  };
}
const noSubscription = (): (() => void) => () => {};

export interface AchievementToastProps {
  pending: readonly Achievement[];
  onDismiss(): void;
  /**
   * The sidebar drawer is open: its scrim covers the scene, so the desktop
   * toast is drawn above the scrim (and below the drawer, on the other side).
   */
  drawerOpen?: boolean;
}

/**
 * One achievement at a time, the rest queued behind it, each with a timer of
 * its own (#461): a burst of unlocks plays out one by one instead of
 * stacking up and restarting every countdown on each new unlock.
 *
 * Phones and short screens show it in the shared toast slot under the top
 * pills (#510): it steps aside while a status notice holds the slot, and its
 * timer pauses whenever it is off screen (that, the dock's ⋯ tray being
 * open, or the stack holding toasts back to clear the item sheet), then
 * resumes with the time it had left.
 *
 * Desktop and tablet show it bottom-right, just above the mode panel
 * (`--pc-mode-top`), never over the mode buttons or Undo/Redo, and under the
 * View menu that opens upward from it. When the item popover reaches down
 * to it (short screens), it steps left of the popover. Hovering it holds the
 * countdown.
 */
export function AchievementToast({ pending, onDismiss, drawerOpen = false }: AchievementToastProps): JSX.Element | null {
  const compact = useMediaQuery(COMPACT_OVERLAY_QUERY);
  // Achievements already shown, by id; cleared with the queue. One host for
  // both placements, so rotating across the breakpoint carries on with the
  // toast on screen instead of replaying the ones before it.
  const [seen] = useState(() => new Set<string>());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [hovered, setHovered] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const statusBusy = useSyncExternalStore(statusToastInSlot.subscribe, statusToastInSlot.get, () => false);
  const heldBack = useSyncExternalStore(toastsHeldBack.subscribe, toastsHeldBack.get, () => false);
  const dockTrayOpen = useSyncExternalStore(subscribeTrayOpen, trayOpen, () => false);
  const waiting = pending.filter((achievement) => !seen.has(achievement.id));
  const current = waiting[0];
  const empty = pending.length === 0;
  useEffect(() => {
    if (empty) seen.clear();
  }, [empty, seen]);

  const finish = useEvent(() => {
    if (!current) return;
    seen.add(current.id);
    setHovered(false);
    if (waiting.length <= 1) onDismiss();
    else rerender();
  });
  const running = compact ? !statusBusy && !heldBack && !dockTrayOpen : !hovered;
  usePausableTimeout(current?.id ?? null, running, compact ? COMPACT_DISMISS_MS : AUTO_DISMISS_MS, finish);

  // Everything pending was shown already: clear the queue.
  const drained = !empty && !current;
  useEffect(() => {
    if (drained) onDismiss();
  }, [drained, onDismiss]);

  // Desktop only, and only while a toast is up: the item popover's left edge
  // when it reaches down into the toast's band, so the toast steps aside.
  const avoiding = !compact && current !== undefined;
  const popoverLeft = useCallback((): number | null => {
    const popover = document.querySelector('.pc-item-popover');
    const host = hostRef.current;
    if (!popover) return null;
    const box = popover.getBoundingClientRect();
    const modeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pc-mode-top'));
    const bandTop = (Number.isFinite(modeTop) ? modeTop : window.innerHeight) - MODE_PANEL_GAP - (host?.offsetHeight ?? 0);
    return box.bottom > bandTop ? Math.round(box.left) : null;
  }, []);
  const avoidLeft = useSyncExternalStore(
    avoiding ? subscribeDom : noSubscription,
    avoiding ? popoverLeft : () => null,
    () => null
  );

  if (!current) return null;

  if (compact) {
    if (statusBusy || dockTrayOpen) return null;
    return (
      <OverlayStackPortal slot="toast">
        <AchievementCard
          key={current.id}
          achievement={current}
          onDismiss={finish}
          compact
          queued={waiting.length - 1}
        />
      </OverlayStackPortal>
    );
  }

  return (
    <div
      ref={hostRef}
      style={{
        position: 'fixed',
        right: avoidLeft === null ? 16 : `calc(100vw - ${avoidLeft - POPOVER_GAP}px)`,
        bottom: `calc(100dvh - var(--pc-mode-top, calc(100dvh - 282px)) + ${MODE_PANEL_GAP}px)`,
        // Under the bottom HUD (25), so the View menu opening upward from
        // the mode panel is drawn over the toast, never under it. With the
        // drawer open, above its scrim (35) and below the drawer (40).
        zIndex: drawerOpen ? 38 : 24,
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <AchievementCard
        key={current.id}
        achievement={current}
        onDismiss={finish}
        queued={waiting.length - 1}
      />
    </div>
  );
}

function AchievementCard({
  achievement,
  onDismiss,
  compact = false,
  queued = 0,
}: {
  achievement: Achievement;
  onDismiss(): void;
  compact?: boolean;
  /** Achievements still waiting behind this one (compact only). */
  queued?: number;
}): JSX.Element {
  return (
    <div
      className="pc-glass pc-glass--dark pc-halo-pulse pointer-events-auto"
      role="status"
      style={{
        display: 'flex',
        alignItems: compact ? 'center' : 'flex-start',
        gap: compact ? 10 : 12,
        padding: compact ? '7px 10px' : '12px 14px',
        maxWidth: compact ? '100%' : 320,
        ...(compact ? { borderRadius: 16 } : {}),
      }}
    >
      <div
        aria-hidden
        style={{
          height: compact ? 28 : 36,
          width: compact ? 28 : 36,
          borderRadius: compact ? 8 : 10,
          background: 'rgba(127,243,255,0.20)',
          border: '1px solid var(--pc-cyan-glow)',
          color: 'var(--pc-cyan-glow)',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
        }}
      >
        <Icon name="sparkle" size={compact ? 14 : 18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          className="pc-hud-header"
          style={{ fontSize: 9, margin: 0, opacity: 0.85 }}
        >
          Achievement Unlocked
          {queued > 0 && ` · ${queued} more`}
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
        {compact ? null : (
          <p
            className="pc-blurb"
            style={{ margin: '2px 0 0', fontSize: 11, lineHeight: 1.35 }}
          >
            {achievement.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="pc-tile"
        style={{
          // A finger-sized target on touch screens.
          width: compact ? 32 : 24,
          height: compact ? 32 : 24,
          borderRadius: compact ? 8 : 6,
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
  );
}
