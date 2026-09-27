// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { RECOVERY_STORAGE_KEY } from '../lib/persistence';
import { decodeShareUrl } from '../lib/share';
import { useLayoutPersistence } from './use-layout-persistence';
import type { RoomLayout } from '../lib/types';

// The decode itself is covered by share.test.ts — here it's mocked so the
// hydration control flow can be driven without CompressionStream.
vi.mock('../lib/share', () => ({
  isShareHash: (hash: string) => hash.startsWith('#layout='),
  decodeShareUrl: vi.fn(),
}));

const mockedDecode = vi.mocked(decodeShareUrl);

describe('useLayoutPersistence — apply-throw must not clobber the save (#206)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    mockedDecode.mockReset();
  });

  // RTL only auto-unmounts when vitest globals are on (they're off here). A
  // still-mounted hook's 20ms autosave timer can otherwise fire after jsdom
  // is torn down and throw "window is not defined", failing the run.
  afterEach(cleanup);

  const mount = (onHydrate: (layout: RoomLayout) => void, debounceMs = 20) =>
    renderHook(() =>
      useLayoutPersistence({
        layout: makeLayout({ name: 'Fallback' }),
        onHydrate,
        debounceMs,
      })
    );

  it('backs up a saved layout that parses but throws on apply before autosave resumes', async () => {
    const blob = JSON.stringify(makeLayout({ name: 'Local house' }));
    window.localStorage.setItem(STORAGE_KEY, blob);

    mount(() => {
      throw new Error('boom on apply');
    });

    // The recovery copy must exist immediately — before the debounce can fire.
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBe(blob);

    // Autosave then resumes on purpose (the app must stay usable): the main
    // key ends up holding the fallback layout, but the house survived above.
    await waitFor(() => {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      expect(raw && (JSON.parse(raw) as RoomLayout).name).toBe('Fallback');
    });
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBe(blob);
  });

  it('falls back to the healthy local save when applying a SHARED layout throws', async () => {
    const local = makeLayout({ name: 'Local house' });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    window.location.hash = '#layout=whatever';
    mockedDecode.mockResolvedValue(makeLayout({ name: 'Shared' }));

    const applied: string[] = [];
    mount((layout) => {
      applied.push(layout.name);
      if (layout.name === 'Shared') throw new Error('boom on apply');
    });

    await waitFor(() => expect(applied).toEqual(['Shared', 'Local house']));
    // The local save was never the problem — no recovery copy, hash cleared.
    expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('still backs up the local save when BOTH the shared and local layouts throw', async () => {
    const blob = JSON.stringify(makeLayout({ name: 'Local house' }));
    window.localStorage.setItem(STORAGE_KEY, blob);
    window.location.hash = '#layout=whatever';
    mockedDecode.mockResolvedValue(makeLayout({ name: 'Shared' }));

    const applied: string[] = [];
    mount((layout) => {
      applied.push(layout.name);
      throw new Error('boom on apply');
    });

    await waitFor(() => expect(applied).toEqual(['Shared', 'Local house']));
    await waitFor(() => expect(window.localStorage.getItem(RECOVERY_STORAGE_KEY)).toBe(blob));
  });
});
