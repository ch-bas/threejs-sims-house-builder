// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { NOT_WHILE_EXPLORING } from '../hooks/use-exploring';
import { layoutStore } from '../hooks/use-layout-store';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { ModePanel } from './mode-panel';
import type { GameMode } from '../lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

function setup(mode: GameMode) {
  const layout = makeLayout({ id: 'house-test' });
  layoutStore.setState({ layout, activeFloorIndex: 0 });
  const editor = { layout, history: { canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn() } } as unknown as RoomEditorContextValue;
  const store = createEditorViewStore(makeViewSettings());
  store.getState().actions.setGameMode(mode);
  render(
    <EditorViewProvider store={store}>
      <RoomEditorProvider value={editor}>
        <ModePanel onSetMode={vi.fn()} onSurprise={vi.fn()} />
      </RoomEditorProvider>
    </EditorViewProvider>
  );
  return screen.getByRole('switch', { name: 'Hard budget' }) as HTMLButtonElement;
}

describe('the Hard budget switch (#700)', () => {
  it('is off, with the hint, in EXPLORE and leaves the house alone', () => {
    const toggle = setup('live');
    act(() => {
      fireEvent.click(toggle);
    });
    expect(toggle.disabled).toBe(true);
    expect(toggle.title).toBe(NOT_WHILE_EXPLORING);
    expect(layoutStore.getState().layout.budget).toBeUndefined();
  });

  it('switches the hard budget in DESIGN and FURNISH', () => {
    for (const mode of ['build', 'buy'] as const) {
      const toggle = setup(mode);
      expect(toggle.disabled).toBe(false);
      act(() => {
        fireEvent.click(toggle);
      });
      expect(layoutStore.getState().layout.budget).toEqual({ writeOff: 0 });
      cleanup();
    }
  });
});
