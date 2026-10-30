// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { subscribeNotices } from '../lib/editor-notices';
import { useLayoutPersistence } from './use-layout-persistence';
import type { Notice } from '../lib/editor-notices';

const local = makeLayout({ name: 'Local House', floors: [makeFloor({ items: [makeItem({ id: 'sofa', category: 'seating' })] })] });

describe('useLayoutPersistence — opening a share link', () => {
  let notices: Notice[] = [];
  let stopNotices: () => void = () => {};

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    notices = [];
    stopNotices = subscribeNotices((notice) => notices.push(notice));
  });
  afterEach(() => {
    stopNotices();
    cleanup();
    vi.restoreAllMocks();
  });

  const mount = () => {
    const hydrated: string[] = [];
    renderHook(() =>
      useLayoutPersistence({
        layout: makeLayout({ name: 'Fallback' }),
        onHydrate: (layout) => hydrated.push(layout.name),
        debounceMs: 20,
      })
    );
    return { hydrated };
  };

  describe('a link that does not open says why, in a notice (#607)', () => {
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
    });
  });
});
