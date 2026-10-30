// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askConfirm, cancelPendingConfirms, confirmOpen } from '../lib/confirm-dialog';
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

const flush = async () => {
  await act(async () => {
    vi.runAllTimers();
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

  it('is an accessible modal named by its question, focused on the confirm button', async () => {
    await open();
    const dialog = screen.getByRole('alertdialog', { name: 'Delete set “Nook”?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
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
    fireEvent.click(screen.getByRole('alertdialog').parentElement!);
    await flush();
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  it('traps Tab inside the dialog', async () => {
    await open();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
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
    void askConfirm({ title: 'First?' }).then((ok) => answers.push(`first:${ok}`));
    void askConfirm({ title: 'Second?' }).then((ok) => answers.push(`second:${ok}`));
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
});
