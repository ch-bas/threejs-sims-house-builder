// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { subscribeNotices } from '../lib/editor-notices';
import { MAX_SHARE_HASH_LENGTH } from '../lib/share';
import { VERSION_HISTORY_STORAGE_KEY, recordSnapshot } from '../lib/version-history';
import { useLayoutPersistence } from './use-layout-persistence';
import type { Notice } from '../lib/editor-notices';
import type { RoomLayout } from '../lib/types';

describe('useLayoutPersistence — an oversized share link (#332)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });
  afterEach(cleanup);

  it('is refused with a notice, leaving the local house and its restore points as they were', () => {
    const local = makeLayout({ name: 'Local house' });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    recordSnapshot(makeLayout({ name: 'Older house' }));
    const ring = window.localStorage.getItem(VERSION_HISTORY_STORAGE_KEY);
    window.location.hash = `#layout=2.${'A'.repeat(MAX_SHARE_HASH_LENGTH)}`;
    const notices: Notice[] = [];
    const unsubscribe = subscribeNotices((notice) => notices.push(notice));

    const applied: RoomLayout[] = [];
    renderHook(() =>
      useLayoutPersistence({ layout: makeLayout({ name: 'Fallback' }), onHydrate: (l) => applied.push(l), debounceMs: 20 })
    );
    unsubscribe();

    expect(applied.map((layout) => layout.name)).toEqual(['Local house']);
    expect(notices).toEqual([expect.objectContaining({ tone: 'error', message: expect.stringMatching(/far larger than any house/) })]);
    expect(window.location.hash).toBe('');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(local));
    expect(window.localStorage.getItem(VERSION_HISTORY_STORAGE_KEY)).toBe(ring);
  });
});
