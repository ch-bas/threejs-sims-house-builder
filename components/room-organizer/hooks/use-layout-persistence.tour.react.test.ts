// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { currentConfirm } from '../lib/confirm-dialog';
import { STORAGE_KEY } from '../lib/constants';
import { subscribeNotices } from '../lib/editor-notices';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { readRecoveryCopies } from '../lib/persistence';
import { isTourSession, resetTourPhaseForTests, tourPhase } from '../lib/tour-session';
import { VERSION_HISTORY_MAX_CHARS, VERSION_HISTORY_STORAGE_KEY, recordSnapshot } from '../lib/version-history';
import { useLayoutPersistence } from './use-layout-persistence';
import type { Notice } from '../lib/editor-notices';
import type { RoomLayout } from '../lib/types';

const local = makeLayout({ name: 'Local House', floors: [makeFloor({ items: [makeItem({ id: 'sofa', category: 'seating' })] })] });
const shared = makeLayout({ name: 'Shared House', floors: [makeFloor({ items: [makeItem({ id: 'bed', category: 'bedroom' })] })] });

/**
 * A legacy (v1, uncompressed) link: jsdom's Blob has no stream(), so the v2
 * inflate can't run here. Both versions go through the same schema pass.
 */
function shareHash(layout: RoomLayout): string {
  return `#layout=${Buffer.from(JSON.stringify(layout)).toString('base64url')}`;
}

const DEBOUNCE_MS = 20;
/** A restore point of the stored house, as an earlier session would have left. */
const recordSnapshotForTest = () => recordSnapshot(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as RoomLayout, { force: true });
const ringNames = (): string[] => {
  const raw = window.localStorage.getItem(VERSION_HISTORY_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { layout: RoomLayout }[]).map((entry) => entry.layout.name) : [];
};
const storedName = (): string | null => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as RoomLayout).name : null;
};
/** Longer than the autosave debounce, so a save that was due has happened. */
const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 4));

