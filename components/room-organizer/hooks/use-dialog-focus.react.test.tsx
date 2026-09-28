// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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

function Stacked() {
  const [drawer, setDrawer] = useState(true);
  const [popover, setPopover] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const welcomeRef = useRef<HTMLDivElement>(null);
  // flushSync mirrors the browser, where React applies these updates in a
  // microtask BETWEEN two document listeners of the same keydown — so a
  // dialog that just closed must not hand the same event to the next one.
  useDialogFocus(drawer, drawerRef, { trap: true, onEscape: () => flushSync(() => setDrawer(false)) });
  useDialogFocus(popover, popoverRef);
  useDialogFocus(welcome, welcomeRef, { trap: true, onEscape: () => flushSync(() => setWelcome(false)) });
  return (
    <>
      {drawer && (
        <div ref={drawerRef} role="dialog" aria-modal="true" aria-label="drawer" tabIndex={-1}>
          <button type="button" onClick={() => setPopover(true)}>
            add
          </button>
          <button type="button" onClick={() => setWelcome(true)}>
            open welcome
          </button>
        </div>
      )}
      {popover && (
        <div ref={popoverRef} role="dialog" aria-label="popover" tabIndex={-1}>
          <button type="button">tile</button>
        </div>
      )}
      {welcome && (
        <div ref={welcomeRef} role="dialog" aria-modal="true" aria-label="welcome" tabIndex={-1}>
          <button type="button">ok</button>
        </div>
      )}
    </>
  );
}

describe('useDialogFocus — stacked overlays (#152 review)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a popover opened from inside a modal does not pull focus out of it, and one Escape closes only the modal', () => {
    render(<Stacked />);
    act(() => vi.runAllTimers());
    const add = screen.getByRole('button', { name: 'add' });
    add.focus();
    act(() => add.click());
    act(() => vi.runAllTimers());
    expect(screen.getByRole('dialog', { name: 'popover' })).toBeTruthy();
    expect(document.activeElement).toBe(add);

    key('Escape');
    expect(screen.queryByRole('dialog', { name: 'drawer' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'popover' })).toBeTruthy();
  });

  it('with two modals open, Escape closes only the one holding focus', () => {
    render(<Stacked />);
    act(() => vi.runAllTimers());
    const opener = screen.getByRole('button', { name: 'open welcome' });
    opener.focus();
    act(() => opener.click());
    act(() => vi.runAllTimers());
    // Focus stays in the drawer, the modal that already held it.
    expect(document.activeElement).toBe(opener);

    key('Escape');
    expect(screen.queryByRole('dialog', { name: 'drawer' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'welcome' })).toBeTruthy();

    // With focus no longer in any dialog, the remaining modal owns Escape.
    key('Escape');
    expect(screen.queryByRole('dialog', { name: 'welcome' })).toBeNull();
  });
});

function DrawerWithRename() {
  const [drawer, setDrawer] = useState(true);
  const [renaming, setRenaming] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(drawer, ref, { trap: true, onEscape: () => flushSync(() => setDrawer(false)) });
  if (!drawer) return <p>drawer closed</p>;
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="drawer" tabIndex={-1}>
      {renaming ? (
        <input
          aria-label="floor name"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              flushSync(() => setRenaming(false));
            }
          }}
        />
      ) : (
        <p>rename cancelled</p>
      )}
    </div>
  );
}

describe('useDialogFocus — Escape handled by a control inside (#152 review)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('cancelling an inline edit with Escape does not also close the modal', () => {
    render(<DrawerWithRename />);
    act(() => vi.runAllTimers());
    screen.getByRole('textbox', { name: 'floor name' }).focus();
    key('Escape');
    expect(screen.getByText('rename cancelled')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'drawer' })).toBeTruthy();
  });
});
