// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from '../contexts/selection-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { NOT_WHILE_EXPLORING } from '../hooks/use-exploring';
import { makeItem, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { ItemContextPopover } from './item-context-popover';
import { ItemResizePanel } from './item-resize-panel';
import type { FurnitureItem, GameMode } from '../lib/types';

function renderEditor(editor: 'popover' | 'panel', item: FurnitureItem, mode: GameMode = 'build') {
  const actions = {
    toggleMirror: vi.fn(),
    setSofaShape: vi.fn(),
    resizeItem: vi.fn(),
    setLocked: vi.fn(),
    moveItem: vi.fn(),
    setColor: vi.fn(),
    updateItem: vi.fn(),
    setSignalRange: vi.fn(),
    setStairsShape: vi.fn(),
    setSillHeight: vi.fn(),
  };
  const callbacks = { onRemove: vi.fn(), onDuplicate: vi.fn(), onRotate: vi.fn(), onToggleCameraBracket: vi.fn(), onClose: vi.fn() };
  const store = createEditorViewStore(makeViewSettings());
  store.getState().actions.setGameMode(mode);
  const editorValue = { actions, recentColors: [], pushColor: () => {} } as unknown as RoomEditorContextValue;
  const selection = {
    selectedItemId: item.id,
    setSelectedItemId: () => {},
    selectedItem: item,
    extraSelectedIds: new Set<string>(),
    setExtraSelectedIds: () => {},
    allSelectedIds: new Set([item.id]),
    selectOnly: () => {},
  } as SelectionContextValue;
  render(
    <EditorViewProvider store={store}>
    <RoomEditorProvider value={editorValue}>
      <SelectionProvider value={selection}>
        {editor === 'popover' ? (
          <ItemContextPopover collision={null} {...callbacks} />
        ) : (
          <ItemResizePanel collision={null} onDuplicate={() => {}} />
        )}
      </SelectionProvider>
    </RoomEditorProvider>
    </EditorViewProvider>
  );
  return Object.assign(actions, callbacks);
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }) as unknown as MediaQueryList
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('item editors: a locked sofa offers no reshape (#636)', () => {
  const sofa = makeItem({ id: 's', type: 'sofa', name: 'Sofa', sofaShape: 'standard', locked: true });

  it('the popover disables Mirror and the Std/L/U row', () => {
    const actions = renderEditor('popover', sofa);
    const mirror = screen.getByRole('button', { name: 'Mirror' });
    expect(mirror).toHaveProperty('disabled', true);
    expect(mirror.getAttribute('title')).toBe('Locked — unlock to mirror');
    const shapes = screen.getByRole('group', { name: 'Sofa' });
    for (const button of shapes.querySelectorAll('button')) expect(button.disabled).toBe(true);
    fireEvent.click(mirror);
    expect(actions.toggleMirror).not.toHaveBeenCalled();
  });

  it('the Style panel disables Mirror and the shape select', () => {
    renderEditor('panel', sofa);
    expect(screen.getByRole('button', { name: /Mirror/ })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Sofa Shape')).toHaveProperty('disabled', true);
  });

  it('an unlocked sofa keeps both live', () => {
    renderEditor('popover', { ...sofa, locked: false });
    expect(screen.getByRole('button', { name: 'Mirror' })).toHaveProperty('disabled', false);
  });
});

describe('item editors: the size sliders reach tall catalogue items (#547)', () => {
  const pine = makeItem({ id: 'p', type: 'pine-tree', name: 'Pine Tree', height: 4.5, width: 1.6, depth: 1.6 });

  const heightSlider = (): HTMLInputElement => {
    const sliders = screen.getAllByRole('slider') as HTMLInputElement[];
    const found = sliders.find((slider) => Number(slider.value) > 4);
    if (!found) throw new Error(`no slider at the tree's height: ${sliders.map((s) => s.value).join(', ')}`);
    return found;
  };

  it.each(['popover', 'panel'] as const)('the %s shows a Pine Tree at 4.5 m, not pinned at 3 m', (editor) => {
    renderEditor(editor, pine);
    expect(heightSlider().value).toBe('4.5');
  });

  it('a shrunk tree can grow back to its catalogue height', () => {
    renderEditor('panel', { ...pine, height: 2 });
    const sliders = screen.getAllByRole('slider') as HTMLInputElement[];
    expect(sliders.some((slider) => slider.max === '4.5')).toBe(true);
  });
});

describe('item popover in EXPLORE (#699)', () => {
  const editable = (): HTMLElement[] =>
    [...screen.getByRole('dialog').querySelectorAll<HTMLElement>('button, input, select')].filter(
      (el) => !['Close', 'Show all options', 'Show fewer options'].includes(el.getAttribute('aria-label') ?? '')
    );

  it.each([
    ['a sofa', makeItem({ id: 's', type: 'sofa', name: 'Sofa', sofaShape: 'standard' })],
    ['stairs', makeItem({ id: 't', type: 'stairs', name: 'Stairs', stairsShape: 'winder' })],
    ['a window', makeItem({ id: 'w', type: 'window', name: 'Window' })],
    ['a camera', makeItem({ id: 'c', type: 'security-camera', name: 'Camera', isCCTV: true })],
    ['an access point', makeItem({ id: 'ap', type: 'wifi', name: 'Wi-Fi AP', isWiFiAccessPoint: true })],
  ])('turns off every control that edits %s, with the hint', (_label, item) => {
    const calls = renderEditor('popover', item, 'live');
    expect(screen.getByRole('note').textContent).toContain(NOT_WHILE_EXPLORING);
    const controls = editable();
    expect(controls.length).toBeGreaterThan(8);
    for (const control of controls) {
      expect(control.matches(':disabled'), control.getAttribute('aria-label') ?? control.textContent ?? '').toBe(true);
      // A browser sends no input to a disabled control; clicks are the
      // event jsdom would still deliver, so they must do nothing either.
      fireEvent.click(control);
    }
    for (const [name, fn] of Object.entries(calls)) {
      if (name === 'onClose') continue;
      expect(fn, name).not.toHaveBeenCalled();
    }
    // Close and the sheet handle stay: looking around isn't editing.
    expect(screen.getByRole('button', { name: 'Close' })).toHaveProperty('disabled', false);
  });

  it('names EXPLORE, not the lock, as the reason', () => {
    renderEditor('popover', makeItem({ id: 's', type: 'sofa', name: 'Sofa', locked: true }), 'live');
    expect(screen.getByRole('button', { name: 'Rotate' }).getAttribute('title')).toBe(NOT_WHILE_EXPLORING);
    expect(screen.getByRole('button', { name: 'Unlock' }).getAttribute('title')).toBe(NOT_WHILE_EXPLORING);
  });

  it('leaves the controls on in FURNISH', () => {
    const calls = renderEditor('popover', makeItem({ id: 's', type: 'sofa', name: 'Sofa' }), 'buy');
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Demolish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(calls.onRemove).toHaveBeenCalledWith('s');
    expect(calls.onDuplicate).toHaveBeenCalledWith('s');
  });
});

describe('the locked note in the popover (#635)', () => {
  it('says why the actions are off, for a locked item only', () => {
    renderEditor('popover', makeItem({ id: 'a', locked: true }));
    expect(screen.getByRole('note').textContent).toContain('Press U or Unlock');
    cleanup();
    renderEditor('popover', makeItem({ id: 'b' }));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('gives way to the EXPLORE note', () => {
    renderEditor('popover', makeItem({ id: 'a', locked: true }), 'live');
    expect(screen.getByRole('note').textContent).toContain(NOT_WHILE_EXPLORING);
  });
});
