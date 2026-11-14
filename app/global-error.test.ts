// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { CHUNK_RELOAD_KEY } from '../components/room-organizer/lib/chunk-reload';
import { STORAGE_KEY } from '../components/room-organizer/lib/constants';
import { readRecoveryCopies } from '../components/room-organizer/lib/persistence';
import { clearEditorCrashed, editorHasCrashed } from '../components/room-organizer/lib/saved-house';
import GlobalError from './global-error';

// #608: the root error screen. It replaces the whole document, so it must
// recover on its own: one reload for a stale chunk, then a plain retry; for
// any other crash, start fresh without ever losing the saved house (#336).

const renderBoundary = (error: Error & { digest?: string }) =>
  render(createElement(GlobalError, { error, reset: () => {} }));

function chunkError(): Error & { digest?: string } {
  const error = new Error('Loading chunk 805 failed.') as Error & { digest?: string };
  error.name = 'ChunkLoadError';
  return error;
}

const house = JSON.stringify(makeLayout({ name: 'Crashy', floors: [makeFloor({ items: [makeItem({ id: 'sofa' })] })] }));

async function clickStartFresh(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /start fresh/i }));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

const failSetItem = (name: string) =>
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw Object.assign(new Error(name), { name });
  });

let reload: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  clearEditorCrashed();
  reload = vi.fn();
  Object.defineProperty(window, 'location', { value: { ...window.location, reload }, writable: true });
  // It renders its own <html> and <body>, which React flags inside the test's <div>.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('app/global-error.tsx — a stale chunk (#143)', () => {
  it('reloads once while the shared guard is unspent', () => {
    renderBoundary(chunkError());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
  });

  it('then offers a plain reload that re-arms the guard, and never start-fresh', () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now() - 1_000));
    window.localStorage.setItem(STORAGE_KEY, house);
    renderBoundary(chunkError());
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn’t load the app/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /start fresh/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(house);
  });
});

describe('app/global-error.tsx — any other crash (#336, #568)', () => {
  const boom = () => renderBoundary(new Error('boom') as Error & { digest?: string });

  it("flags the crash as it renders, so the editor's unmount flush keeps the last clean save", () => {
    boom();
    expect(editorHasCrashed()).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(/something went sideways/i)).toBeDefined();
  });

  it('moves the saved house to a recovery copy, then reloads', async () => {
    window.localStorage.setItem(STORAGE_KEY, house);
    boom();
    await clickStartFresh();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readRecoveryCopies().map(({ raw }) => raw)).toEqual([house]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('just reloads when nothing is saved', async () => {
    boom();
    await clickStartFresh();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves the house alone and says why when storage blocks the copy', async () => {
    window.localStorage.setItem(STORAGE_KEY, house);
    boom();
    const setItem = failSetItem('SecurityError');
    try {
      await clickStartFresh();
    } finally {
      setItem.mockRestore();
    }
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(house);
    expect(screen.getByText(/couldn’t be copied aside/)).toBeDefined();
    expect(reload).not.toHaveBeenCalled();
  });

  it('offers the only copy for download, and no reload, when storage fails mid-move', async () => {
    window.localStorage.setItem(STORAGE_KEY, house);
    boom();
    const setItem = failSetItem('QuotaExceededError');
    try {
      await clickStartFresh();
    } finally {
      setItem.mockRestore();
    }
    expect(screen.getByText(/this page holds the only copy/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /start fresh/i })).toBeNull();
    let downloaded: Blob | null = null;
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        downloaded = blob;
        return 'blob:test';
      },
      revokeObjectURL: () => {},
    });
    // jsdom can't follow the download link ("navigation to another Document").
    const follow = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: /download my house/i }));
    expect(follow).toHaveBeenCalledTimes(1);
    expect(await (downloaded as Blob | null)?.text()).toBe(house);
    expect(reload).not.toHaveBeenCalled();
  });

  it('says so, and changes nothing, when the reset code fails to load', async () => {
    window.localStorage.setItem(STORAGE_KEY, house);
    vi.doMock('../components/room-organizer/lib/persistence', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    try {
      boom();
      await clickStartFresh();
    } finally {
      vi.doUnmock('../components/room-organizer/lib/persistence');
    }
    expect(screen.getByText(/couldn’t load what starting fresh needs/i)).toBeDefined();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(house);
    expect(reload).not.toHaveBeenCalled();
  });
});
