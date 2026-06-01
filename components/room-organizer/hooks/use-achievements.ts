import { useEffect, useRef, useState } from 'react';
import { ACHIEVEMENTS, type Achievement, loadUnlocked, saveUnlocked } from '../lib/achievements';
import type { RoomLayout } from '../lib/types';

export interface UseAchievementsResult {
  unlocked: ReadonlySet<string>;
  /** Achievements unlocked since the last call to `dismiss()`. */
  pending: readonly Achievement[];
  dismiss(): void;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_ARRAY: readonly Achievement[] = [];
const NOOP = () => {};

export function useAchievements(layout: RoomLayout, enabled = false): UseAchievementsResult {
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(() => enabled ? loadUnlocked() : new Set());
  const [pending, setPending] = useState<readonly Achievement[]>([]);
  const initialisedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

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
  }, [layout, unlocked, enabled]);

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
