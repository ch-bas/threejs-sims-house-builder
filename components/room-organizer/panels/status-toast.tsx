'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../hooks/use-media-query';
import { noticeDuration, subscribeNotices, type Notice, type NoticeTone } from '../lib/editor-notices';
import {
  COMPACT_OVERLAY_QUERY,
  enqueueNewestFirst,
  HEADER_HIDDEN_QUERY,
  MAX_QUEUED_NOTICES,
  queueHead,
  statusToastInSlot,
} from '../lib/overlay-queue';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import { OverlayStackPortal } from './overlay-stack';

/** The newest few stay visible; older ones drop off the end. */
const MAX_VISIBLE = 3;

const TONES: Record<NoticeTone, { color: string; icon: PlotcraftIconName }> = {
  info: { color: 'var(--pc-sky)', icon: 'target' },
  success: { color: 'var(--pc-confirm-green)', icon: 'sparkle' },
  error: { color: 'var(--pc-warn-amber)', icon: 'warn' },
};

/**
 * Renders `notify()` messages (#374) — export and share outcomes, failed
 * uploads and imports — as glass chips under the header, instead of blocking
 * `window.alert` dialogs. Mounted once by the orchestrator.
 */
export function StatusToastHost(): JSX.Element | null {
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  // Phones and short screens: one notice at a time in the shared slot under
  // the top pills, the rest queued. Wherever the header stats are hidden the
  // notices join the overlay stack, under the save-failed notice (#385).
  const compact = useMediaQuery(COMPACT_OVERLAY_QUERY);
  const stacked = useMediaQuery(HEADER_HIDDEN_QUERY);
  const compactRef = useRef(compact);
  compactRef.current = compact;

  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  useEffect(
    () =>
      subscribeNotices((notice) => {
        const limit = compactRef.current ? MAX_QUEUED_NOTICES : MAX_VISIBLE;
        setNotices((current) => enqueueNewestFirst(current, notice, limit));
      }),
    []
  );

  // Achievements wait while a notice holds the single slot.
  const holdsSlot = compact && notices.length > 0;
  useEffect(() => {
    statusToastInSlot.set(holdsSlot);
    return () => statusToastInSlot.set(false);
  }, [holdsSlot]);

  if (notices.length === 0) return null;

  if (stacked) {
    const head = queueHead(notices);
    const shown = compact ? (head ? [head] : []) : notices.slice(0, MAX_VISIBLE);
    return (
      <OverlayStackPortal slot="toast">
        {shown.map((notice) => (
          <StatusToast key={notice.id} notice={notice} onDismiss={dismiss} />
        ))}
      </OverlayStackPortal>
    );
  }

  return (
    <div
      className="pc-status-toasts"
      style={{
        position: 'absolute',
        top: 148,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 45,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        width: 'max-content',
        maxWidth: 'calc(100vw - 32px)',
        pointerEvents: 'none',
      }}
    >
      {notices.map((notice) => (
        <StatusToast key={notice.id} notice={notice} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function StatusToast({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss(id: number): void;
}): JSX.Element {
  const tone = TONES[notice.tone];
  const duration = noticeDuration(notice);

  useEffect(() => {
    if (duration === null) return undefined;
    const timer = window.setTimeout(() => onDismiss(notice.id), duration);
    return () => window.clearTimeout(timer);
  }, [duration, notice.id, onDismiss]);

  return (
    <div
      className="pc-glass pc-glass--dark"
      role={notice.tone === 'error' ? 'alert' : 'status'}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '7px 10px 7px 12px',
        borderRadius: 16,
        maxWidth: '100%',
        fontFamily: 'var(--pc-font-display)',
        fontWeight: 600,
        fontSize: 12,
        color: 'var(--pc-paper)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name={tone.icon} size={14} style={{ color: tone.color, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>{notice.message}</span>
        <button
          type="button"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => onDismiss(notice.id)}
          style={{
            display: 'inline-flex',
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            color: 'var(--pc-paper-soft)',
            padding: 2,
            cursor: 'pointer',
          }}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      {notice.copyText !== undefined && (
        <input
          readOnly
          aria-label="Link to copy"
          value={notice.copyText}
          onFocus={(event) => event.target.select()}
          style={{
            width: 320,
            maxWidth: '100%',
            height: 24,
            padding: '0 8px',
            borderRadius: 999,
            border: '1px solid rgba(255, 255, 255, 0.45)',
            background: 'rgba(0, 0, 0, 0.25)',
            color: 'var(--pc-paper)',
            fontFamily: 'var(--pc-font-body)',
            fontSize: 11,
          }}
        />
      )}
    </div>
  );
}
