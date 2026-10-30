// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { RoomEditorProvider, type RoomEditorContextValue } from '../contexts/room-editor-context';
import { SelectionProvider, type SelectionContextValue } from '../contexts/selection-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { layoutStore } from '../hooks/use-layout-store';
import { autoAnswerConfirms, type AutoAnswer } from '../lib/__testfixtures__/confirm';
import { makeFloor, makeItem, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { cancelPendingConfirms } from '../lib/confirm-dialog';
import { listCustomSets, saveCustomSet } from '../lib/custom-sets';
import { ActionsPanel } from './actions-panel';
import { FloorSwitcher } from './floor-switcher';
import { SetsPanel } from './sets-panel';
import type { RoomLayout } from '../lib/types';

/**
 * Every former `window.confirm` asks through the in-app dialog (#649): the
 * native one is never called, a yes does the edit and a no leaves it alone.
 */
describe('in-app confirms at the call sites (#649)', () => {
  let confirms: AutoAnswer | null = null;
  let nativeConfirm: ReturnType<typeof vi.fn>;

  const answer = (ok: boolean) => {
    confirms = autoAnswerConfirms(ok);
    return confirms;
  };

  beforeEach(() => {
    window.localStorage.clear();
    nativeConfirm = vi.fn(() => true);
    vi.stubGlobal('confirm', nativeConfirm);
  });
  afterEach(() => {
    confirms?.stop();
    confirms = null;
    cancelPendingConfirms();
    cleanup();
    vi.unstubAllGlobals();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  function renderEditor(children: JSX.Element, layout: RoomLayout) {
    const floor = layout.floors[0]!;
    const actions = { replaceItems: vi.fn(), clearItems: vi.fn(), clearInteriorWalls: vi.fn(), setLockAll: vi.fn() };
    const history = { commitNow: vi.fn(), undo: vi.fn() };
    const editor = { layout, activeFloor: floor, activeFloorIndex: 0, actions, history, isReady: true, playCue: vi.fn() } as unknown as RoomEditorContextValue;
    const selection = { selectOnly: vi.fn(), setSelectedItemId: vi.fn(), setExtraSelectedIds: vi.fn() } as unknown as SelectionContextValue;
    const store = createEditorViewStore(makeViewSettings());
    store.getState().actions.setGameMode('build');
    render(
      <EditorViewProvider store={store}>
        <RoomEditorProvider value={editor}>
          <SelectionProvider value={selection}>{children}</SelectionProvider>
        </RoomEditorProvider>
      </EditorViewProvider>
    );
    return { actions, editor };
  }

  const furnished = () =>
    makeLayout({
      floors: [
        makeFloor({
          items: [makeItem({ id: 'a', category: 'seating', position: { x: 0, z: 0 } })],
          interiorWalls: [{ id: 'w', x1: 0, z1: 0, x2: 2, z2: 0 }],
        }),
      ],
    });

  const actionsPanel = () => <ActionsPanel onImport={vi.fn(async () => false)} onExportGlb={vi.fn()} onShareLink={vi.fn()} />;

  it.each([
    ['Clear floor', 'Remove every item from this floor?', 'clearItems'],
    ['Clear interior walls', 'Remove every interior wall on this floor?', 'clearInteriorWalls'],
  ] as const)('%s asks, and acts only on a yes', async (button, title, action) => {
    const no = answer(false);
    const { actions } = renderEditor(actionsPanel(), furnished());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(button) }));
    await waitFor(() => expect(no.asked.map((question) => question.title)).toEqual([title]));
    expect(actions[action]).not.toHaveBeenCalled();
    no.stop();
    answer(true);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(button) }));
    await waitFor(() => expect(actions[action]).toHaveBeenCalledOnce());
  });

  it('Surprise me asks before replacing the furniture', async () => {
    const no = answer(false);
    const { actions } = renderEditor(actionsPanel(), furnished());
    fireEvent.click(screen.getByRole('button', { name: /Surprise me/ }));
    await waitFor(() => expect(no.asked[0]?.title).toBe('Replace the furniture on this floor with a surprise layout?'));
    expect(actions.replaceItems).not.toHaveBeenCalled();
    no.stop();
    answer(true);
    fireEvent.click(screen.getByRole('button', { name: /Surprise me/ }));
    await waitFor(() => expect(actions.replaceItems).toHaveBeenCalledOnce());
  });

  it('deleting a saved set asks first', async () => {
    saveCustomSet([makeItem({ id: 'chair', position: { x: 0, z: 0 } })], 'Reading nook');
    const no = answer(false);
    renderEditor(<SetsPanel onAddSet={vi.fn()} />, furnished());
    const remove = screen.getByRole('button', { name: /Delete set/ });
    fireEvent.click(remove);
    await waitFor(() => expect(no.asked.map((question) => question.title)).toEqual(['Delete set “Reading nook”?']));
    expect(listCustomSets()).toHaveLength(1);
    no.stop();
    answer(true);
    fireEvent.click(remove);
    await waitFor(() => expect(listCustomSets()).toEqual([]));
  });

  it('removing a floor with items asks first; an empty one goes unasked', async () => {
    const layout = makeLayout({
      floors: [makeFloor({ id: 'ground', name: 'Ground' }), makeFloor({ id: 'upper', name: 'Upper', items: [makeItem({ id: 'bed' })] })],
    });
    act(() => {
      layoutStore.setState({ layout, activeFloorIndex: 0 });
    });
    const no = answer(false);
    renderEditor(<FloorSwitcher />, layout);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Upper' }));
    await waitFor(() => expect(no.asked.map((question) => question.title)).toEqual(['Remove “Upper” and its 1 item?']));
    expect(layoutStore.getState().layout.floors).toHaveLength(2);
    no.stop();
    const yes = answer(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Upper' }));
    await waitFor(() => expect(layoutStore.getState().layout.floors.map((floor) => floor.id)).toEqual(['ground']));
    act(() => {
      layoutStore.getState().actions.addFloor();
    });
    fireEvent.click(screen.getAllByRole('button', { name: /^Remove / })[0]!);
    await waitFor(() => expect(layoutStore.getState().layout.floors).toHaveLength(1));
    expect(yes.asked).toHaveLength(1);
  });
});
