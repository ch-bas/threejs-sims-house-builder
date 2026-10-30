// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { makeFloor, makeItem, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { createBackup } from '../lib/backup';
import { listSavedLayouts, saveNamedLayout } from '../lib/library';
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
  const onRestoreHouse = vi.fn();
  const onStorageChanged = vi.fn();
  render(
    <EditorViewProvider store={store}>
      <StoragePanel currentLayout={house('Current', 2)} onRestoreHouse={onRestoreHouse} onStorageChanged={onStorageChanged} />
    </EditorViewProvider>
  );
  const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
  return { button, onRestoreHouse, onStorageChanged };
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
  beforeEach(() => localStorage.clear());
  afterEach(() => {
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

  it('deletes a saved layout and every restore point only after a confirm', () => {
    saveNamedLayout(house('Cottage', 3), 'Cottage');
    recordSnapshot(house('Cottage', 3), { force: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { button, onStorageChanged } = setup();
    fireEvent.click(button(/Delete saved layout Cottage/));
    fireEvent.click(button(/Delete all restore points/));
    expect(listSavedLayouts()).toHaveLength(1);
    expect(listSnapshots()).toHaveLength(1);

    confirm.mockReturnValue(true);
    fireEvent.click(button(/Delete saved layout Cottage/));
    fireEvent.click(button(/Delete all restore points/));
    expect(listSavedLayouts()).toHaveLength(0);
    expect(listSnapshots()).toHaveLength(0);
    expect(onStorageChanged).toHaveBeenCalledTimes(2);
  });

  it('replace opens the backup’s house through the caller, and only after a confirm', async () => {
    const text = JSON.stringify(createBackup(house('Backed up', 4)));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { button, onRestoreHouse } = setup();
    await chooseFile(text);
    await waitFor(() => expect(screen.getByRole('group', { name: 'Restore backup' })).toBeTruthy());
    fireEvent.click(button(/^Replace/));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onRestoreHouse).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(button(/^Replace/));
    expect(onRestoreHouse).toHaveBeenCalledTimes(1);
    expect((onRestoreHouse.mock.calls[0]![0] as RoomLayout).name).toBe('Backed up');
  });

  it('merge asks nothing and replaces nothing: the backup’s house goes to the library', async () => {
    const text = JSON.stringify(createBackup(house('Backed up', 4)));
    const confirm = vi.spyOn(window, 'confirm');
    const { button, onRestoreHouse } = setup();
    await chooseFile(text);
    await waitFor(() => expect(screen.getByRole('group', { name: 'Restore backup' })).toBeTruthy());
    fireEvent.click(button(/^Merge$/));
    expect(confirm).not.toHaveBeenCalled();
    expect(onRestoreHouse).not.toHaveBeenCalled();
    expect(listSavedLayouts().map((entry) => entry.name)).toEqual(['Backed up (backup)']);
  });

  it('restoring is an edit: off while exploring; backing up stays on', () => {
    const { button } = setup('live');
    expect(button(/Restore…/).disabled).toBe(true);
    expect(button(/Back up all/).disabled).toBe(false);
  });
});
