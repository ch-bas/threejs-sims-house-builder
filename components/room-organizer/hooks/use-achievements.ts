import { useEffect, useRef, useState } from 'react';
import { ACHIEVEMENTS, type Achievement, loadUnlocked, saveUnlocked } from '../lib/achievements';
import type { RoomLayout } from '../lib/types';

export interface UseAchievementsResult {
  unlocked: ReadonlySet<string>;
  /** Achievements unlocked since the last call to `dismiss()`. */
  pending: readonly Achievement[];
  dismiss(): void;
}

export function useAchievements(layout: RoomLayout): UseAchievementsResult {
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(() => loadUnlocked());
  const [pending, setPending] = useState<readonly Achievement[]>([]);
  const initialisedRef = useRef(false);

  useEffect(() => {
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

    // Skip the initial flood of unlocks when an existing layout is hydrated —
    // they were earned in a previous session and shouldn't pop again.
    if (!initialisedRef.current) {
      initialisedRef.current = true;
      return;
    }
    setPending((current) => [...current, ...next]);
  }, [layout, unlocked]);

  // Mark initialised after the first paint so the very first user-driven
  // change still triggers a toast even on a fresh slate.
  useEffect(() => {
    initialisedRef.current = true;
  }, []);

  return {
    unlocked,
    pending,
    dismiss: () => setPending([]),
  };
}
