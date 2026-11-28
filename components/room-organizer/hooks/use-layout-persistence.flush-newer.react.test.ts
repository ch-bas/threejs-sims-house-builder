// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { cancelPendingConfirms } from '../lib/confirm-dialog';
import { loadLayout } from '../lib/persistence';
import { resetSavedByChoice, SAVED_BY_STORAGE_KEY } from '../lib/saved-by';
import { useLayoutPersistence } from './use-layout-persistence';

// This build is 1.0.0; another tab's newer build stamped the save (#933).
vi.mock('../lib/saved-by', async (original) => ({ ...(await original<typeof import('../lib/saved-by')>()), BUILD_VERSION: '1.0.0' }));

beforeEach(() => {
  window.localStorage.clear();
  resetSavedByChoice();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  cancelPendingConfirms();
  vi.useRealTimers();
});

it('says a newer version\'s save refused the flush before an update reload', () => {
  const { result } = renderHook(() => {
    const [layout, setLayout] = useState(() => makeLayout({ name: 'Before' }));
    return { setLayout, ...useLayoutPersistence({ layout, onHydrate: () => {}, debounceMs: 60_000 }) };
  });
  window.localStorage.setItem(SAVED_BY_STORAGE_KEY, '9.0.0');
  act(() => result.current.setLayout(makeLayout({ name: 'Edited' })));
  expect(result.current.flushSave()).toBe('newer');
  expect(loadLayout()?.name).not.toBe('Edited');
});
