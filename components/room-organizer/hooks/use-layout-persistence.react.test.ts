// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { useLayoutPersistence } from './use-layout-persistence';

function fireStorage(key: string, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
}

describe('useLayoutPersistence — cross-tab guard (#123)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const setup = () =>
    renderHook(() =>
      useLayoutPersistence({
        layout: makeLayout({ name: 'This tab' }),
        onHydrate: () => {},
        debounceMs: 60_000,
      })
    );

  it('surfaces a valid layout saved by another tab', () => {
    const { result } = setup();
    expect(result.current.remoteLayout).toBeNull();
    const remote = makeLayout({ name: 'Other tab' });
    act(() => fireStorage(STORAGE_KEY, JSON.stringify(remote)));
    expect(result.current.remoteLayout).toEqual(remote);
  });

  it('ignores writes to other keys, removals, and unreadable payloads', () => {
    const { result } = setup();
    act(() => fireStorage('some-other-key', JSON.stringify(makeLayout())));
    act(() => fireStorage(STORAGE_KEY, null));
    act(() => fireStorage(STORAGE_KEY, '{not json'));
    act(() => fireStorage(STORAGE_KEY, JSON.stringify({ width: 5 })));
    expect(result.current.remoteLayout).toBeNull();
  });

  it('clearRemoteLayout dismisses the notice', () => {
    const { result } = setup();
    act(() => fireStorage(STORAGE_KEY, JSON.stringify(makeLayout({ name: 'Other tab' }))));
    expect(result.current.remoteLayout).not.toBeNull();
    act(() => result.current.clearRemoteLayout());
    expect(result.current.remoteLayout).toBeNull();
  });
});