describe('useLayoutPersistence — a share link opens a read-only tour (#722)', () => {
  let notices: Notice[] = [];
  const refused = vi.fn();
  let stopNotices: () => void = () => {};

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    resetTourPhaseForTests();
    notices = [];
    refused.mockReset();
    stopNotices = subscribeNotices((notice) => notices.push(notice));
  });
  afterEach(() => {
    stopNotices();
    cleanup();
    resetTourPhaseForTests();
    vi.restoreAllMocks();
  });

  const mount = (onKeepTourCopy?: (house: RoomLayout, copiedAside: boolean) => void) => {
    const hydrated: string[] = [];
    const hook = renderHook(
      ({ layout }: { layout: RoomLayout }) =>
        useLayoutPersistence({
          layout,
          onHydrate: (next) => hydrated.push(next.name),
          ...(onKeepTourCopy ? { onKeepTourCopy } : {}),
          debounceMs: DEBOUNCE_MS,
        }),
      { initialProps: { layout: makeLayout({ name: 'Fallback' }) } }
    );
    return { hydrated, hook };
  };

  const openTour = async (onKeepTourCopy?: (house: RoomLayout, copiedAside: boolean) => void) => {
    window.location.hash = shareHash(shared);
    const mounted = mount(onKeepTourCopy);
    await waitFor(() => expect(mounted.hook.result.current.tourHouse?.name).toBe('Shared House'));
    return mounted;
  };

  it('shows the shared house without asking, and leaves the visitor’s save alone', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    const { hydrated, hook } = await openTour();
    expect(hydrated).toEqual(['Shared House']);
    expect(currentConfirm()).toBeNull();
    expect(isTourSession()).toBe(true);
    // A reload opens the tour again.
    expect(window.location.hash).toMatch(/^#layout=/);

    // Nothing saves: not the hydration, not a later change, not the unmount.
    hook.rerender({ layout: makeLayout({ name: 'Moved camera' }) });
    await pastDebounce();
    hook.unmount();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(local));
    expect(ringNames()).toEqual([]);
    expect(readRecoveryCopies()).toEqual([]);
  });

  it('offers nothing when another tab saves the visitor’s house', async () => {
    const { hook } = await openTour();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: JSON.stringify(local) }));
    });
    expect(hook.result.current.remoteLayout).toBeNull();
  });

  it('Keep a copy copies the stored house aside, saves the copy, then hands it over', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    const kept: [string, boolean][] = [];
    const { hook } = await openTour((house, copiedAside) => kept.push([house.name, copiedAside]));
    act(() => hook.result.current.keepTourCopy(refused));
    expect(kept).toEqual([['Shared House', true]]);
    // Saved before the load is handed over, not a debounce later.
    expect(storedName()).toBe('Shared House');
    expect(readRecoveryCopies().map(({ raw }) => raw)).toEqual([JSON.stringify(local)]);
    // A restore point too, where it fits.
    expect(ringNames()).toEqual(['Local House']);
    expect(tourPhase()).toBe('kept');
    expect(hook.result.current.tourHouse).toBeNull();
    expect(window.location.hash).toBe('');
    expect(refused).not.toHaveBeenCalled();
  });

  it('the load that shows the copy is no edit: it neither saves nor takes a point', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    const { hook } = await openTour();
    act(() => hook.result.current.keepTourCopy(refused));
    const saved = window.localStorage.getItem(STORAGE_KEY);
    // The orchestrator's applyLayout lands as a new layout.
    hook.rerender({ layout: makeLayout({ name: 'Shared House' }) });
    await pastDebounce();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(saved);
    expect(ringNames()).toEqual(['Local House']);
    // A real edit after it saves as usual, and the copy aside stays.
    hook.rerender({ layout: makeLayout({ name: 'Shared House', floors: [makeFloor({ name: 'Edited' })] }) });
    await waitFor(() => expect((JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as RoomLayout).floors[0]!.name).toBe('Edited'));
    expect(readRecoveryCopies().map(({ raw }) => raw)).toEqual([JSON.stringify(local)]);
  });

  it('Keep a copy keeps the house on screen, whatever link the address shows since', async () => {
    const kept: string[] = [];
    const { hook } = await openTour((house) => kept.push(house.name));
    // Another link typed over this one: a hash change, no reload.
    window.location.hash = shareHash(makeLayout({ name: 'Other House' }));
    act(() => hook.result.current.keepTourCopy(refused));
    expect(kept).toEqual(['Shared House']);
    expect(storedName()).toBe('Shared House');
    expect(window.location.hash).toBe('');
  });

  it('Keep a copy over nothing of the visitor’s claims no way back', async () => {
    const kept: boolean[] = [];
    const { hook } = await openTour((_house, copiedAside) => kept.push(copiedAside));
    act(() => hook.result.current.keepTourCopy(refused));
    expect(kept).toEqual([false]);
    expect(storedName()).toBe('Shared House');
    expect(readRecoveryCopies()).toEqual([]);
  });

  it('Keep a copy over an unreadable save copies it aside', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    const kept: boolean[] = [];
    const { hook } = await openTour((_house, copiedAside) => kept.push(copiedAside));
    // Untouched during the tour.
    expect(readRecoveryCopies()).toEqual([]);
    act(() => hook.result.current.keepTourCopy(refused));
    expect(kept).toEqual([true]);
    expect(readRecoveryCopies().map(({ raw }) => raw)).toEqual(['{not json']);
  });

  it('Keep a copy over a house too large for any restore point copies it aside', async () => {
    // Over VERSION_HISTORY_MAX_CHARS within the schema's caps: many named items.
    const items = Array.from({ length: 2000 }, (_, i) => makeItem({ id: `chair-${i}`, name: `Chair ${'x'.repeat(190)}` }));
    const huge = makeLayout({ name: 'Huge House', floors: [makeFloor({ items })] });
    expect(JSON.stringify(huge).length).toBeGreaterThan(VERSION_HISTORY_MAX_CHARS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(huge));
    const kept: boolean[] = [];
    const { hook } = await openTour((_house, copiedAside) => kept.push(copiedAside));
    act(() => hook.result.current.keepTourCopy(refused));
    expect(refused).not.toHaveBeenCalled();
    expect(kept).toEqual([true]);
    expect(ringNames()).toEqual([]);
    expect(readRecoveryCopies().map(({ raw }) => raw)).toEqual([JSON.stringify(huge)]);
    expect(storedName()).toBe('Shared House');
  });

  describe('with storage full, Keep a copy refuses and leaves storage exactly as it was', () => {
    const quota = () => new DOMException('full', 'QuotaExceededError');
    const everything = (): Record<string, string> =>
      Object.fromEntries(Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)!]));
    /** Fails every write `fails` picks, as a full storage would. */
    const failWrites = (fails: (key: string) => boolean) => {
      const real = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
        if (fails(key)) throw quota();
        real.call(this, key, value);
      });
    };

    const expectNothingChanged = (hook: { result: { current: { tourHouse: RoomLayout | null } } }, kept: unknown[], before: Record<string, string>) => {
      expect(kept).toEqual([]);
      expect(isTourSession()).toBe(true);
      expect(hook.result.current.tourHouse?.name).toBe('Shared House');
      expect(window.location.hash).toMatch(/^#layout=/);
      expect(everything()).toEqual(before);
      expect(refused).toHaveBeenCalledWith('refused');
      expect(notices.filter((notice) => notice.tone === 'error')).toHaveLength(1);
      expect(notices.some((notice) => notice.tone !== 'error' && /Kept a copy|History/.test(notice.message))).toBe(false);
    };

    // An older restore point of another house, which the save may evict.
    const withOlderPoint = () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(makeLayout({ name: 'Older', floors: [makeFloor({ items: [makeItem()] })] })));
      recordSnapshotForTest();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    };

    it('when the visitor’s house can’t be copied aside', async () => {
      withOlderPoint();
      const kept: unknown[] = [];
      const { hook } = await openTour((house) => kept.push(house.name));
      const before = everything();
      failWrites((key) => key.startsWith(`${STORAGE_KEY}-recovery`));
      act(() => hook.result.current.keepTourCopy(refused));
      expectNothingChanged(hook, kept, before);
      expect(notices.at(-1)!.message).toMatch(/No room to keep a copy of your own house/);
    });

    it('when the copy can’t be saved, even with the restore points evicted', async () => {
      withOlderPoint();
      const kept: unknown[] = [];
      const { hook } = await openTour((house) => kept.push(house.name));
      const before = everything();
      expect(ringNames()).toEqual(['Older']);
      failWrites((key) => key === STORAGE_KEY);
      act(() => hook.result.current.keepTourCopy(refused));
      // The recovered copy it made and the point the save evicted: both undone.
      expectNothingChanged(hook, kept, before);
      expect(notices.at(-1)!.message).toMatch(/Storage full: the copy couldn’t be saved/);
    });
  });

  it('Build your own opens the visitor’s house, and saves nothing for it', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    const { hydrated, hook } = await openTour();
    act(() => hook.result.current.leaveTour());
    expect(hydrated).toEqual(['Shared House', 'Local House']);
    expect(tourPhase()).toBe('none');
    expect(window.location.hash).toBe('');
    // The hydration itself is not an edit.
    hook.rerender({ layout: makeLayout({ name: 'Local House' }) });
    await pastDebounce();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(local));
    expect(ringNames()).toEqual([]);
  });

  it('Build your own with nothing stored starts a fresh lot', async () => {
    const { hydrated, hook } = await openTour();
    act(() => hook.result.current.leaveTour());
    expect(hydrated).toEqual(['Shared House', INITIAL_LAYOUT.name]);
    hook.rerender({ layout: makeLayout({ name: INITIAL_LAYOUT.name }) });
    await pastDebounce();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('after a tour crashed, opens the visitor’s house and says why', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    // What the error screen leaves: the link dropped, a note in the session.
    window.sessionStorage.setItem('pc-tour-crashed', '1');
    const { hydrated } = mount();
    expect(hydrated).toEqual(['Local House']);
    expect(notices.map((notice) => notice.message)).toEqual([expect.stringMatching(/shared house hit an error/) as unknown]);
    expect(window.sessionStorage.getItem('pc-tour-crashed')).toBeNull();
    expect(tourPhase()).toBe('none');
  });

  describe('a link that does not open says why, in a notice, and ends the tour (#607)', () => {
    it.each([
      ['broken', '#layout=2.AAAAbroken', /broken or incomplete/],
      ['from a newer app', '#layout=3.AAAA', /newer version of the app/],
    ])('%s', async (_label, hash, message) => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
      const alert = vi.fn();
      vi.stubGlobal('alert', alert);
      window.location.hash = hash;
      const { hydrated } = mount();
      await waitFor(() => expect(hydrated).toEqual(['Local House']));
      vi.unstubAllGlobals();
      expect(alert).not.toHaveBeenCalled();
      expect(notices.map((notice) => [notice.tone, notice.message])).toEqual([['error', expect.stringMatching(message) as unknown]]);
      expect(notices[0]!.message).toMatch(/Your own house is unchanged\./);
      expect(window.location.hash).toBe('');
      expect(tourPhase()).toBe('none');
    });
  });
});
