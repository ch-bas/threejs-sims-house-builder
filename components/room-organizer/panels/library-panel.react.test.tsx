// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layoutStore } from '../hooks/use-layout-store';
import { autoAnswerConfirms, type AutoAnswer } from '../lib/__testfixtures__/confirm';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { cancelPendingConfirms } from '../lib/confirm-dialog';
import { listSavedLayouts, loadNamedLayout, saveNamedLayout } from '../lib/library';
import { snapshotBeforeReplace } from '../lib/restore-point';
import { VERSION_HISTORY_STORAGE_KEY, keepSnapshot, listKeptVersions, listSnapshots, recordSnapshot } from '../lib/version-history';
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

  it('does not claim there are no restore points when the only one is the house on screen', () => {
    recordSnapshot(live);
    render(<LibraryPanel currentLayout={live} onLoad={vi.fn()} />);
    expect(screen.queryByText('No restore points yet.')).toBeNull();
    expect(screen.getByText('Nothing older than the house on screen yet.')).toBeTruthy();
  });

  it('lists it again once the house moves on', () => {
    recordSnapshot(live);
    const edited = { ...live, floors: [{ ...live.floors[0]!, floorColor: '#123456' }] };
    render(<LibraryPanel currentLayout={edited} onLoad={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Restore Living Room/ })).toBeTruthy();
  });

  it('clears the note about a load when another house replaces it', async () => {
    saveNamedLayout(older, 'Saved one');
    confirms = autoAnswerConfirms(true);
    render(<LibraryPanel currentLayout={makeLayout()} onLoad={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Saved one/ }));
    await screen.findByText(/Undo brings back/);
    act(() => snapshotBeforeReplace(null));
    expect(screen.queryByText(/Undo brings back/)).toBeNull();
  });
});

