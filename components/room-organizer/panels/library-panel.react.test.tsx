// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoAnswerConfirms, type AutoAnswer } from '../lib/__testfixtures__/confirm';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { cancelPendingConfirms } from '../lib/confirm-dialog';
import { listSavedLayouts, loadNamedLayout, saveNamedLayout } from '../lib/library';
import { snapshotBeforeReplace } from '../lib/restore-point';
import { VERSION_HISTORY_STORAGE_KEY, recordSnapshot } from '../lib/version-history';
import { LibraryPanel } from './library-panel';
import type { RoomLayout } from '../lib/types';

vi.mock('./plan-thumb', () => ({ PlanThumb: () => null }));
vi.mock('../lib/library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/library')>();
  return { ...actual, loadNamedLayout: vi.fn(actual.loadNamedLayout) };
});

const busyHouse = makeLayout({ name: 'Busy', floors: [makeFloor({ items: [makeItem({ id: 'sofa' })] })] });

describe('LibraryPanel: no native dialogs (#649, #607)', () => {
  let confirms: AutoAnswer | null = null;
  let alert: ReturnType<typeof vi.fn>;
  let nativeConfirm: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    alert = vi.fn();
    nativeConfirm = vi.fn(() => true);
    vi.stubGlobal('alert', alert);
    vi.stubGlobal('confirm', nativeConfirm);
  });
  afterEach(() => {
    confirms?.stop();
    confirms = null;
    cancelPendingConfirms();
    cleanup();
    vi.unstubAllGlobals();
    expect(alert).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  const mount = (onLoad: (layout: RoomLayout) => void = () => {}) =>
    render(<LibraryPanel currentLayout={busyHouse} onLoad={onLoad} />);

  it('says inline that a name is needed', () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Layout name' }), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/Enter a name/);
    expect(listSavedLayouts()).toEqual([]);
  });

  it('asks in the app before overwriting, and keeps the old copy on a no', async () => {
    saveNamedLayout(makeLayout({ name: 'Busy', width: 9 }), 'Busy');
    confirms = autoAnswerConfirms(false);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(confirms?.asked.map((question) => question.title)).toEqual(['Overwrite the saved layout “Busy”?']));
    expect(loadNamedLayout(listSavedLayouts()[0]!.id)?.width).toBe(9);
  });

  it('asks in the app before deleting a saved layout', async () => {
    saveNamedLayout(busyHouse, 'Busy');
    confirms = autoAnswerConfirms(true);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Busy' }));
    await waitFor(() => expect(listSavedLayouts()).toEqual([]));
    expect(confirms.asked[0]?.danger).toBe(true);
  });

  it('says inline when a saved layout can’t be read', async () => {
    saveNamedLayout(busyHouse, 'Busy');
    vi.mocked(loadNamedLayout).mockReturnValueOnce(null);
    const onLoad = vi.fn();
    mount(onLoad);
    fireEvent.click(screen.getByRole('button', { name: /^Busy/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Couldn’t open “Busy”/));
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('says inline when a restore point is gone by the time it is restored', async () => {
    recordSnapshot(makeLayout({ name: 'Older', floors: [makeFloor({ items: [makeItem()] })] }), { force: true });
    confirms = autoAnswerConfirms(() => {
      window.localStorage.removeItem(VERSION_HISTORY_STORAGE_KEY);
      return true;
    });
    const onLoad = vi.fn();
    mount(onLoad);
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Couldn’t restore this version/));
    expect(onLoad).not.toHaveBeenCalled();
  });
});

describe('LibraryPanel: History wording (#647)', () => {
  let confirms: AutoAnswer | null = null;

  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    confirms?.stop();
    confirms = null;
    cancelPendingConfirms();
    cleanup();
  });

  const older = makeLayout({ id: 'old', name: 'Cottage', floors: [makeFloor({ items: [makeItem({ id: 'a' })] })] });
  const live = makeLayout({ id: 'new', name: 'Living Room', floors: [makeFloor({ items: [makeItem({ id: 'b' })] })] });

  it('names the house and the time in the question', async () => {
    recordSnapshot(older);
    const asked: string[] = [];
    confirms = autoAnswerConfirms((question) => {
      asked.push(question.title);
      return false;
    });
    render(<LibraryPanel currentLayout={live} onLoad={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Restore Cottage/ }));
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toMatch(/with “Cottage” from \S*\d/);
  });

  it('lists no restore point that is the house on screen', () => {
    recordSnapshot(older);
    recordSnapshot(live);
    render(<LibraryPanel currentLayout={live} onLoad={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Restore Living Room/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Restore Cottage/ })).toBeTruthy();
  });

  it('lists it again once the house moves on', () => {
    recordSnapshot(live);
    const edited = { ...live, floors: [{ ...live.floors[0]!, floorColor: '#123456' }] };
    render(<LibraryPanel currentLayout={edited} onLoad={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Restore Living Room/ })).toBeTruthy();
  });

  it('clears the note about a load when another house replaces it', async () => {
    saveNamedLayout(older, 'Saved one');
    render(<LibraryPanel currentLayout={makeLayout()} onLoad={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Saved one/ }));
    await screen.findByText(/Undo brings back/);
    act(() => snapshotBeforeReplace(null));
    expect(screen.queryByText(/Undo brings back/)).toBeNull();
  });
});
