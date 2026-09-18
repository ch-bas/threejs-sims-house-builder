// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { useAchievements } from './use-achievements';

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
