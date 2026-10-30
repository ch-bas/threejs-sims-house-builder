// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_GRACE_MS, askConfirm, cancelPendingConfirms, confirmOpen, type ConfirmOptions } from '../lib/confirm-dialog';
import { ConfirmDialogHost } from './confirm-dialog';

function Harness({ onAnswer }: { onAnswer(answer: boolean): void }) {
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void askConfirm({ title: 'Delete set “Nook”?', body: 'It can’t be undone.', confirmLabel: 'Delete', danger: true }).then(onAnswer);
        }}
      >
        opener
      </button>
      <ConfirmDialogHost />
    </>
  );
}

/** Runs the deferred focus, then waits out the dialog's opening grace. */
const flush = async () => {
  await act(async () => {
    vi.runAllTimers();
    vi.advanceTimersByTime(CONFIRM_GRACE_MS);
    await Promise.resolve();
  });
};

/** Only the deferred focus: still inside the opening grace. */
const focusOnly = async () => {
  await act(async () => {
    vi.advanceTimersByTime(1);
    await Promise.resolve();
  });
};

const press = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
};

async function open(onAnswer = vi.fn<(answer: boolean) => void>()) {
  render(<Harness onAnswer={onAnswer} />);
  const opener = screen.getByRole('button', { name: 'opener' });
  opener.focus();
  act(() => opener.click());
  await flush();
  return { opener, onAnswer };
}

describe('ConfirmDialogHost (#649)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cancelPendingConfirms();
    cleanup();
    vi.useRealTimers();
  });

  it('is an accessible modal named by its question; a destructive one starts on Cancel', async () => {
    await open();
    const dialog = screen.getByRole('alertdialog', { name: 'Delete set “Nook”?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirmOpen()).toBe(true);
  });

  it('Enter confirms and focus returns to the opener', async () => {
    const { opener, onAnswer } = await open();
    // Enter on the dialog body (not a button) confirms.
    screen.getByRole('alertdialog').focus();
    press('Enter');
    await flush();
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(confirmOpen()).toBe(false);
  });

  it('Escape cancels', async () => {
    const { opener, onAnswer } = await open();
    press('Escape');
    await flush();
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(opener);
  });

  it('the buttons and the backdrop answer', async () => {
    const { onAnswer } = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(onAnswer).toHaveBeenLastCalledWith(false);
    act(() => screen.getByRole('button', { name: 'opener' }).click());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await flush();
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    act(() => screen.getByRole('button', { name: 'opener' }).click());
    await flush();
    fireEvent.pointerDown(screen.getByRole('alertdialog').parentElement!);
    fireEvent.click(screen.getByRole('alertdialog').parentElement!);
    await flush();
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  it('traps Tab inside the dialog', async () => {
    await open();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    confirm.focus();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('keeps every other key from the editor’s window shortcuts', async () => {
    await open();
    const shortcut = vi.fn();
    window.addEventListener('keydown', shortcut);
    try {
      press('Delete');
      press('z', { ctrlKey: true });
      expect(shortcut).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', shortcut);
    }
  });

  it('takes focus from the drawer it was asked from, and gives it back', async () => {
    const onAnswer = vi.fn<(answer: boolean) => void>();
    render(
      <>
        <div role="dialog" aria-modal="true" aria-label="Side panels">
          <button
            type="button"
            onClick={() => {
              void askConfirm({ title: 'Remove it?' }).then(onAnswer);
            }}
          >
            remove
          </button>
        </div>
        <ConfirmDialogHost />
      </>
    );
    const opener = screen.getByRole('button', { name: 'remove' });
    opener.focus();
    act(() => opener.click());
    await flush();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'OK' }));
    press('Escape');
    await flush();
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(opener);
  });

  it('shows queued questions one at a time, oldest first', async () => {
    render(<ConfirmDialogHost />);
    const answers: string[] = [];
    act(() => {
      void askConfirm({ title: 'First?' }).then((ok) => answers.push(`first:${ok}`));
      void askConfirm({ title: 'Second?' }).then((ok) => answers.push(`second:${ok}`));
    });
    await flush();
    expect(screen.getByRole('alertdialog', { name: 'First?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await flush();
    expect(screen.getByRole('alertdialog', { name: 'Second?' })).toBeTruthy();
    press('Escape');
    await flush();
    expect(answers).toEqual(['first:true', 'second:false']);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  describe('never answered unseen', () => {
    const ask = (options: Partial<ConfirmOptions> = {}) => {
      const answers: boolean[] = [];
      act(() => {
        void askConfirm({ title: 'Clear it?', confirmLabel: 'Clear', ...options }).then((ok) => answers.push(ok));
      });
      return answers;
    };

    it('a plain question starts on its confirm button; `focus` can pick Cancel', async () => {
      render(<ConfirmDialogHost />);
      ask();
      await flush();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear' }));
      press('Escape');
      await flush();
      ask({ focus: 'cancel', cancelLabel: 'Keep mine' });
      await flush();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep mine' }));
    });

    it('a held Enter (auto-repeat) never confirms (F2)', async () => {
      render(<ConfirmDialogHost />);
      const answers = ask();
      await flush();
      const repeat = press('Enter', { repeat: true });
      await flush();
      expect(repeat.defaultPrevented).toBe(true);
      expect(answers).toEqual([]);
      expect(screen.getByRole('alertdialog')).toBeTruthy();
    });

    it('ignores Enter, the buttons and the backdrop just after opening (F2, F3)', async () => {
      render(<ConfirmDialogHost />);
      const answers = ask();
      await focusOnly();
      screen.getByRole('alertdialog').focus();
      press('Enter');
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      const backdrop = screen.getByRole('alertdialog').parentElement!;
      fireEvent.pointerDown(backdrop);
      fireEvent.click(backdrop);
      await focusOnly();
      expect(answers).toEqual([]);
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      await flush();
      expect(answers).toEqual([true]);
    });

    it('a backdrop click counts only when the press started on the backdrop (F3)', async () => {
      render(<ConfirmDialogHost />);
      const answers = ask();
      await flush();
      const backdrop = screen.getByRole('alertdialog').parentElement!;
      // The release of a press that began elsewhere (the second click of a double-click).
      fireEvent.click(backdrop);
      await flush();
      expect(answers).toEqual([]);
      fireEvent.pointerDown(backdrop);
      fireEvent.click(backdrop);
      await flush();
      expect(answers).toEqual([false]);
    });

    it('a question that must be answered keeps its backdrop inert', async () => {
      render(<ConfirmDialogHost />);
      const answers = ask({ backdropCancels: false });
      await flush();
      const backdrop = screen.getByRole('alertdialog').parentElement!;
      fireEvent.pointerDown(backdrop);
      fireEvent.click(backdrop);
      await flush();
      expect(answers).toEqual([]);
    });

    it('unmounting the host cancels what it was asking (F7)', async () => {
      const view = render(<ConfirmDialogHost />);
      const answers = ask();
      await flush();
      view.unmount();
      await flush();
      expect(answers).toEqual([false]);
      expect(confirmOpen()).toBe(false);
    });
  });
});
