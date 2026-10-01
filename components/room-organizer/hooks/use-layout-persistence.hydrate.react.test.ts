// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { readRecoveryCopies } from '../lib/persistence';
import { decodeShareUrl } from '../lib/share';
import { VERSION_HISTORY_STORAGE_KEY } from '../lib/version-history';
import { useLayoutPersistence } from './use-layout-persistence';
import type { RoomLayout } from '../lib/types';

// The decode itself is covered by share.test.ts — here it's mocked so the
// hydration control flow can be driven without CompressionStream.
vi.mock('../lib/share', () => ({
  isShareHash: (hash: string) => hash.startsWith('#layout='),
  isShareHashWithinBudget: () => true,
  decodeShareUrl: vi.fn(),
}));

const mockedDecode = vi.mocked(decodeShareUrl);

const keptRaws = (): string[] => readRecoveryCopies().map(({ raw }) => raw);

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
    expect(keptRaws()).toEqual([blob]);

    // Autosave then resumes on purpose (the app must stay usable): the main
    // key ends up holding the fallback layout, but the house survived above.
    await waitFor(() => {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      expect(raw && (JSON.parse(raw) as RoomLayout).name).toBe('Fallback');
    });
    expect(keptRaws()).toEqual([blob]);
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
    expect(keptRaws()).toEqual([]);
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
    await waitFor(() => expect(keptRaws()).toEqual([blob]));
  });

  const readRing = (): { layout: RoomLayout }[] => {
    const raw = window.localStorage.getItem(VERSION_HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { layout: RoomLayout }[]) : [];
  };

  it('takes a restore point of the stored house before applying a shared layout (#298)', async () => {
    const local = makeLayout({ name: 'Local house', floors: [makeFloor({ items: [makeItem()] })] });
    const blob = JSON.stringify(local);
    window.localStorage.setItem(STORAGE_KEY, blob);
    window.location.hash = '#layout=whatever';
    mockedDecode.mockResolvedValue(makeLayout({ name: 'Shared' }));

    // Ring contents at the moment each layout is applied.
    const ringAtApply: string[][] = [];
    const applied: string[] = [];
    mount((layout) => {
      applied.push(layout.name);
      ringAtApply.push(readRing().map((entry) => entry.layout.name));
    });

    await waitFor(() => expect(applied).toEqual(['Shared']));
    expect(ringAtApply).toEqual([['Local house']]);
    expect(readRing().map((entry) => entry.layout)).toEqual([local]);
    // Snapshotting only reads the save: it is neither rewritten nor treated
    // as broken, and the hash is still cleared.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(blob);
    expect(keptRaws()).toEqual([]);
    expect(window.location.hash).toBe('');
  });

  it('takes no restore point for a share link when nothing worth keeping is stored (#298)', async () => {
    window.location.hash = '#layout=whatever';
    mockedDecode.mockResolvedValue(makeLayout({ name: 'Shared' }));

    const applied: string[] = [];
    const first = mount((layout) => {
      applied.push(layout.name);
    });
    await waitFor(() => expect(applied).toEqual(['Shared']));
    expect(readRing()).toEqual([]);
    first.unmount();

    // An empty stored house is skipped too.
    window.localStorage.clear();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...INITIAL_LAYOUT, name: 'Blank' }));
    window.location.hash = '#layout=whatever';
    applied.length = 0;
    mount((layout) => {
      applied.push(layout.name);
    });
    await waitFor(() => expect(applied).toEqual(['Shared']));
    expect(readRing()).toEqual([]);
  });
});
