// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { readStorageCare, recordPersistAnswer } from '../lib/backup-reminder';
import { markLayoutLoaded } from './use-achievements';
import { layoutStore } from './use-layout-store';
import { useAskToKeepStorage } from './use-storage-persist';
import type { RoomLayout } from '../lib/types';

const furnished = (count: number): RoomLayout =>
  makeLayout({ floors: [makeFloor({ items: Array.from({ length: count }, (_, i) => makeItem({ id: `i${i}` })) })] });

const load = (layout: RoomLayout): RoomLayout => {
  layoutStore.setState({ layout });
  markLayoutLoaded();
  return layout;
};

let persist: ReturnType<typeof vi.fn<() => Promise<boolean>>>;

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function stubBrowser(userAgent: string, answer: boolean, persisted = false): void {
  persist = vi.fn(() => Promise.resolve(answer));
  vi.stubGlobal('navigator', { ...navigator, userAgent, storage: { persist, persisted: () => Promise.resolve(persisted) } });
}

beforeEach(() => {
  window.localStorage.clear();
  stubBrowser(CHROME, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const mount = () => renderHook(({ layout }) => useAskToKeepStorage(layout), { initialProps: { layout: furnished(0) } });

describe('useAskToKeepStorage (#928)', () => {
  it('asks nothing for the opening house or a load, then once on the first edit', async () => {
    const { rerender } = mount();
    rerender({ layout: load(furnished(3)) });
    expect(persist).not.toHaveBeenCalled();
    await act(async () => {
      rerender({ layout: furnished(4) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(readStorageCare().persist).toBe('granted');
    rerender({ layout: furnished(5) });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('a no is kept as its time; Firefox is not prompted again inside the week', async () => {
    stubBrowser(FIREFOX, false);
    const first = mount();
    await act(async () => {
      first.rerender({ layout: furnished(2) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(readStorageCare()).toMatchObject({ persist: null, persistDeniedAt: expect.any(Number) });
    first.unmount();
    const second = mount();
    second.rerender({ layout: furnished(3) });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('a silent browser that said no is asked again in the next session', async () => {
    recordPersistAnswer('denied', Date.now());
    const { rerender } = mount();
    await act(async () => {
      rerender({ layout: furnished(2) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(readStorageCare().persist).toBe('granted');
  });

  it('a site already kept is recorded without asking', async () => {
    stubBrowser(FIREFOX, false, true);
    const { rerender } = mount();
    await act(async () => {
      rerender({ layout: furnished(2) });
      await Promise.resolve();
    });
    expect(persist).not.toHaveBeenCalled();
    expect(readStorageCare().persist).toBe('granted');
  });
});
