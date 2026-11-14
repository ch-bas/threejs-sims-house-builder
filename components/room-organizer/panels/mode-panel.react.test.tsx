// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { NOT_WHILE_EXPLORING } from '../hooks/use-exploring';
import { layoutStore } from '../hooks/use-layout-store';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { subscribeNotices, type Notice } from '../lib/editor-notices';
import { ModePanel } from './mode-panel';
import type { GameMode, HardBudget } from '../lib/types';

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

const commitNow = vi.fn();
let notices: Notice[] = [];
let stopNotices: () => void = () => undefined;
beforeEach(() => {
  notices = [];
  stopNotices = subscribeNotices((notice) => notices.push(notice));
});
afterEach(() => {
  stopNotices();
  cleanup();
});

function setup(mode: GameMode, budget?: HardBudget) {
  const layout = makeLayout({ id: 'house-test', ...(budget ? { budget } : {}) });
  layoutStore.setState({ layout, activeFloorIndex: 0 });
  commitNow.mockClear();
  const editor = { layout, history: { canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn(), commitNow } } as unknown as RoomEditorContextValue;
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

describe('the funds field (#609)', () => {
  function field(mode: GameMode, budget: HardBudget = { writeOff: 0 }): HTMLInputElement {
    setup(mode, budget);
    return screen.getByRole('textbox', { name: 'Funds' }) as HTMLInputElement;
  }
  function type(input: HTMLInputElement, text: string, key = 'Enter'): void {
    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(input, { key });
      fireEvent.blur(input);
    });
  }
  const budget = () => layoutStore.getState().layout.budget;

  it('shows only while the hard budget is on', () => {
    setup('buy');
    expect(screen.queryByRole('textbox', { name: 'Funds' })).toBeNull();
  });

  it('shows the funds grouped one fixed way and sets typed ones on Enter, as their own undo step', () => {
    const input = field('buy');
    expect(input.value).toBe('25,000');
    type(input, '$8 000');
    expect(budget()).toEqual({ writeOff: 0, amount: 8000 });
    expect(input.value).toBe('8,000');
    expect(commitNow).toHaveBeenCalledTimes(1);
    expect(notices).toEqual([]);
  });

  it('refuses what is not a plain amount, keeping the funds', () => {
    const input = field('build', { writeOff: 0, amount: 9000 });
    for (const text of ['5k', '1e20', '-300', '8000.5', '30.000']) type(input, text);
    expect(budget()).toEqual({ writeOff: 0, amount: 9000 });
    expect(notices.map((notice) => notice.tone)).toEqual(['error', 'error', 'error', 'error', 'error']);
    expect(notices[0]!.message).toMatch(/plain amount/);
    expect(commitNow).not.toHaveBeenCalled();
  });

  it('says so when it clamps', () => {
    const input = field('build');
    type(input, '999,999,999,999');
    expect(budget()).toEqual({ writeOff: 0, amount: 100_000_000 });
    expect(input.value).toBe('100,000,000');
    expect(notices.at(-1)?.message).toBe('Funds go up to $100,000,000');
    type(input, '5');
    expect(budget()).toEqual({ writeOff: 0, amount: 100 });
    expect(notices.at(-1)?.message).toBe('Funds start at $100');
  });

  it('Escape and an empty field leave the funds alone; a held Enter acts once', () => {
    const input = field('build');
    type(input, '9000', 'Escape');
    type(input, '   ', 'Tab');
    expect(budget()).toEqual({ writeOff: 0 });
    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '9000' } });
      fireEvent.keyDown(input, { key: 'Enter', repeat: true });
    });
    expect(budget()).toEqual({ writeOff: 0 });
  });

  it('is off in EXPLORE', () => {
    expect(field('live').disabled).toBe(true);
  });

  it('a funds edit and its undo float no purchase or sale', () => {
    const input = field('buy');
    type(input, '8000');
    expect(document.querySelector('.pc-funds-delta')).toBeNull();
    act(() => {
      layoutStore.setState({ layout: makeLayout({ id: 'house-test', budget: { writeOff: 0 } }), activeFloorIndex: 0 });
    });
    expect(document.querySelector('.pc-funds-delta')).toBeNull();
    act(() => {
      layoutStore.setState({ layout: makeLayout({ id: 'house-test', budget: { writeOff: 40 } }), activeFloorIndex: 0 });
    });
    expect(document.querySelector('.pc-funds-delta')?.textContent).toBe('−$40');
  });
});
