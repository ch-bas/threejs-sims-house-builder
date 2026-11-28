// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEYMAP } from '../lib/keymap';
import { closeShortcutsOverlay, isShortcutsOverlayOpen, openShortcutsOverlay, toggleShortcutsOverlay } from '../lib/shortcut-overlay';
import { ShortcutsOverlayHost } from './shortcuts-overlay';

// #932: the `?` overlay shows the key table in a modal; `?`, Escape, the
// close button or the backdrop shut it, and no key reaches the editor behind.

const setPlatform = (platform: string) => Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });

async function openOverlay(): Promise<HTMLElement> {
  render(
    <>
      <button type="button">opener</button>
      <ShortcutsOverlayHost />
    </>
  );
  act(() => openShortcutsOverlay());
  const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
  // The deferred focus move.
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return dialog;
}

const key = (target: Element, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

afterEach(() => {
  act(() => closeShortcutsOverlay());
  cleanup();
  setPlatform('');
});

describe('the shortcut overlay', () => {
  it('toggles from one store', () => {
    expect(isShortcutsOverlayOpen()).toBe(false);
    toggleShortcutsOverlay();
    expect(isShortcutsOverlayOpen()).toBe(true);
    toggleShortcutsOverlay();
    expect(isShortcutsOverlayOpen()).toBe(false);
  });

  it('lists every row of the key table, by context', async () => {
    const dialog = await openOverlay();
    for (const title of ['Editing', 'Drawing walls', 'Walking through']) expect(within(dialog).getByRole('heading', { name: title })).toBeTruthy();
    expect(dialog.querySelectorAll('kbd')).toHaveLength(KEYMAP.length);
    expect(within(dialog).getByText('Show / hide these shortcuts')).toBeTruthy();
  });

  it('shows ⌘ on a Mac and Ctrl elsewhere', async () => {
    setPlatform('MacIntel');
    const mac = await openOverlay();
    expect(mac.textContent).toContain('⌘Z');
    expect(mac.textContent).not.toContain('Ctrl');
    act(() => closeShortcutsOverlay());
    cleanup();
    setPlatform('Win32');
    const other = await openOverlay();
    expect(other.textContent).toContain('Ctrl+Z');
  });

  it('? closes it, but not a held ? still from the press that opened it', async () => {
    const dialog = await openOverlay();
    key(dialog, { key: '?', shiftKey: true, repeat: true });
    expect(isShortcutsOverlayOpen()).toBe(true);
    key(dialog, { key: '?', shiftKey: true });
    expect(isShortcutsOverlayOpen()).toBe(false);
  });

  it('? made with AltGr closes it too, as it opens it; Ctrl+? does not', async () => {
    const dialog = await openOverlay();
    key(dialog, { key: '?', ctrlKey: true });
    expect(isShortcutsOverlayOpen()).toBe(true);
    const altGr = new KeyboardEvent('keydown', { key: '?', ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(altGr, 'getModifierState', { value: (name: string) => name === 'AltGraph' });
    act(() => {
      dialog.dispatchEvent(altGr);
    });
    expect(isShortcutsOverlayOpen()).toBe(false);
  });

  it('Escape closes it and hands focus back', async () => {
    render(<button type="button">back here</button>);
    const back = screen.getByText('back here');
    back.focus();
    const dialog = await openOverlay();
    key(dialog, { key: 'Escape' });
    expect(isShortcutsOverlayOpen()).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(back));
  });

  it('no other key reaches the editor behind it', async () => {
    const editor = vi.fn();
    window.addEventListener('keydown', editor);
    try {
      const dialog = await openOverlay();
      key(dialog, { key: 'Delete' });
      key(dialog, { key: 'z', ctrlKey: true });
      expect(editor).not.toHaveBeenCalled();
      expect(isShortcutsOverlayOpen()).toBe(true);
    } finally {
      window.removeEventListener('keydown', editor);
    }
  });

  it('the close button and the backdrop close it', async () => {
    const dialog = await openOverlay();
    act(() => within(dialog).getByRole('button', { name: 'Close' }).click());
    expect(isShortcutsOverlayOpen()).toBe(false);
    cleanup();
    const again = await openOverlay();
    const backdrop = again.parentElement!;
    act(() => {
      backdrop.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      backdrop.click();
    });
    expect(isShortcutsOverlayOpen()).toBe(false);
  });
});
