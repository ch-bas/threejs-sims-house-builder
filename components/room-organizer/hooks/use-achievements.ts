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

    if (!initialisedRef.current) {
      initialisedRef.current = true;
      return;
    }
    setPending((current) => [...current, ...next]);
  }, [layout, unlocked]);

  // Check if a layout hydration is pending on mount (share URL or localStorage).
  // If so, do not immediately mark initialised on first paint; wait until the
  // first non-initial layout evaluation or user mutation arms it.
  useEffect(() => {
    const hasPendingHydration =
      typeof window !== 'undefined' &&
      (window.location.hash.startsWith('#layout=') || window.localStorage.getItem('standalone-room-organizer-layout') !== null);
    if (!hasPendingHydration) {
      initialisedRef.current = true;
    }
  }, []);

  return {
    unlocked,
    pending,
    dismiss: () => setPending([]),
  };
}
