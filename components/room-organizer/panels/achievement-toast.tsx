'use client';

import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
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

export interface AchievementToastProps {
  pending: readonly Achievement[];
  onDismiss(): void;
}

interface HostProps extends AchievementToastProps {
  /** Achievements already on screen, by id (see AchievementToast). */
  seen: Set<string>;
}

export function AchievementToast(props: AchievementToastProps): JSX.Element | null {
  const compact = useMediaQuery(COMPACT_OVERLAY_QUERY);
  // Rotating across the compact breakpoint swaps hosts; this record outlives
  // them, so neither replays what the other already showed. Cleared with the
  // queue.
  const [seen] = useState(() => new Set<string>());
  const empty = props.pending.length === 0;
  useEffect(() => {
    if (empty) seen.clear();
  }, [empty, seen]);
  return compact ? (
    <CompactAchievementToast {...props} seen={seen} />
  ) : (
    <StackedAchievementToasts {...props} seen={seen} />
  );
}

/** Desktop and tablet: every pending achievement, stacked bottom-right. */
function StackedAchievementToasts({ pending, onDismiss, seen }: HostProps): JSX.Element | null {
  // Shown on a compact screen before a rotation: not again.
  const [shownBefore] = useState(() => new Set(seen));
  const visible = pending.filter((achievement) => !shownBefore.has(achievement.id));
  useEffect(() => {
    for (const achievement of visible) seen.add(achievement.id);
  });
  const nothingNew = visible.length === 0;
  useEffect(() => {
    if (pending.length === 0) return undefined;
    if (nothingNew) {
      onDismiss();
      return undefined;
    }
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [pending, onDismiss, nothingNew]);

  if (nothingNew) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 pointer-events-none"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {visible.map((achievement) => (
        <AchievementCard key={achievement.id} achievement={achievement} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/**
 * Phones and short screens: one achievement at a time in the shared toast
 * slot under the top pills, the rest queued. It steps aside while a status
 * notice holds the slot, and its timer pauses whenever it is off screen
 * (that, or the stack holding toasts back to clear the item sheet), then
 * resumes with the time it had left.
 */
function CompactAchievementToast({ pending, onDismiss, seen }: HostProps): JSX.Element | null {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const statusBusy = useSyncExternalStore(statusToastInSlot.subscribe, statusToastInSlot.get, () => false);
  const heldBack = useSyncExternalStore(toastsHeldBack.subscribe, toastsHeldBack.get, () => false);
  const waiting = pending.filter((achievement) => !seen.has(achievement.id));
  const current = waiting[0];

  const finish = useEvent(() => {
    if (!current) return;
    seen.add(current.id);
    if (waiting.length <= 1) onDismiss();
    else rerender();
  });
  usePausableTimeout(current?.id ?? null, !statusBusy && !heldBack, COMPACT_DISMISS_MS, finish);

  // Everything pending was shown before a rotation: clear the queue.
  const drained = pending.length > 0 && !current;
  useEffect(() => {
    if (drained) onDismiss();
  }, [drained, onDismiss]);

  if (!current || statusBusy) return null;

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
      className="pc-glass pc-glass--dark pointer-events-auto"
      role="status"
      style={{
        display: 'flex',
        alignItems: compact ? 'center' : 'flex-start',
        gap: compact ? 10 : 12,
        padding: compact ? '7px 10px' : '12px 14px',
        maxWidth: compact ? '100%' : 320,
        animation: 'pcHaloPulse 1.6s ease-in-out infinite',
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
