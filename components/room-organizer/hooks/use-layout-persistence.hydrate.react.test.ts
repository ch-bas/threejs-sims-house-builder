// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { readRecoveryCopies } from '../lib/persistence';
import { readShareHash } from '../lib/share';
import { resetTourPhaseForTests } from '../lib/tour-session';
import { VERSION_HISTORY_STORAGE_KEY } from '../lib/version-history';
import { useLayoutPersistence } from './use-layout-persistence';
import type { RoomLayout } from '../lib/types';

// The decode itself is covered by share.test.ts — here it's mocked so the
// hydration control flow can be driven without CompressionStream.
vi.mock('../lib/share', async (importOriginal) => ({
  isShareHash: (hash: string) => hash.startsWith('#layout='),
  isShareHashWithinBudget: () => true,
  readShareHash: vi.fn(),
  shareFailureMessage: (await importOriginal<typeof import('../lib/share')>()).shareFailureMessage,
}));

const mockedRead = vi.mocked(readShareHash);
/** The decode resolving to `layout`, as the hook reads it. */
const mockedDecode = {
  mockResolvedValue: (layout: RoomLayout) => mockedRead.mockResolvedValue({ ok: true, layout }),
  mockReset: () => mockedRead.mockReset(),
};

const keptRaws = (): string[] => readRecoveryCopies().map(({ raw }) => raw);

describe('useLayoutPersistence — apply-throw must not clobber the save (#206)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    resetTourPhaseForTests();
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

  it('takes a restore point of the stored house when a toured one is kept (#298, #722)', async () => {
    const local = makeLayout({ name: 'Local house', floors: [makeFloor({ items: [makeItem({ category: 'seating' })] })] });
    const blob = JSON.stringify(local);
    window.localStorage.setItem(STORAGE_KEY, blob);
    window.location.hash = '#layout=whatever';
    mockedDecode.mockResolvedValue(makeLayout({ name: 'Shared' }));

    const applied: string[] = [];
    const { result } = renderHook(() =>
      useLayoutPersistence({
        layout: makeLayout({ name: 'Fallback' }),
        onHydrate: (layout) => applied.push(layout.name),
        debounceMs: 20,
      })
    );
    await waitFor(() => expect(applied).toEqual(['Shared']));
    // Touring reads nothing into the ring.
    expect(readRing()).toEqual([]);
    act(() => result.current.keepTourCopy(() => {}));
    expect(readRing().map((entry) => entry.layout)).toEqual([local]);
    // The save now holds the copy; the stored house is a recovered copy
    // (the durable way back) as well as the point.
    expect((JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as RoomLayout).name).toBe('Shared');
    expect(keptRaws()).toEqual([blob]);
    expect(window.location.hash).toBe('');
  });
});
