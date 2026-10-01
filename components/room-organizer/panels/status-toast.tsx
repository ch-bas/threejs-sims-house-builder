'use client';

import { useCallback, useEffect, useState } from 'react';
import { noticeDuration, subscribeNotices, type Notice, type NoticeTone } from '../lib/editor-notices';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';

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

  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  useEffect(
    () =>
      subscribeNotices((notice) => {
        setNotices((current) => [notice, ...current].slice(0, MAX_VISIBLE));
      }),
    []
  );

  if (notices.length === 0) return null;

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
