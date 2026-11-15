// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { dismissFirstSteps, resetFirstStepsForTests, useFirstStepsAsked, useFirstStepsOffered } from '../hooks/use-first-steps';
import { makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { FIRST_STEPS_STORAGE_KEY } from '../lib/first-steps';
import { VIEW_OPTION_KEYS } from '../lib/view-options';
import { ViewOptionsMenu } from './view-options';

function setup(onClose = vi.fn()) {
  const store = createEditorViewStore(makeViewSettings());
  render(
    <EditorViewProvider store={store}>
      <ViewOptionsMenu id="menu" anchorRef={createRef<HTMLElement>()} onClose={onClose} />
    </EditorViewProvider>
  );
  return { latest: () => store.getState().view, store, onClose };
}

describe('ViewOptionsMenu (#341)', () => {
  afterEach(cleanup);

  it('has a switch for every View-menu key, each of which flips its setting', () => {
    const { latest } = setup();
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(VIEW_OPTION_KEYS.length);
    for (const [index, key] of VIEW_OPTION_KEYS.entries()) {
      const before = latest()[key];
      fireEvent.click(switches[index]!);
      expect(latest()[key]).toBe(!before);
      expect(screen.getAllByRole('switch')[index]!.getAttribute('aria-checked')).toBe(String(!before));
    }
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

  it('picks the length unit (#725), one radio checked at a time', () => {
    const { store } = setup();
    const units = screen.getByRole('radiogroup', { name: 'Length units' });
    const imperial = screen.getByRole('radio', { name: 'Feet and inches' });
    expect(units.contains(imperial)).toBe(true);
    expect(screen.getByRole('radio', { name: 'Metres' }).getAttribute('aria-checked')).toBe('true');
    try {
      fireEvent.click(imperial);
      expect(store.getState().lengthUnit).toBe('imperial');
      expect(imperial.getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('radio', { name: 'Metres' }).getAttribute('aria-checked')).toBe('false');
    } finally {
      store.getState().actions.setLengthUnit('metric');
      localStorage.clear();
    }
  });

  it('Help reopens the Getting started card, dismissed or never offered, and shows the version (#931)', () => {
    localStorage.clear();
    resetFirstStepsForTests();
    dismissFirstSteps();
    let offered = false;
    let asked = false;
    function Probe(): null {
      offered = useFirstStepsOffered();
      asked = useFirstStepsAsked();
      return null;
    }
    const { onClose } = setup();
    render(<Probe />);
    expect(offered).toBe(false);
    expect(screen.getByRole('button', { name: 'Getting started' }).title).toMatch(/version \d+\.\d+\.\d+/);
    fireEvent.click(screen.getByRole('button', { name: 'Getting started' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(offered).toBe(true);
    // Asked for: it mounts even over a house kept from a shared link.
    expect(asked).toBe(true);
    expect(JSON.parse(localStorage.getItem(FIRST_STEPS_STORAGE_KEY)!).card).toBe('offered');
    localStorage.clear();
    resetFirstStepsForTests();
  });
});
