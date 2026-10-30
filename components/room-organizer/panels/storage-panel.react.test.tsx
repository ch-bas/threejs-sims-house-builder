// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { autoAnswerConfirms, type AutoAnswer } from '../lib/__testfixtures__/confirm';
import { makeFloor, makeItem, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { createBackup } from '../lib/backup';
import { listSavedLayouts, loadNamedLayout, saveNamedLayout } from '../lib/library';
import { listSnapshots, recordSnapshot } from '../lib/version-history';
import { StoragePanel } from './storage-panel';
import type { GameMode, RoomLayout } from '../lib/types';

function house(name: string, items: number): RoomLayout {
  return makeLayout({
    id: `id-${name}`,
    name,
    floors: [makeFloor({ items: Array.from({ length: items }, (_, i) => makeItem({ id: `${name}${i}`, position: { x: i, z: 0 } })) })],
  });
}

function setup(mode: GameMode = 'build') {
  const store = createEditorViewStore(makeViewSettings());
  store.getState().actions.setGameMode(mode);
  const onStorageChanged = vi.fn();
  render(
    <EditorViewProvider store={store}>
      <StoragePanel currentLayout={house('Current', 2)} onStorageChanged={onStorageChanged} />
    </EditorViewProvider>
  );
  const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
  return { button, onStorageChanged };
}

async function chooseFile(text: string): Promise<void> {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    fireEvent.change(input);
    await Promise.resolve();
  });
}

describe('storage card (#615, #620)', () => {
  let answers: AutoAnswer | null = null;
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    answers?.stop();
    answers = null;
    cleanup();
    vi.restoreAllMocks();
  });

  it('meters what is stored and lists each saved layout with a delete', () => {
    saveNamedLayout(house('Cottage', 3), 'Cottage');
    setup();
    expect(screen.getByRole('meter', { name: 'Browser storage used' })).toBeTruthy();
    expect(screen.getByText('Saved layouts', { selector: 'span' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete saved layout Cottage' })).toBeTruthy();
  });

  it('deletes a saved layout and every restore point only after a yes to a danger question', async () => {
    saveNamedLayout(house('Cottage', 3), 'Cottage');
    recordSnapshot(house('Cottage', 3), { force: true });
    answers = autoAnswerConfirms(false);
    const { button, onStorageChanged } = setup();
    await act(async () => {
      fireEvent.click(button(/Delete saved layout Cottage/));
      fireEvent.click(button(/Delete all restore points/));
      await Promise.resolve();
    });
    expect(listSavedLayouts()).toHaveLength(1);
    expect(listSnapshots()).toHaveLength(1);
    expect(answers.asked.map((request) => request.danger)).toEqual([true, true]);
    answers.stop();

    answers = autoAnswerConfirms(true);
    await act(async () => {
      fireEvent.click(button(/Delete saved layout Cottage/));
      fireEvent.click(button(/Delete all restore points/));
      await Promise.resolve();
    });
    await waitFor(() => expect(listSavedLayouts()).toHaveLength(0));
    expect(listSnapshots()).toHaveLength(0);
    expect(onStorageChanged).toHaveBeenCalledTimes(2);
  });

  it('restore asks first, says what the file holds, and only adds', async () => {
    saveNamedLayout(house('Cottage', 8), 'Cottage');
    const before = loadNamedLayout(listSavedLayouts()[0]!.id);
    localStorage.clear();
    saveNamedLayout(house('Cottage', 3), 'Cottage');
    const text = JSON.stringify({ ...createBackup(house('Backed up', 4)), library: [{ name: 'Cottage', savedAt: 1, layout: before }] });
    answers = autoAnswerConfirms(true);
    const { onStorageChanged } = setup();
    await chooseFile(text);
    await waitFor(() => expect(onStorageChanged).toHaveBeenCalled());
    expect(answers.asked).toHaveLength(1);
    expect(answers.asked[0]!.body).toContain('a house, 1 saved layout');
    expect(answers.asked[0]!.body).toContain('never replaces or deletes your houses, sets or settings');
    const names = listSavedLayouts().map((entry) => entry.name).sort();
    expect(names).toEqual(['Backed up (backup)', 'Cottage', 'Cottage (backup)']);
  });

  it('a no to the restore question writes nothing', async () => {
    answers = autoAnswerConfirms(false);
    setup();
    await chooseFile(JSON.stringify(createBackup(house('Backed up', 4))));
    await waitFor(() => expect(answers?.asked).toHaveLength(1));
    expect(listSavedLayouts()).toEqual([]);
  });

  it('restoring is off while exploring; backing up stays on', () => {
    const { button } = setup('live');
    expect(button(/Restore…/).disabled).toBe(true);
    expect(button(/Back up all/).disabled).toBe(false);
  });
});
