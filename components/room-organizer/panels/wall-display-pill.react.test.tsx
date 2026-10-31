// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { WallDisplayPill } from './wall-display-pill';
import type { ViewSettings } from '../lib/types';

function setup(view: Partial<ViewSettings>) {
  const store = createEditorViewStore(makeViewSettings(view));
  render(
    <EditorViewProvider store={store}>
      <WallDisplayPill />
    </EditorViewProvider>
  );
  return { latest: () => store.getState().view };
}

const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(name) });

describe('WallDisplayPill', () => {
  afterEach(cleanup);

  it('switches the wall display in 3D', () => {
    const { latest } = setup({ wallDisplay: 'up' });
    fireEvent.click(radio('Down'));
    expect(latest().wallDisplay).toBe('down');
    expect(radio('Down').getAttribute('aria-checked')).toBe('true');
  });

  it('is one tab stop: the checked radio (#646)', () => {
    setup({ wallDisplay: 'cutaway' });
    expect(['Up', 'Cut', 'Down'].map((name) => radio(name).tabIndex)).toEqual([-1, 0, -1]);
  });

  it('arrow keys move the check and the focus, wrapping, and stay off the window (#646)', () => {
    const { latest } = setup({ wallDisplay: 'down' });
    const onWindow = vi.fn();
    window.addEventListener('keydown', onWindow);
    radio('Down').focus();
    fireEvent.keyDown(radio('Down'), { key: 'ArrowRight' });
    expect(latest().wallDisplay).toBe('up');
    expect(document.activeElement).toBe(radio('Up'));
    fireEvent.keyDown(radio('Up'), { key: 'ArrowUp' });
    expect(latest().wallDisplay).toBe('down');
    fireEvent.keyDown(radio('Down'), { key: 'ArrowLeft' });
    expect(latest().wallDisplay).toBe('cutaway');
    window.removeEventListener('keydown', onWindow);
    expect(onWindow).not.toHaveBeenCalled();
  });

  it('is one tab stop: the checked radio (#646)', () => {
    setup({ wallDisplay: 'cutaway' });
    expect(['Up', 'Cut', 'Down'].map((name) => radio(name).tabIndex)).toEqual([-1, 0, -1]);
  });

  it('arrow keys move the check and the focus, wrapping, and stay off the window (#646)', () => {
    const { latest } = setup({ wallDisplay: 'down' });
    const onWindow = vi.fn();
    window.addEventListener('keydown', onWindow);
    radio('Down').focus();
    fireEvent.keyDown(radio('Down'), { key: 'ArrowRight' });
    expect(latest().wallDisplay).toBe('up');
    expect(document.activeElement).toBe(radio('Up'));
    fireEvent.keyDown(radio('Up'), { key: 'ArrowUp' });
    expect(latest().wallDisplay).toBe('down');
    fireEvent.keyDown(radio('Down'), { key: 'ArrowLeft' });
    expect(latest().wallDisplay).toBe('cutaway');
    window.removeEventListener('keydown', onWindow);
    expect(onWindow).not.toHaveBeenCalled();
  });

  it('is off while walking: the walls stay up and say so (#643)', () => {
    const { latest } = setup({ wallDisplay: 'down', walkthroughMode: true });
    for (const name of ['Up', 'Cut', 'Down']) {
      expect((radio(name) as HTMLButtonElement).disabled).toBe(true);
      expect(radio(name).getAttribute('title')).toMatch(/walls stay up while walking/);
    }
    // What the scene shows: every wall up.
    expect(radio('Up').getAttribute('aria-checked')).toBe('true');
    expect(radio('Down').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(radio('Cut'));
    expect(latest().wallDisplay).toBe('down');
  });
});
