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
vi.mock('../lib/restore-point', () => ({
  snapshotBeforeReplace: (outgoing: { name: string } | null) => calls.push(`snapshot:${outgoing?.name ?? 'none'}`),
}));
vi.mock('../lib/editor-notices', () => ({ notify: (message: string) => calls.push(`notify:${message}`) }));
vi.mock('./use-achievements', () => ({ markLayoutLoaded: () => calls.push('markLoaded') }));

function options(): UseHouseLoadingOptions {
  return {
    layout: makeLayout(),
    actions: { applyLayout: () => calls.push('apply'), setActiveFloorIndex: (index: number) => calls.push(`floor:${index}`) },
    commitHistoryNow: () => calls.push('commit'),
    clearHistory: () => calls.push('clearHistory'),
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
    expect(calls).toEqual(['snapshot:My Home', 'commit', 'apply', 'markLoaded', 'clearSelection', 'clearRemote']);
  });

  it('with nothing to adopt, nothing happens', () => {
    const { result } = renderHook(() => useHouseLoading(options()));
    act(() => result.current.adoptRemoteLayout());
    expect(calls).toEqual([]);
  });

  it('Keep a copy, once saved and its predecessor copied aside, is the rest of a replacement; the first load sets the history baseline', () => {
    renderHook(() => useHouseLoading(options()));
    // The stored house's restore point was taken by the persistence.
    act(() => persistence.options?.onKeepTourCopy?.(makeLayout({ name: 'Shared' }), true));
    expect(calls).toEqual([
      'commit',
      'apply',
      'markLoaded',
      'clearSelection',
      'clearHistory',
      expect.stringMatching(/^notify:Kept a copy of “Shared”.*kept as a recovered copy in Manage → Saved Layouts → History\.$/) as unknown,
    ]);
    calls.length = 0;
    act(() => persistence.options?.onHydrate(makeLayout({ name: 'Saved' })));
    expect(calls).toEqual(['apply', 'markLoaded', 'clearSelection', 'clearHistory']);
  });

  it('a house that waited for its floor-plan image opens on the storey it would have (#936)', () => {
    renderHook(() => useHouseLoading(options()));
    expect(persistence.options?.activeFloorIndex?.()).toBe(0);
    act(() => persistence.options?.onHydrate(makeLayout({ name: 'Saved' }), 0));
    expect(calls).toEqual(['apply', 'floor:0', 'markLoaded', 'clearSelection', 'clearHistory']);
  });

  it('Keep a copy names History only when it holds the previous house', () => {
    renderHook(() => useHouseLoading(options()));
    act(() => persistence.options?.onKeepTourCopy?.(makeLayout({ name: 'Shared' }), false));
    expect(calls.at(-1)).toBe('notify:Kept a copy of “Shared”: it saves here now.');
  });
});
