// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from '../contexts/selection-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { NOT_WHILE_EXPLORING } from '../hooks/use-exploring';
import { makeFloor, makeItem, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { ActionsPanel } from './actions-panel';
import { FloorPill } from './floor-pill';
import { TemplatesPanel } from './templates-panel';
import type { GameMode } from '../lib/types';

const EDITS = ['Pack', 'By cat', 'By size', 'Surprise me', 'Lock all', 'Clear floor', 'Clear interior walls', 'Import'];

function setup(mode: GameMode) {
  const floor = makeFloor({
    items: [makeItem({ id: 'a', position: { x: 0, z: 0 } })],
    interiorWalls: [{ id: 'w', x1: 0, z1: 0, x2: 2, z2: 0 }],
  });
  const layout = makeLayout({ floors: [floor] });
  const actions = { replaceItems: vi.fn(), clearItems: vi.fn(), setLockAll: vi.fn(), clearInteriorWalls: vi.fn(), addFloor: vi.fn() };
  const editor = { layout, activeFloor: floor, activeFloorIndex: 0, actions, isReady: true, playCue: vi.fn() } as unknown as RoomEditorContextValue;
  const selection = { selectOnly: vi.fn(), setSelectedItemId: vi.fn(), setExtraSelectedIds: vi.fn() } as unknown as SelectionContextValue;
  const store = createEditorViewStore(makeViewSettings());
  store.getState().actions.setGameMode(mode);
  const onLoadTemplate = vi.fn(() => true);
  render(
    <EditorViewProvider store={store}>
      <RoomEditorProvider value={editor}>
        <SelectionProvider value={selection}>
          <FloorPill />
          <ActionsPanel onImport={vi.fn(async () => false)} onExportGlb={vi.fn()} onShareLink={vi.fn()} />
          <TemplatesPanel onLoadTemplate={onLoadTemplate} />
        </SelectionProvider>
      </RoomEditorProvider>
    </EditorViewProvider>
  );
  const button = (name: string) => screen.getByRole('button', { name: new RegExp(name) }) as HTMLButtonElement;
  return { actions, button, onLoadTemplate };
}

describe('house edits in EXPLORE (#643)', () => {
  afterEach(cleanup);

  it('are off, with a hint, while exploring; the exports stay on', () => {
    const { actions, button } = setup('live');
    for (const name of EDITS) {
      expect(button(name).disabled, name).toBe(true);
      expect(button(name).title, name).toBe(NOT_WHILE_EXPLORING);
    }
    expect(button('Add floor').disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Load a template' }) as HTMLSelectElement).disabled).toBe(true);
    expect(button('JSON').disabled).toBe(false);
    fireEvent.click(button('Pack'));
    fireEvent.click(button('Add floor'));
    expect(actions.replaceItems).not.toHaveBeenCalled();
    expect(actions.addFloor).not.toHaveBeenCalled();
  });

  it('work in DESIGN', () => {
    const { actions, button } = setup('build');
    for (const name of EDITS) expect(button(name).disabled, name).toBe(false);
    expect((screen.getByRole('combobox', { name: 'Load a template' }) as HTMLSelectElement).disabled).toBe(false);
    fireEvent.click(button('Add floor'));
    expect(actions.addFloor).toHaveBeenCalledTimes(1);
  });
});
