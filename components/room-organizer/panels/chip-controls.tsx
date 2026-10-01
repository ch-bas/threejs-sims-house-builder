'use client';

import { useState, type ReactNode } from 'react';
import { Icon } from '../plotcraft/icon';

/** Pill action inside a status chip — the multi-select chip's Copy / Group / Save row. */
export function ChipButton({
  children,
  onClick,
  title,
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?(): void;
  title: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
}): JSX.Element {
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        border: '1px solid currentColor',
        borderRadius: 999,
        background: 'transparent',
        color: 'inherit',
        fontFamily: 'var(--pc-font-display)',
        fontWeight: 700,
        fontSize: 10,
        padding: '1px 8px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

export interface ChipNameFieldProps {
  /** Accessible name of the text box, e.g. "Set name". */
  label: string;
  initialValue: string;
  submitLabel: string;
  maxLength?: number;
  onSubmit(name: string): void;
  onCancel(): void;
}

/**
 * Inline name entry for a status chip (#374): the in-app replacement for a
 * `window.prompt`. Enter saves, Escape cancels, and an empty name can't be
 * submitted — so there is no "please enter a name" alert to show.
 */
export function ChipNameField({
  label,
  initialValue,
  submitLabel,
  maxLength = 60,
  onSubmit,
  onCancel,
}: ChipNameFieldProps): JSX.Element {
  const [draft, setDraft] = useState(initialValue);
  const trimmed = draft.trim();
  return (
    <form
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}
    >
      <input
        // Opened by a click: take focus like the dialog it replaces.
        autoFocus
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          // Cancel here, without also deselecting or closing a drawer.
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
        style={{
          width: 150,
          minWidth: 0,
          height: 22,
          padding: '0 8px',
          borderRadius: 999,
          border: '1px solid rgba(255, 255, 255, 0.45)',
          background: 'rgba(0, 0, 0, 0.25)',
          color: 'var(--pc-paper)',
          fontFamily: 'var(--pc-font-body)',
          fontWeight: 600,
          fontSize: 12,
          outline: 'none',
        }}
      />
      <ChipButton type="submit" title={submitLabel} disabled={!trimmed}>
        {submitLabel}
      </ChipButton>
      <button
        type="button"
        aria-label="Cancel"
        title="Cancel"
        onClick={onCancel}
        style={{
          display: 'inline-flex',
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          padding: 2,
          cursor: 'pointer',
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </form>
  );
}
