'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import { useMediaQuery } from '../hooks/use-media-query';
import { usePausableTimeout } from '../hooks/use-pausable-timeout';
import { noticeDuration, subscribeNotices, type Notice, type NoticeTone } from '../lib/editor-notices';
import {
  COMPACT_OVERLAY_QUERY,
  enqueueKeepingHead,
  enqueueNewestFirst,
  HEADER_HIDDEN_QUERY,
  MAX_QUEUED_NOTICES,
  queueHead,
  replaceInSlot,
  statusToastInSlot,
  toastsHeldBack,
} from '../lib/overlay-queue';
import { isTypingTarget } from '../lib/walk-input';
import { Icon, type PlotcraftIconName } from '../plotcraft/icon';
import { OverlayStackPortal } from './overlay-stack';

/** When each notice was raised; one shown later than this waited in the queue. */
const raisedAt = new WeakMap<Notice, number>();
const ANSWERS_THE_ASKER_MS = 500;

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
        raisedAt.set(notice, Date.now());
        // A single slot never drops the notice on screen (the oldest).
        setNotices((current) =>
          compactRef.current
            ? (replaceInSlot(current, notice) ?? enqueueKeepingHead(current, notice, MAX_QUEUED_NOTICES))
            : enqueueNewestFirst(current, notice, MAX_VISIBLE)
        );
      }),
    []
  );

  // Achievements wait while a timed notice holds the single slot. A notice
  // that stays until dismissed (a link to copy by hand) is more like an alert:
  // achievements show under it rather than queue behind it indefinitely.
  const head = queueHead(notices);
  const holdsSlot = compact && head !== undefined && noticeDuration(head) !== null;
  useEffect(() => {
    statusToastInSlot.set(holdsSlot);
    return () => statusToastInSlot.set(false);
  }, [holdsSlot]);

  if (notices.length === 0) return null;

  if (stacked) {
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

  // Paused while the overlay stack holds toasts back to clear the item
  // sheet, so a notice never expires unseen.
  const heldBack = useSyncExternalStore(toastsHeldBack.subscribe, toastsHeldBack.get, () => false);
  // A notice with a button waits while the pointer or the focus is on it,
  // so it never closes under the hand reaching for "Undo" (#651).
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const engaged = notice.action !== undefined && (hovered || focused);
  usePausableTimeout(notice.id, !heldBack && !engaged, duration, () => onDismiss(notice.id));

  // The link to copy by hand is the whole point of this notice: focus lands on
  // it, selected, even from inside the drawer; Escape puts it away and focus
  // goes back to the control that asked (#632).
  const toastRef = useRef<HTMLDivElement>(null);
  const copyFieldRef = useRef<HTMLInputElement>(null);
  // Any other notice closing under the focus (Undo, Dismiss) hands it back to
  // where it came from, not to <body> (#638).
  const focusCameFrom = useRef<HTMLElement | null>(null);
  // A layout effect runs while the notice is still in the document, so it can
  // tell whether focus is really inside. A text field stays put on touch: its
  // keyboard would pop up.
  useLayoutEffect(() => {
    const toast = toastRef.current;
    return () => {
      const from = focusCameFrom.current;
      if (!from?.isConnected || !toast?.contains(document.activeElement)) return;
      if (isTypingTarget(from) && window.matchMedia('(pointer: coarse)').matches) return;
      from.focus({ preventScroll: true });
    };
  }, []);
  // One that waited in the queue has no asker left to answer: Tab reaches it.
  const [justAsked] = useState(() => Date.now() - (raisedAt.get(notice) ?? 0) < ANSWERS_THE_ASKER_MS);
  useDialogFocus(notice.copyText !== undefined && justAsked, toastRef, {
    initialFocusRef: copyFieldRef,
    onEscape: () => onDismiss(notice.id),
    takeFocus: true,
  });

  return (
    <div
      ref={toastRef}
      data-focus-companion={notice.action !== undefined || notice.copyText !== undefined ? '' : undefined}
      className="pc-glass pc-glass--dark pc-status-toast"
      role={notice.tone === 'error' ? 'alert' : 'status'}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={(event) => {
        setFocused(true);
        const from = event.relatedTarget;
        if (from instanceof HTMLElement && !event.currentTarget.contains(from)) focusCameFrom.current = from;
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
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
        {notice.action !== undefined && (
          <button
            type="button"
            // Several notices can each offer "Undo": say which one (#651).
            aria-label={`${notice.action.label}: ${notice.message}`}
            onClick={() => {
              // Close first: the action may raise a notice of its own.
              onDismiss(notice.id);
              notice.action?.run();
            }}
            style={{
              flexShrink: 0,
              height: 22,
              padding: '0 10px',
              borderRadius: 999,
              border: '1px solid rgba(255, 255, 255, 0.45)',
              background: 'rgba(255, 255, 255, 0.12)',
              color: 'var(--pc-paper)',
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 700,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {notice.action.label}
          </button>
        )}
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
          ref={copyFieldRef}
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
