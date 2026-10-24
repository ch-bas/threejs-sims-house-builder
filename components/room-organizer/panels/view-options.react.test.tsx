// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { layoutStore } from '../hooks/use-layout-store';
import { makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { VIEW_OPTION_KEYS } from '../lib/view-options';
import { ViewOptionsMenu } from './view-options';

function setup(onClose = vi.fn()) {
  const store = createEditorViewStore(makeViewSettings());
  render(
    <EditorViewProvider store={store}>
      <ViewOptionsMenu id="menu" anchorRef={createRef<HTMLElement>()} onClose={onClose} />
    </EditorViewProvider>
  );
  return { latest: () => store.getState().view, onClose };
}

describe('ViewOptionsMenu (#341)', () => {
  afterEach(cleanup);

  it('has a switch for every View-menu key, each of which flips its setting', () => {
    const { latest } = setup();
    // Every switch but the last (the hard budget, layout state) is a view key.
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(VIEW_OPTION_KEYS.length + 1);
    for (const [index, key] of VIEW_OPTION_KEYS.entries()) {
      const before = latest()[key];
      fireEvent.click(switches[index]!);
      expect(latest()[key]).toBe(!before);
      expect(screen.getAllByRole('switch')[index]!.getAttribute('aria-checked')).toBe(String(!before));
    }
  });

  it('the Hard budget switch turns the house\'s hard budget on and off (#463e)', () => {
    setup();
    const toggle = screen.getByRole('switch', { name: /Hard budget/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(layoutStore.getState().layout.budget).toEqual({ writeOff: 0 });
    expect(screen.getByRole('switch', { name: /Hard budget/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('switch', { name: /Hard budget/ }));
    expect(layoutStore.getState().layout.budget).toBeUndefined();
  });

  it('closes on Escape and on a press outside, not on a press inside', () => {
    const { onClose } = setup();
    fireEvent.pointerDown(screen.getByRole('switch', { name: /Snap to walls/ }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
