// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { useHouseLoading, type UseHouseLoadingOptions } from './use-house-loading';
import type { UseLayoutPersistenceOptions } from './use-layout-persistence';

const { calls, persistence } = vi.hoisted(() => ({
  calls: [] as string[],
  persistence: {
    options: null as UseLayoutPersistenceOptions | null,
    remoteLayout: null as unknown,
  },
}));

vi.mock('./use-layout-persistence', () => ({
  useLayoutPersistence: (options: UseLayoutPersistenceOptions) => {
    persistence.options = options;
    return { saveStatus: {}, remoteLayout: persistence.remoteLayout, clearRemoteLayout: () => calls.push('clearRemote') };
  },
}));
vi.mock('../lib/restore-point', () => ({ snapshotBeforeReplace: () => calls.push('snapshot') }));
vi.mock('./use-achievements', () => ({ markLayoutLoaded: () => calls.push('markLoaded') }));

function options(): UseHouseLoadingOptions {
  return {
    layout: makeLayout(),
    actions: { applyLayout: () => calls.push('apply') },
    commitHistoryNow: () => calls.push('commit'),
    clearHistory: () => calls.push('clearHistory'),
    undoHistory: vi.fn(),
    clearTransientSelection: () => calls.push('clearSelection'),
  };
}

describe('useHouseLoading: the load rules, in order', () => {
  beforeEach(() => {
    calls.length = 0;
    persistence.remoteLayout = null;
  });

  it("adopting another tab's save keeps a restore point and its own undo step", () => {
    persistence.remoteLayout = makeLayout({ name: 'Other tab' });
    const { result } = renderHook(() => useHouseLoading(options()));
    act(() => result.current.adoptRemoteLayout());
    expect(calls).toEqual(['snapshot', 'commit', 'apply', 'markLoaded', 'clearSelection', 'clearRemote']);
  });

  it('with nothing to adopt, nothing happens', () => {
    const { result } = renderHook(() => useHouseLoading(options()));
    act(() => result.current.adoptRemoteLayout());
    expect(calls).toEqual([]);
  });

  it('a share link opened over the house is a replacement; the first load sets the history baseline', () => {
    renderHook(() => useHouseLoading(options()));
    act(() => persistence.options?.onOpenShared?.(makeLayout({ name: 'Shared' })));
    expect(calls).toEqual(['snapshot', 'commit', 'apply', 'markLoaded', 'clearSelection']);
    calls.length = 0;
    act(() => persistence.options?.onHydrate(makeLayout({ name: 'Saved' })));
    expect(calls).toEqual(['apply', 'markLoaded', 'clearSelection', 'clearHistory']);
  });
});
