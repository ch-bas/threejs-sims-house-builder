// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoAnswerConfirms, type AutoAnswer } from '../lib/__testfixtures__/confirm';
import { BACKUP_FORMAT, BACKUP_VERSION } from '../lib/backup';
import { subscribeBackupRestored } from '../lib/backup-file';
import { CATALOG_DRAG_MIME } from '../lib/catalog-drag';
import { subscribeNotices, type Notice } from '../lib/editor-notices';
import { MODAL_OPEN_MESSAGE } from '../lib/file-drop';
import { INITIAL_LAYOUT } from './layout-reducer';
import { useFileDrop, useLaunchedFiles } from './use-file-drop';
import { layoutStore } from './use-layout-store';

// A house file dropped anywhere on the page (#934).

/** jsdom has no DragEvent or DataTransfer: an event carrying the parts the hook reads. */
function drag(type: string, files: File[], types: string[] = ['Files']): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types, files, dropEffect: 'none' } });
  return event;
}

const json = (value: unknown, name = 'house.json') => new File([JSON.stringify(value)], name, { type: 'application/json' });

describe('useFileDrop', () => {
  let confirms: AutoAnswer;
  let notices: Notice[];
  let unsubscribe: () => void;
  beforeEach(() => {
    confirms = autoAnswerConfirms(true);
    notices = [];
    unsubscribe = subscribeNotices((notice) => notices.push(notice));
    layoutStore.setState({ layout: { ...INITIAL_LAYOUT, name: 'Mine' }, activeFloorIndex: 0 });
  });
  afterEach(() => {
    unsubscribe();
    confirms.stop();
    cleanup();
    localStorage.clear();
  });

  function setup(lockedReason: string | null = null) {
    const openHouse = vi.fn((_file: File) => Promise.resolve(true));
    const refuse = vi.fn();
    const hook = renderHook(() => useFileDrop({ lockedReason, openHouse, refuse }));
    return { hook, openHouse, refuse };
  }

  it('shows the overlay while files are over the page, across inner elements', () => {
    const { hook } = setup();
    act(() => {
      window.dispatchEvent(drag('dragenter', []));
      window.dispatchEvent(drag('dragenter', []));
    });
    expect(hook.result.current.dragging).toBe(true);
    act(() => {
      window.dispatchEvent(drag('dragleave', []));
    });
    expect(hook.result.current.dragging).toBe(true);
    act(() => {
      window.dispatchEvent(drag('dragleave', []));
    });
    expect(hook.result.current.dragging).toBe(false);
  });

  it('ignores the catalogue drag, which the scene handles', () => {
    const { hook } = setup();
    const over = drag('dragover', [], [CATALOG_DRAG_MIME]);
    act(() => {
      window.dispatchEvent(drag('dragenter', [], [CATALOG_DRAG_MIME]));
      window.dispatchEvent(over);
    });
    expect(hook.result.current.dragging).toBe(false);
    expect(over.defaultPrevented).toBe(false);
  });

  it('catches the drop, so the browser never opens the file over the editor, and imports a house', async () => {
    const { hook, openHouse } = setup();
    const over = drag('dragover', []);
    const file = json({ ...INITIAL_LAYOUT, name: 'Dropped' });
    const drop = drag('drop', [file]);
    act(() => {
      window.dispatchEvent(drag('dragenter', []));
      window.dispatchEvent(over);
      window.dispatchEvent(drop);
    });
    expect(over.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
    expect(hook.result.current.dragging).toBe(false);
    await waitFor(() => expect(openHouse).toHaveBeenCalledWith(file));
  });

  it('sends a backup to the add-only restore, never the import, and tells the storage panels', async () => {
    const restored = vi.fn();
    const unsubscribeRestored = subscribeBackupRestored(restored);
    const { openHouse } = setup();
    const backup = json({ format: BACKUP_FORMAT, version: BACKUP_VERSION, library: [], restorePoints: [] }, 'backup.json');
    act(() => {
      window.dispatchEvent(drag('drop', [backup]));
    });
    await waitFor(() => expect(confirms.asked.map((question) => question.title)).toEqual(['Restore from “backup.json”?']));
    await waitFor(() => expect(notices.length).toBeGreaterThan(0));
    expect(openHouse).not.toHaveBeenCalled();
    // The open house stays as it is.
    expect(layoutStore.getState().layout.name).toBe('Mine');
    expect(restored).toHaveBeenCalledOnce();
    unsubscribeRestored();
  });

  it('refuses a drop while a dialog holds the page, and says so while dragging', () => {
    const { hook, openHouse, refuse } = setup();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    act(() => {
      window.dispatchEvent(drag('dragenter', []));
    });
    expect(hook.result.current.blockedReason).toBe(MODAL_OPEN_MESSAGE);
    act(() => {
      window.dispatchEvent(drag('drop', [json({})]));
    });
    expect(refuse).toHaveBeenCalledWith(MODAL_OPEN_MESSAGE);
    expect(openHouse).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('takes a file dropped on the start chooser, which a house answers', async () => {
    const { openHouse, refuse } = setup();
    const chooser = document.createElement('div');
    chooser.setAttribute('role', 'dialog');
    chooser.setAttribute('aria-modal', 'true');
    chooser.setAttribute('data-file-drop', 'open');
    document.body.append(chooser);
    act(() => {
      window.dispatchEvent(drag('drop', [json({ ...INITIAL_LAYOUT })]));
    });
    await waitFor(() => expect(openHouse).toHaveBeenCalledOnce());
    expect(refuse).not.toHaveBeenCalled();
    chooser.remove();
  });

  it('does not count the side drawer, an aside, as a dialog that blocks', async () => {
    const { openHouse } = setup();
    const drawer = document.createElement('aside');
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    document.body.append(drawer);
    act(() => {
      window.dispatchEvent(drag('drop', [json({ ...INITIAL_LAYOUT })]));
    });
    await waitFor(() => expect(openHouse).toHaveBeenCalledOnce());
    drawer.remove();
  });

  it('refuses another kind of file, two at once, and any file while the house is locked', () => {
    const { openHouse, refuse } = setup();
    const png = new File(['x'], 'plan.png', { type: 'image/png' });
    const drop = drag('drop', [png]);
    act(() => {
      window.dispatchEvent(drop);
      window.dispatchEvent(drag('drop', [json({}), json({})]));
    });
    expect(drop.defaultPrevented).toBe(true);
    expect(refuse.mock.calls.map(([message]) => message)).toEqual([
      '“plan.png” isn’t a house file. Drop a .json house or backup.',
      'Drop one file at a time.',
    ]);
    cleanup();
    const locked = setup('Not while exploring');
    const over = drag('dragover', []);
    act(() => {
      window.dispatchEvent(over);
      window.dispatchEvent(drag('drop', [json({})]));
    });
    expect((over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('none');
    expect(locked.refuse).toHaveBeenCalledWith('Not while exploring');
    expect(locked.openHouse).not.toHaveBeenCalled();
    expect(openHouse).not.toHaveBeenCalled();
  });

  it('leaves a drop an inner target already handled', () => {
    const { openHouse, refuse } = setup();
    const drop = drag('drop', [json({})]);
    drop.preventDefault();
    act(() => {
      window.dispatchEvent(drop);
    });
    expect(openHouse).not.toHaveBeenCalled();
    expect(refuse).not.toHaveBeenCalled();
  });
});

describe('useLaunchedFiles', () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'launchQueue');
  });

  function launch(lockedReason: string | null = null) {
    let consumer: ((params: { files?: { getFile(): Promise<File> }[] }) => void) | null = null;
    Object.defineProperty(window, 'launchQueue', {
      configurable: true,
      value: { setConsumer: (fn: typeof consumer) => (consumer = fn) },
    });
    const openHouse = vi.fn((_file: File) => Promise.resolve(true));
    const refuse = vi.fn();
    renderHook(() => useLaunchedFiles({ lockedReason, openHouse, refuse }));
    const open = (...files: File[]) => consumer?.({ files: files.map((file) => ({ getFile: () => Promise.resolve(file) })) });
    return { open, openHouse, refuse };
  }

  it('opens the file the installed app was launched with, as a dropped one', async () => {
    const { open, openHouse } = launch();
    const file = json({ ...INITIAL_LAYOUT, name: 'Launched' });
    open(file);
    await waitFor(() => expect(openHouse).toHaveBeenCalledWith(file));
  });

  it('words a refusal for opening, not dropping', async () => {
    const { open, refuse } = launch();
    open(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    await waitFor(() => expect(refuse).toHaveBeenCalledWith('“notes.txt” isn’t a house file. Open a .json house or backup.'));
  });

  it('refuses while the house is locked, and ignores a launch with no file', async () => {
    const { open, openHouse, refuse } = launch('Not while exploring');
    open();
    open(json({}));
    await waitFor(() => expect(refuse).toHaveBeenCalledWith('Not while exploring'));
    expect(refuse).toHaveBeenCalledOnce();
    expect(openHouse).not.toHaveBeenCalled();
  });

  it('does nothing where there is no launch queue', () => {
    const openHouse = vi.fn((_file: File) => Promise.resolve(true));
    expect(() => renderHook(() => useLaunchedFiles({ lockedReason: null, openHouse, refuse: vi.fn() }))).not.toThrow();
  });
});
