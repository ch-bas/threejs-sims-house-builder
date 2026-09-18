import { useEffect, useRef, useState } from 'react';
import { ACHIEVEMENTS, type Achievement, loadUnlocked, saveUnlocked } from '../lib/achievements';
import { STORAGE_KEY } from '../lib/constants';
import { isShareHash } from '../lib/share';
import type { RoomLayout } from '../lib/types';

export interface UseAchievementsResult {
  unlocked: ReadonlySet<string>;
  /** Achievements unlocked since the last call to `dismiss()`. */
  pending: readonly Achievement[];
  dismiss(): void;
}

/**
 * Is a hydration dispatch (share link or saved layout) about to replace the
 * initial layout right after mount? If so, the FIRST layout change is the
 * hydration landing, not a user edit — its unlocks must persist silently
 * instead of firing a toast burst for a house the user didn't just build (#146).
 */
function hydrationPending(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return isShareHash(window.location.hash) || window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function useAchievements(layout: RoomLayout): UseAchievementsResult {
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(() => loadUnlocked());
  const [pending, setPending] = useState<readonly Achievement[]>([]);
  // Toasts are armed once the "starting" layout has been evaluated: for a
  // fresh profile that's the very first evaluation (the default layout); for
  // a returning/shared profile it's the first evaluation AFTER hydration
  // lands. Crucially, arming must not depend on an unlock happening — tying
  // it to `mutated` would swallow a returning user's first genuinely earned
  // achievement of the session (the bug a drive-by fix for #146 introduced).
  // Known gap: if a stored layout fails to parse, hydration never dispatches
  // and the user's first edit is still treated as the baseline — acceptable
  // for that rare corrupted-save path.
  const initialisedRef = useRef(false);
  const awaitingHydrationRef = useRef(hydrationPending());
  const firstLayoutRef = useRef<RoomLayout | null>(null);

  useEffect(() => {
    if (firstLayoutRef.current === null) firstLayoutRef.current = layout;
    const isFirstLayout = layout === firstLayoutRef.current;
    // Decide suppression BEFORE arming so the baseline evaluation itself
    // (default layout, or the hydrated house) never toasts.
    const suppressToasts = !initialisedRef.current;
    if (!initialisedRef.current && (!awaitingHydrationRef.current || !isFirstLayout)) {
      initialisedRef.current = true;
    }

    const next: Achievement[] = [];
    let mutated = false;
    const newUnlocked = new Set(unlocked);

    for (const achievement of ACHIEVEMENTS) {
      if (newUnlocked.has(achievement.id)) continue;
      if (achievement.isMet(layout)) {
        newUnlocked.add(achievement.id);
        next.push(achievement);
        mutated = true;
      }
    }

    if (!mutated) return;

    setUnlocked(newUnlocked);
    saveUnlocked(newUnlocked);

    if (suppressToasts) return;
    setPending((current) => [...current, ...next]);
  }, [layout, unlocked]);

  return {
    unlocked,
    pending,
    dismiss: () => setPending([]),
  };
}
