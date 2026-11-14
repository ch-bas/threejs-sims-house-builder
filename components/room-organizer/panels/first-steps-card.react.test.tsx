// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { offerFirstSteps, resetFirstStepsForTests } from '../hooks/use-first-steps';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { FirstStepsCard } from './first-steps-card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const selectOnly = vi.fn();
const armKeyboard = vi.fn();
const armGhost = vi.fn();
vi.mock('../contexts', async (original) => ({
  ...(await original<typeof import('../contexts')>()),
  useSelection: () => ({ selectOnly }),
}));
vi.mock('../hooks/use-keyboard-placement', () => ({
  armKeyboardPlacement: () => armKeyboard(),
  armGhostPlacement: () => armGhost(),
}));

beforeEach(() => {
  window.localStorage.clear();
  resetFirstStepsForTests();
  selectOnly.mockClear();
  armKeyboard.mockClear();
  armGhost.mockClear();
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => cleanup());

function setup() {
  const layout = makeLayout({ id: 'house-test' });
  const editor = { layout, isReady: true, error: null } as unknown as RoomEditorContextValue;
  const store = createEditorViewStore(makeViewSettings());
  const place = vi.fn(() => 'door-new');
  act(() => offerFirstSteps());
  render(
    <EditorViewProvider store={store}>
      <RoomEditorProvider value={editor}>
        <div className="pc-mode-panel">
          <button type="button">Hard budget</button>
          <button type="button" aria-pressed="true">
            Design
          </button>
        </div>
        <FirstStepsCard placeCatalogItem={place} onShareLink={() => Promise.resolve()} onSelectedWallChange={vi.fn()} />
      </RoomEditorProvider>
    </EditorViewProvider>
  );
  return { place };
}

describe('Getting started card (#721)', () => {
  it('is titled apart from the First Steps achievement', () => {
    setup();
    expect(screen.getByRole('region', { name: 'Getting started' })).toBeTruthy();
  });

  it('from the keyboard, the Door step places a door through keyboard placement and selects it', () => {
    const { place } = setup();
    // A click with detail 0 is what Enter or Space on a button fires.
    fireEvent.click(screen.getByRole('button', { name: 'Door' }), { detail: 0 });
    expect(armKeyboard).toHaveBeenCalledTimes(1);
    expect(armGhost).not.toHaveBeenCalled();
    expect(place).toHaveBeenCalledWith(expect.objectContaining({ type: 'door' }));
    expect(selectOnly).toHaveBeenCalledWith('door-new');
  });

  it('from a pointer, the Door step picks up a ghost', () => {
    const { place } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Door' }), { detail: 1 });
    expect(armGhost).toHaveBeenCalledTimes(1);
    expect(armKeyboard).not.toHaveBeenCalled();
    expect(place).toHaveBeenCalledTimes(1);
    expect(selectOnly).not.toHaveBeenCalled();
  });

  it('a held Enter is swallowed, so it cannot fire the step again', () => {
    setup();
    const door = screen.getByRole('button', { name: 'Door' });
    const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true });
    door.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    const first = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    door.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(false);
  });

  it("dismissing moves focus to the current mode's button", () => {
    setup();
    const close = screen.getByRole('button', { name: 'Dismiss getting started' });
    close.focus();
    fireEvent.click(close);
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull();
    expect(document.activeElement?.textContent).toBe('Design');
  });
});
