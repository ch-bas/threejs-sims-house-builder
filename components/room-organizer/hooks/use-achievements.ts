import { useEffect, useRef, useState } from 'react';
import {
  type Achievement,
  type LayoutChange,
  achievementsEarned,
  loadUnlocked,
  metAchievementIds,
  saveUnlocked,
} from '../lib/achievements';
import { STORAGE_KEY } from '../lib/constants';
import { isShareHash } from '../lib/share';
import { layoutStore } from './use-layout-store';
import type { RoomLayout } from '../lib/types';

export interface UseAchievementsResult {
  unlocked: ReadonlySet<string>;
  /** Achievements unlocked since the last call to `dismiss()`. */
  pending: readonly Achievement[];
  dismiss(): void;
}

/** Layouts that replaced the house wholesale, by identity (#450). */
const loadedLayouts = new WeakSet<RoomLayout>();

/**
 * Call right after an `applyLayout` that puts a house the player didn't
 * build here on screen: a template, a library house or restore point, the
 * paste-board, an import, a cross-tab adopt, an undo/redo step. The store
 * dispatch is synchronous, so the layout it marks is the one that landed,
 * and that layout earns no achievements (#450).
 */
export function markLayoutLoaded(): void {
  loadedLayouts.add(layoutStore.getState().layout);
}

/**
 * Is a hydration dispatch about to replace the initial layout right after
 * mount? A saved house is the player's own and unlocks silently (#146); a
 * share link is someone else's and unlocks nothing (#450).
 */
function pendingHydration(): 'none' | 'saved' | 'shared' {
  if (typeof window === 'undefined') return 'none';
  try {
    if (isShareHash(window.location.hash)) return 'shared';
    return window.localStorage.getItem(STORAGE_KEY) !== null ? 'saved' : 'none';
  } catch {
    return 'none';
  }
}

export function useAchievements(layout: RoomLayout): UseAchievementsResult {
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(() => loadUnlocked());
  const [pending, setPending] = useState<readonly Achievement[]>([]);
  // The first layout is the starting house, and while a hydration is pending
  // the one after it is too (the saved or shared house landing). Known gap:
  // a stored layout that fails to parse never dispatches, so the player's
  // first edit is then taken for the hydration.
  const hydrationRef = useRef(pendingHydration());
  /** The last layout evaluated, and the achievements it met. */
  const lastRef = useRef<{ layout: RoomLayout; met: ReadonlySet<string> } | null>(null);
  const unlockedRef = useRef(unlocked);

  useEffect(() => {
    const last = lastRef.current;
    if (last?.layout === layout) return;
    let change: LayoutChange = 'edit';
    if (last === null) {
      change = 'baseline';
    } else if (hydrationRef.current !== 'none') {
      change = hydrationRef.current === 'shared' ? 'loaded' : 'baseline';
      hydrationRef.current = 'none';
    } else if (loadedLayouts.has(layout)) {
      change = 'loaded';
    }
    const met = metAchievementIds(layout);
    lastRef.current = { layout, met };

    const earned = achievementsEarned(change, last?.met ?? new Set(), met, unlockedRef.current);
    if (earned.length === 0) return;
    const next = new Set(unlockedRef.current);
    for (const achievement of earned) next.add(achievement.id);
    unlockedRef.current = next;
    setUnlocked(next);
    saveUnlocked(next);
    if (change === 'edit') setPending((current) => [...current, ...earned]);
  }, [layout]);

  return {
    unlocked,
    pending,
    dismiss: () => setPending([]),
  };
}
