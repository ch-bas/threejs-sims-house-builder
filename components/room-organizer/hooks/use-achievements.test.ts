// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { markLayoutLoaded, useAchievements } from './use-achievements';
import { layoutStore } from './use-layout-store';
import type { RoomLayout } from '../lib/types';

const ACHIEVEMENTS_KEY = 'standalone-room-organizer-achievements';

const emptyLayout = () => makeLayout({ floors: [makeFloor({ items: [] })] });
const furnished = (count: number) =>
  makeLayout({
    floors: [makeFloor({ items: Array.from({ length: count }, (_, i) => makeItem({ id: `i${i}` })) })],
  });

describe('useAchievements — toast arming (#146)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('hydrating a saved house does not fire a toast burst', () => {
    window.localStorage.setItem(STORAGE_KEY, '{"name":"saved"}');
    const { result, rerender } = renderHook(({ layout }) => useAchievements(layout), {
      initialProps: { layout: emptyLayout() },
    });
    // Hydration lands: a furnished house meeting several achievements.
    act(() => rerender({ layout: furnished(6) }));
    expect(result.current.pending).toEqual([]);
    // ...but the unlocks were persisted silently.
    expect(result.current.unlocked.size).toBeGreaterThan(0);
  });

  it("a returning user's FIRST new achievement of the session still toasts", () => {
    // Saved layout exists; its achievements are already unlocked.
    window.localStorage.setItem(STORAGE_KEY, '{"name":"saved"}');
    window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(['first-steps', 'roof-it']));
    const { result, rerender } = renderHook(({ layout }) => useAchievements(layout), {
      initialProps: { layout: emptyLayout() },
    });
    // Hydration: nothing NEW unlocks — arming must still happen here.
    act(() => rerender({ layout: furnished(1) }));
    expect(result.current.pending).toEqual([]);
    const alreadyUnlocked = result.current.unlocked.size;
    // The user then genuinely earns new achievements: they must toast.
    act(() => rerender({ layout: furnished(6) }));
    expect(result.current.pending.length).toBeGreaterThan(0);
    expect(result.current.unlocked.size).toBeGreaterThan(alreadyUnlocked);
  });

  it('a fresh profile suppresses default-layout unlocks but toasts the first real edit', () => {
    const { result, rerender } = renderHook(({ layout }) => useAchievements(layout), {
      initialProps: { layout: emptyLayout() },
    });
    // Nothing stored: the mount evaluation is the baseline (silent)...
    expect(result.current.pending).toEqual([]);
    // ...and the first edit toasts.
    act(() => rerender({ layout: furnished(1) }));
    expect(result.current.pending.map((a) => a.id)).toContain('first-steps');
  });
});

describe('useAchievements: loaded houses earn nothing (#450)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = '';
  });

  /** What a load path does: apply the layout, then mark it. */
  const load = (layout: RoomLayout): RoomLayout => {
    layoutStore.setState({ layout });
    markLayoutLoaded();
    return layout;
  };

  const withWifi = (extra = 0) =>
    makeLayout({
      floors: [
        makeFloor({
          items: [
            makeItem({ id: 'router', type: 'wifi', isWiFiAccessPoint: true }),
            ...Array.from({ length: extra }, (_, i) => makeItem({ id: `x${i}` })),
          ],
        }),
      ],
    });

  it('loading a template neither toasts nor unlocks', () => {
    const { result, rerender } = renderHook(({ layout }) => useAchievements(layout), {
      initialProps: { layout: emptyLayout() },
    });
    act(() => rerender({ layout: load(withWifi()) }));
    expect(result.current.pending).toEqual([]);
    expect(result.current.unlocked.size).toBe(0);
    expect(window.localStorage.getItem(ACHIEVEMENTS_KEY)).toBeNull();
  });

  it('editing a loaded house earns only what the edit achieved', () => {
    const { result, rerender } = renderHook(({ layout }) => useAchievements(layout), {
      initialProps: { layout: emptyLayout() },
    });
    act(() => rerender({ layout: load(withWifi()) }));
    // A move that keeps the router: Wi-Fi and First Steps stay unearned.
    act(() => rerender({ layout: withWifi() }));
    expect(result.current.pending).toEqual([]);
    // Ten items: Furnished is the player's doing.
    act(() => rerender({ layout: withWifi(9) }));
    const earned = result.current.pending.map((a) => a.id);
    expect(earned).toContain('furnished');
    expect(earned).not.toContain('first-steps');
    expect(earned).not.toContain('wifi-everywhere');
    // Removing the router and placing one again earns it.
    act(() => rerender({ layout: furnished(10) }));
    act(() => rerender({ layout: withWifi(9) }));
    expect(result.current.pending.map((a) => a.id)).toContain('wifi-everywhere');
  });

  it('undo and redo onto a loaded house earn nothing', () => {
    const own = emptyLayout();
    const { result, rerender } = renderHook(({ layout }) => useAchievements(layout), {
      initialProps: { layout: own },
    });
    const template = load(withWifi());
    act(() => rerender({ layout: template }));
    act(() => rerender({ layout: load({ ...own }) })); // undo
    act(() => rerender({ layout: load({ ...template }) })); // redo
    expect(result.current.pending).toEqual([]);
    expect(result.current.unlocked.size).toBe(0);
  });

  it('a share link opened at mount unlocks nothing', () => {
    window.location.hash = '#layout=abc';
    const { result, rerender } = renderHook(({ layout }) => useAchievements(layout), {
      initialProps: { layout: emptyLayout() },
    });
    act(() => rerender({ layout: withWifi(9) }));
    expect(result.current.pending).toEqual([]);
    expect(result.current.unlocked.size).toBe(0);
  });

  it('keeps what another tab unlocked when it saves its own', () => {
    window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(['sky-high']));
    const { result, rerender } = renderHook(({ layout }) => useAchievements(layout), {
      initialProps: { layout: emptyLayout() },
    });
    // Another tab unlocks Going Up after this one loaded.
    window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(['sky-high', 'going-up']));
    act(() => rerender({ layout: furnished(1) }));
    expect(result.current.pending.map((a) => a.id)).toEqual(['first-steps']);
    const stored = JSON.parse(window.localStorage.getItem(ACHIEVEMENTS_KEY) ?? '[]') as string[];
    expect(stored.sort()).toEqual(['first-steps', 'going-up', 'sky-high']);
  });
});
