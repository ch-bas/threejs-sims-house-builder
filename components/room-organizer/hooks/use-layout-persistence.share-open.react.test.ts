// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoAnswerConfirms, type AutoAnswer } from '../lib/__testfixtures__/confirm';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { cancelPendingConfirms, currentConfirm } from '../lib/confirm-dialog';
import { STORAGE_KEY } from '../lib/constants';
import { subscribeNotices } from '../lib/editor-notices';
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

describe('useLayoutPersistence — opening a share link', () => {
  let notices: Notice[] = [];
  let stopNotices: () => void = () => {};
  let confirms: AutoAnswer | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    notices = [];
    stopNotices = subscribeNotices((notice) => notices.push(notice));
  });
  afterEach(() => {
    stopNotices();
    confirms?.stop();
    confirms = null;
    // A question a test left open must not be answered by the next one.
    cancelPendingConfirms();
    cleanup();
    vi.restoreAllMocks();
  });

  const mount = () => {
    const hydrated: string[] = [];
    const opened: string[] = [];
    renderHook(() =>
      useLayoutPersistence({
        layout: makeLayout({ name: 'Fallback' }),
        onHydrate: (layout) => hydrated.push(layout.name),
        onOpenShared: (layout) => opened.push(layout.name),
        debounceMs: 20,
      })
    );
    return { hydrated, opened };
  };

  describe('over a house with work (#573)', () => {
    it('opens the player’s own house first and asks, keeping the link until answered', async () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
      window.location.hash = shareHash(shared);
      const { hydrated, opened } = mount();
      await waitFor(() => expect(currentConfirm()?.title).toBe('Open the shared house “Shared House”?'));
      expect(currentConfirm()?.body).toMatch(/kept as a restore point/);
      expect(hydrated).toEqual(['Local House']);
      expect(opened).toEqual([]);
      // A reload now would ask again.
      expect(window.location.hash).toMatch(/^#layout=/);
    });

    it('a yes opens it as an ordinary, undoable replacement, with a notice', async () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
      window.location.hash = shareHash(shared);
      confirms = autoAnswerConfirms(true);
      const { hydrated, opened } = mount();
      await waitFor(() => expect(opened).toEqual(['Shared House']));
      // Never hydrated over: hydration would have cleared undo.
      expect(hydrated).toEqual(['Local House']);
      expect(window.location.hash).toBe('');
      expect(notices.map((notice) => [notice.tone, notice.message])).toEqual([
        ['success', expect.stringMatching(/Opened the shared house\. Undo brings yours back/) as unknown],
      ]);
    });

    it('a no keeps the player’s house and drops the link', async () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
      window.location.hash = shareHash(shared);
      confirms = autoAnswerConfirms(false);
      const { hydrated, opened } = mount();
      await waitFor(() => expect(confirms?.asked).toHaveLength(1));
      await waitFor(() => expect(window.location.hash).toBe(''));
      expect(hydrated).toEqual(['Local House']);
      expect(opened).toEqual([]);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(local));
    });

    it('opens it unasked when there is nothing of the player’s to keep', async () => {
      window.location.hash = shareHash(shared);
      confirms = autoAnswerConfirms(false);
      const { hydrated, opened } = mount();
      await waitFor(() => expect(hydrated).toEqual(['Shared House']));
      expect(confirms.asked).toEqual([]);
      expect(opened).toEqual([]);
    });
  });

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
