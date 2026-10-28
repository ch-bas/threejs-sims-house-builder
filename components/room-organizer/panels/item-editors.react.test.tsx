// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from '../contexts/selection-context';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { ItemContextPopover } from './item-context-popover';
import { ItemResizePanel } from './item-resize-panel';
import type { FurnitureItem } from '../lib/types';

function renderEditor(editor: 'popover' | 'panel', item: FurnitureItem) {
  const actions = { toggleMirror: vi.fn(), setSofaShape: vi.fn(), resizeItem: vi.fn() };
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
    <RoomEditorProvider value={editorValue}>
      <SelectionProvider value={selection}>
        {editor === 'popover' ? (
          <ItemContextPopover
            hasCollision={false}
            onRemove={() => {}}
            onDuplicate={() => {}}
            onRotate={() => {}}
            onToggleCameraBracket={() => {}}
            onClose={() => {}}
          />
        ) : (
          <ItemResizePanel hasCollision={false} onDuplicate={() => {}} />
        )}
      </SelectionProvider>
    </RoomEditorProvider>
  );
  return actions;
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
