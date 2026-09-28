// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDialogFocus } from './use-dialog-focus';

function Harness({ trap = false, onEscape }: { trap?: boolean; onEscape?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(open, ref, { trap, onEscape: onEscape ?? (() => setOpen(false)) });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      <input aria-label="elsewhere" />
      {open && (
        <div ref={ref} role="dialog" tabIndex={-1} aria-label="dialog">
          <button type="button">first</button>
          <button type="button" onClick={() => setOpen(false)}>
            last
          </button>
        </div>
      )}
    </>
  );
}

const key = (k: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
};

const openFrom = (name: string) => {
  const opener = screen.getByRole('button', { name });
  opener.focus();
  act(() => opener.click());
  // Initial focus is deferred past the opening input event.
  act(() => vi.runAllTimers());
  return opener;
};

describe('useDialogFocus (#152)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('takes focus only after the opening input event', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    act(() => opener.click());
    expect(document.activeElement).toBe(opener);
    act(() => vi.runAllTimers());
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('moves focus into the dialog on open', () => {
    render(<Harness />);
    openFrom('opener');
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('restores focus to the opener when the dialog closes', () => {
    render(<Harness />);
    const opener = openFrom('opener');
    act(() => screen.getByRole('button', { name: 'last' }).click());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('does not steal focus back if the user already moved elsewhere', () => {
    const onEscape = vi.fn();
    const { rerender } = render(<Harness onEscape={onEscape} />);
    openFrom('opener');
    const elsewhere = screen.getByRole('textbox', { name: 'elsewhere' });
    elsewhere.focus();
    rerender(<Harness onEscape={onEscape} />);
    act(() => screen.getByRole('button', { name: 'last' }).click());
    expect(document.activeElement).toBe(elsewhere);
  });

  it('traps Tab inside a modal dialog in both directions', () => {
    render(<Harness trap />);
    openFrom('opener');
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'last' });
    last.focus();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('consumes Escape so global shortcuts do not also handle it', () => {
    const onEscape = vi.fn();
    const globalHandler = vi.fn();
    window.addEventListener('keydown', globalHandler);
    render(<Harness onEscape={onEscape} />);
    openFrom('opener');
    key('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(globalHandler).not.toHaveBeenCalled();
    window.removeEventListener('keydown', globalHandler);
  });

  it('leaves Escape alone for a non-modal dialog when focus is outside it', () => {
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    openFrom('opener');
    screen.getByRole('textbox', { name: 'elsewhere' }).focus();
    key('Escape');
    expect(onEscape).not.toHaveBeenCalled();
  });
});
