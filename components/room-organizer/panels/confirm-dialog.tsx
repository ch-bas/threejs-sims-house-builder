'use client';

import { useRef, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import { answerConfirm, currentConfirm, subscribeConfirm, type ConfirmRequest } from '../lib/confirm-dialog';
import { Icon } from '../plotcraft/icon';

/**
 * Shows `askConfirm()` questions (#649) as an in-app modal, one at a time,
 * instead of the native `window.confirm`. Mounted once by the orchestrator,
 * above the drawer, so a question asked from inside it holds the keyboard.
 */
export function ConfirmDialogHost(): JSX.Element | null {
  const request = useSyncExternalStore(subscribeConfirm, currentConfirm, () => null);
  if (!request) return null;
  // Keyed: the next queued question is a fresh dialog with fresh focus.
  return <ConfirmDialog key={request.id} request={request} />;
}

function ConfirmDialog({ request }: { request: ConfirmRequest }): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const answer = (ok: boolean) => answerConfirm(request.id, ok);

  // Focus moves to the confirm button, Tab stays inside, Escape cancels and
  // focus returns to the control that asked once the dialog closes.
  useDialogFocus(true, dialogRef, {
    initialFocusRef: confirmRef,
    onEscape: () => answer(false),
    trap: true,
    takeFocus: true,
  });

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Escape and Tab belong to useDialogFocus (a document listener).
    if (event.key === 'Escape' || event.key === 'Tab') return;
    // Nothing else reaches the editor's window shortcuts while asking: a
    // Delete or Ctrl+Z behind the question would change what it asks about.
    event.stopPropagation();
    // Enter on a focused button presses that button; anywhere else it confirms.
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      answer(true);
    }
  };

  const titleId = `pc-confirm-title-${request.id}`;
  const bodyId = `pc-confirm-body-${request.id}`;
  const accent = request.danger ? 'var(--pc-demolish-ink)' : 'var(--pc-cyan-glow)';

  return (
    <div
      data-confirm-dialog=""
      onClick={() => answer(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 30, 40, 0.45)',
        display: 'grid',
        placeItems: 'center',
        // Above the drawer (40), the welcome modal (60) and every toast.
        zIndex: 70,
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(request.body !== null ? { 'aria-describedby': bodyId } : {})}
        tabIndex={-1}
        className="pc-glass pc-glass--dark"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width: 'min(420px, 100%)',
          maxHeight: 'calc(100dvh - 32px)',
          overflowY: 'auto',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <Icon name={request.danger ? 'warn' : 'target'} size={18} style={{ color: accent, flexShrink: 0, marginTop: 2 }} />
          <p
            id={titleId}
            style={{
              margin: 0,
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 700,
              fontSize: 15,
              lineHeight: 1.35,
              color: 'var(--pc-paper)',
              overflowWrap: 'anywhere',
            }}
          >
            {request.title}
          </p>
        </div>
        {request.body !== null && (
          <p id={bodyId} className="pc-body" style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--pc-paper-soft)' }}>
            {request.body}
          </p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="pc-tile" onClick={() => answer(false)} style={BUTTON}>
            {request.cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={request.danger ? 'pc-tile' : 'pc-tile pc-tile--active'}
            onClick={() => answer(true)}
            style={
              request.danger
                ? { ...BUTTON, color: 'var(--pc-demolish-ink)', borderColor: 'var(--pc-demolish)' }
                : BUTTON
            }
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const BUTTON: React.CSSProperties = {
  minWidth: 88,
  minHeight: 36,
  padding: '8px 14px',
  borderRadius: 12,
  fontFamily: 'var(--pc-font-display)',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};
