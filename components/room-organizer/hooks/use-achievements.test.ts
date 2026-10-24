// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { markLayoutLoaded, useAchievements } from './use-achievements';
import { layoutStore } from './use-layout-store';
import type { RoomLayout } from '../lib/types';

const ACHIEVEMENTS_KEY = 'standalone-room-organizer-achievements';

const emptyLayout = () => makeLayout({ floors: [makeFloor({ items: [] })] });
const furnished = (count: number) =>
  makeLayout({
    floors: [makeFloor({ items: Array.from({ length: count }, (_, i) => makeItem({ id: `i${i}` })) })],
  });
const withWifi = (aps = 1, extra = 0) =>
  makeLayout({
    floors: [
      makeFloor({
        items: [
          ...Array.from({ length: aps }, (_, i) => makeItem({ id: `ap${i}`, type: 'wifi', isWiFiAccessPoint: true })),
          ...Array.from({ length: extra }, (_, i) => makeItem({ id: `x${i}` })),
        ],
      }),
    ],
  });

/** What a load path does: apply the layout, then mark it. */
const load = (layout: RoomLayout): RoomLayout => {
  layoutStore.setState({ layout });
  markLayoutLoaded();
  return layout;
};

const mount = (initial: RoomLayout = emptyLayout()) =>
  renderHook(({ layout }) => useAchievements(layout), { initialProps: { layout: initial } });

const ids = (pending: readonly { id: string }[]) => pending.map((a) => a.id);

beforeEach(() => {
  window.localStorage.clear();
});

describe('useAchievements: the house a session opens on (#146, #450)', () => {
  it('the starting house unlocks nothing, and the first real edit toasts', () => {
    const { result, rerender } = mount();
    expect(result.current.pending).toEqual([]);
    act(() => rerender({ layout: furnished(1) }));
    expect(ids(result.current.pending)).toContain('first-steps');
  });

  it('a hydrated house (saved or shared) neither toasts nor unlocks', () => {
    const { result, rerender } = mount();
    act(() => rerender({ layout: load(furnished(6)) }));
    expect(result.current.pending).toEqual([]);
    expect(result.current.unlocked.size).toBe(0);
    expect(window.localStorage.getItem(ACHIEVEMENTS_KEY)).toBeNull();
  });

  it("a returning user's first new achievement of the session still toasts", () => {
    window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(['first-steps', 'roof-it']));
    const { result, rerender } = mount();
    act(() => rerender({ layout: load(furnished(1)) }));
    expect(result.current.pending).toEqual([]);
    act(() => rerender({ layout: furnished(10) }));
    expect(ids(result.current.pending)).toContain('furnished');
    expect(ids(result.current.pending)).not.toContain('first-steps');
  });

  it('a share link that never lands leaves the first edit counting', () => {
    // A broken, oversized or refused link dispatches nothing: no mark.
    const { result, rerender } = mount();
    act(() => rerender({ layout: furnished(1) }));
    expect(ids(result.current.pending)).toEqual(['first-steps']);
  });
});

describe('useAchievements: loaded houses earn nothing (#450)', () => {
  it('loading a template neither toasts nor unlocks', () => {
    const { result, rerender } = mount();
    act(() => rerender({ layout: load(withWifi()) }));
    expect(result.current.pending).toEqual([]);
    expect(result.current.unlocked.size).toBe(0);
  });

  it('a move inside a loaded house earns nothing; doing the thing again does', () => {
    const { result, rerender } = mount();
    act(() => rerender({ layout: load(withWifi()) }));
    act(() => rerender({ layout: withWifi() })); // a move: same counts
    expect(result.current.pending).toEqual([]);
    // Another access point: Wi-Fi Everywhere and First Steps are earned.
    act(() => rerender({ layout: withWifi(2) }));
    expect(ids(result.current.pending)).toEqual(expect.arrayContaining(['wifi-everywhere', 'first-steps']));
  });

  it('undo and redo onto a loaded house earn nothing', () => {
    const own = emptyLayout();
    const { result, rerender } = mount(own);
    const template = load(withWifi());
    act(() => rerender({ layout: template }));
    act(() => rerender({ layout: load({ ...own }) })); // undo
    act(() => rerender({ layout: load({ ...template }) })); // redo
    expect(result.current.pending).toEqual([]);
    expect(result.current.unlocked.size).toBe(0);
  });

  it('keeps what another tab unlocked when it saves its own', () => {
    window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(['sky-high']));
    const { result, rerender } = mount();
    window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(['sky-high', 'going-up']));
    act(() => rerender({ layout: furnished(1) }));
    expect(ids(result.current.pending)).toEqual(['first-steps']);
    const stored = JSON.parse(window.localStorage.getItem(ACHIEVEMENTS_KEY) ?? '[]') as string[];
    expect(stored.sort()).toEqual(['first-steps', 'going-up', 'sky-high']);
  });
});