describe('LibraryPanel: kept versions (#935)', () => {
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

  const cottage = makeLayout({ id: 'old', name: 'Cottage', floors: [makeFloor({ items: [makeItem({ id: 'a' })] })] });
  const live = makeLayout({ id: 'new', name: 'Living Room', floors: [makeFloor({ items: [makeItem({ id: 'b' })] })] });

  it('keeps a restore point, shows it on top, renames it, and restores it through the same path', async () => {
    recordSnapshot(cottage, { force: true });
    confirms = autoAnswerConfirms(true);
    const onLoad = vi.fn();
    render(<LibraryPanel currentLayout={live} onLoad={onLoad} />);
    fireEvent.click(screen.getByRole('button', { name: /^Keep Cottage/ }));
    const list = screen.getByRole('list', { name: 'Kept versions' });
    expect(list.textContent).toMatch(/📌 Cottage/);
    expect(listKeptVersions()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Keep Cottage/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Cottage' }));
    const field = screen.getByRole('textbox', { name: 'Name of this kept version' });
    fireEvent.change(field, { target: { value: 'Before the loft' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(listKeptVersions()[0]!.label).toBe('Before the loft');

    fireEvent.click(screen.getByRole('button', { name: /^Restore Before the loft/ }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    expect(onLoad.mock.calls[0]![0]).toMatchObject({ id: 'old', name: 'Cottage' });
  });

  it('asks before it stops keeping one, and a no keeps it', async () => {
    recordSnapshot(cottage, { force: true });
    keepSnapshot(listSnapshots()[0]!.id);
    confirms = autoAnswerConfirms(false);
    render(<LibraryPanel currentLayout={live} onLoad={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop keeping Cottage' }));
    await waitFor(() => expect(confirms?.asked).toHaveLength(1));
    expect(confirms?.asked[0]).toMatchObject({ title: 'Stop keeping “Cottage”?', danger: true });
    expect(listKeptVersions()).toHaveLength(1);
  });

  it('a yes puts it back among the restore points', async () => {
    recordSnapshot(cottage, { force: true });
    keepSnapshot(listSnapshots()[0]!.id);
    confirms = autoAnswerConfirms(true);
    render(<LibraryPanel currentLayout={live} onLoad={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop keeping Cottage' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/back among the restore points/));
    expect(listKeptVersions()).toEqual([]);
    expect(screen.getByRole('button', { name: /^Keep Cottage/ })).toBeTruthy();
  });

  it('says inline why a version can’t be kept', () => {
    for (let i = 0; i < 6; i++) {
      recordSnapshot(makeLayout({ id: `h${i}`, name: `House ${i}`, floors: [makeFloor({ items: [] })] }), { force: true });
    }
    for (const summary of listSnapshots().slice(0, 5)) keepSnapshot(summary.id);
    render(<LibraryPanel currentLayout={live} onLoad={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Keep House 0/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/5 versions are kept already/);
  });

  it('moves focus to the kept row after Keep, back to Rename after a rename, and to the heading after Unpin', async () => {
    recordSnapshot(cottage, { force: true });
    confirms = autoAnswerConfirms(true);
    render(<LibraryPanel currentLayout={live} onLoad={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Keep Cottage/ }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Restore Cottage/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Rename Cottage' }));
    const field = screen.getByRole('textbox', { name: 'Name of this kept version' });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename Cottage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename Cottage' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of this kept version' }), { target: { value: 'Mine' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name of this kept version' }), { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename Mine' }));

    fireEvent.click(screen.getByRole('button', { name: 'Stop keeping Mine' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: /History/ })));
  });

  it('keeps the house on screen with Keep this version', () => {
    render(<LibraryPanel currentLayout={live} onLoad={vi.fn()} />);
    layoutStore.setState({ layout: live });
    fireEvent.click(screen.getByRole('button', { name: /Keep this version/ }));
    expect(listKeptVersions().map((kept) => [kept.name, kept.layoutId])).toEqual([['Living Room', 'new']]);
    fireEvent.click(screen.getByRole('button', { name: /Keep this version/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/kept already/);
  });

  it('says before it happens that a version older than a full History is deleted', async () => {
    recordSnapshot(cottage, { force: true, now: () => 1_000 });
    keepSnapshot(listSnapshots()[0]!.id);
    for (let i = 0; i < 10; i++) {
      recordSnapshot(makeLayout({ id: `n${i}`, name: `New ${i}`, floors: [makeFloor({ items: [] })] }), { force: true, now: () => 10_000 + i });
    }
    confirms = autoAnswerConfirms(false);
    render(<LibraryPanel currentLayout={live} onLoad={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop keeping Cottage' }));
    await waitFor(() => expect(confirms?.asked).toHaveLength(1));
    expect(confirms?.asked[0]).toMatchObject({ title: 'Delete “Cottage”?', confirmLabel: 'Delete', danger: true });
    expect(listKeptVersions()).toHaveLength(1);
  });

  it('names the restore point that gives way when the ring is full, and refuses if History moved on meanwhile', async () => {
    for (let i = 0; i < 10; i++) {
      recordSnapshot(makeLayout({ id: `n${i}`, name: `New ${i}`, floors: [makeFloor({ items: [] })] }), { force: true, now: () => 1_000 + i });
    }
    recordSnapshot(cottage, { force: true, now: () => 5_000 });
    keepSnapshot(listSnapshots().find((summary) => summary.name === 'Cottage')!.id);
    recordSnapshot(makeLayout({ id: 'late', name: 'Late', floors: [makeFloor({ items: [] })] }), { force: true, now: () => 6_000 });
    confirms = autoAnswerConfirms(() => {
      // While the question is up, another point arrives and History moves on.
      recordSnapshot(makeLayout({ id: 'later', name: 'Later', floors: [makeFloor({ items: [] })] }), { force: true, now: () => 7_000 });
      return true;
    });
    render(<LibraryPanel currentLayout={live} onLoad={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop keeping Cottage' }));
    await waitFor(() => expect(confirms?.asked).toHaveLength(1));
    expect(confirms?.asked[0]?.body).toMatch(/and the oldest restore point, from .+, will be cleared to make room/);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/History changed while you were deciding/));
    expect(listKeptVersions()).toHaveLength(1);
  });
});
