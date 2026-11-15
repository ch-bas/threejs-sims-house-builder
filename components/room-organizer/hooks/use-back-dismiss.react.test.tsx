// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACK_LAYER, backDismissSupported, resetBackDismiss, useBackDismiss } from './use-back-dismiss';
import { useDialogFocus } from './use-dialog-focus';

/** A stand-in for Chromium's CloseWatcher: `back()` is the system gesture. */
class FakeCloseWatcher {
  static live: FakeCloseWatcher[] = [];
  static created = 0;
  onclose: ((event: Event) => void) | null = null;
  constructor() {
    FakeCloseWatcher.created += 1;
    FakeCloseWatcher.live.push(this);
  }
  destroy(): void {
    FakeCloseWatcher.live = FakeCloseWatcher.live.filter((watcher) => watcher !== this);
  }
  /** The browser closes the newest watcher on back. */
  static back(): void {
    const top = FakeCloseWatcher.live.at(-1);
    if (!top) return;
    top.destroy();
    top.onclose?.(new Event('close'));
  }
}

function Surface({ layer, initiallyOpen = true, label, closes = true, onBack }: {
  layer: number;
  initiallyOpen?: boolean;
  label: string;
  closes?: boolean;
  onBack?: () => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  useBackDismiss(open, layer, () => {
    onBack?.();
    if (closes) setOpen(false);
  });
  return (
    <button type="button" onClick={() => setOpen((was) => !was)}>
      {label}: {open ? 'open' : 'closed'}
    </button>
  );
}

const back = async () => {
  await act(async () => {
    FakeCloseWatcher.back();
    // The hook makes the next watcher on a zero timeout.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  FakeCloseWatcher.live = [];
  FakeCloseWatcher.created = 0;
  vi.stubGlobal('CloseWatcher', FakeCloseWatcher);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetBackDismiss();
});

describe('useBackDismiss (#926)', () => {
  it('holds no watcher while the surface is closed, one while open', () => {
    const { getByRole } = render(<Surface layer={BACK_LAYER.drawer} initiallyOpen={false} label="drawer" />);
    expect(FakeCloseWatcher.live).toHaveLength(0);
    act(() => getByRole('button').click());
    expect(FakeCloseWatcher.live).toHaveLength(1);
    act(() => getByRole('button').click());
    expect(FakeCloseWatcher.live).toHaveLength(0);
  });

  it('back closes the open surface', async () => {
    const { getByRole } = render(<Surface layer={BACK_LAYER.drawer} label="drawer" />);
    await back();
    expect(getByRole('button').textContent).toBe('drawer: closed');
    expect(FakeCloseWatcher.live).toHaveLength(0);
  });

  it('keeps one watcher, for the top layer, whatever opened last', async () => {
    const order: string[] = [];
    const { getByText } = render(
      <>
        <Surface layer={BACK_LAYER.drawer} label="drawer" onBack={() => order.push('drawer')} />
        <Surface layer={BACK_LAYER.itemSheet} label="sheet" onBack={() => order.push('sheet')} />
      </>
    );
    expect(FakeCloseWatcher.live).toHaveLength(1);
    await back();
    expect(order).toEqual(['drawer']);
    expect(getByText('sheet: open')).toBeTruthy();
    expect(FakeCloseWatcher.live).toHaveLength(1);
    await back();
    expect(order).toEqual(['drawer', 'sheet']);
    expect(FakeCloseWatcher.live).toHaveLength(0);
  });

  it('a surface that stays open after back keeps a watcher for the next back', async () => {
    const onBack = vi.fn();
    render(<Surface layer={BACK_LAYER.drawer} label="drawer" closes={false} onBack={onBack} />);
    await back();
    await back();
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(FakeCloseWatcher.live).toHaveLength(1);
  });

  it('ignores the close request Chromium makes from an Escape keydown', async () => {
    const onBack = vi.fn();
    render(<Surface layer={BACK_LAYER.drawer} label="drawer" closes={false} onBack={onBack} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await back();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('changes nothing where the browser has no CloseWatcher', async () => {
    vi.unstubAllGlobals();
    expect(backDismissSupported()).toBe(false);
    const { getByRole } = render(<Surface layer={BACK_LAYER.drawer} label="drawer" />);
    expect(getByRole('button').textContent).toBe('drawer: open');
    expect(FakeCloseWatcher.created).toBe(0);
  });
});

/** A dialog as `useDialogFocus` runs it: Escape (and so back) calls `onEscape`. */
function Dialog({ label, backLayer, onEscape }: { label: string; backLayer?: number; onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(true, ref, { onEscape, trap: true, ...(backLayer === undefined ? {} : { backLayer }) });
  return (
    <div ref={ref} role="dialog" aria-label={label} tabIndex={-1}>
      <button type="button">{label} button</button>
    </div>
  );
}

describe('back and the dialogs useDialogFocus runs (#926 review)', () => {
  it('a confirm asked from the drawer hears back first, as Cancel, and the drawer waits', async () => {
    const calls: string[] = [];
    function Editor() {
      const [drawer, setDrawer] = useState(true);
      const [confirm, setConfirm] = useState(false);
      return (
        <>
          {drawer && (
            <Dialog label="drawer" backLayer={BACK_LAYER.drawer} onEscape={() => { calls.push('drawer'); setDrawer(false); }} />
          )}
          {confirm && <Dialog label="confirm" onEscape={() => { calls.push('cancel'); setConfirm(false); }} />}
          <button type="button" onClick={() => setConfirm(true)}>ask</button>
        </>
      );
    }
    const { getByText, queryByRole } = render(<Editor />);
    act(() => getByText('ask').click());
    expect(FakeCloseWatcher.live).toHaveLength(1);
    await back();
    expect(calls).toEqual(['cancel']);
    expect(queryByRole('dialog', { name: 'drawer' })).not.toBeNull();
    expect(FakeCloseWatcher.live).toHaveLength(1);
    await back();
    expect(calls).toEqual(['cancel', 'drawer']);
    expect(FakeCloseWatcher.live).toHaveLength(0);
  });

  it('a dialog over the item sheet takes back before the sheet, even opened first', async () => {
    const calls: string[] = [];
    function Screen() {
      const [welcome, setWelcome] = useState(true);
      const [sheet, setSheet] = useState(false);
      useBackDismiss(sheet, BACK_LAYER.itemSheet, () => { calls.push('sheet'); setSheet(false); });
      return (
        <>
          {welcome && <Dialog label="welcome" onEscape={() => { calls.push('welcome'); setWelcome(false); }} />}
          <button type="button" onClick={() => setSheet(true)}>select</button>
        </>
      );
    }
    const { getByText } = render(<Screen />);
    act(() => getByText('select').click());
    await back();
    expect(calls).toEqual(['welcome']);
    await back();
    expect(calls).toEqual(['welcome', 'sheet']);
  });

  it('a dialog without an Escape action takes no watcher', () => {
    function Plain() {
      const ref = useRef<HTMLDivElement>(null);
      useDialogFocus(true, ref);
      return <div ref={ref} tabIndex={-1} />;
    }
    render(<Plain />);
    expect(FakeCloseWatcher.live).toHaveLength(0);
  });
});
