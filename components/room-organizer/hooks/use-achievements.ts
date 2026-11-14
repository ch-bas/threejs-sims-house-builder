import { useEffect, useRef, useState } from 'react';
import { type Achievement, achievementsEarned, loadUnlocked, saveUnlocked } from '../lib/achievements';
import { layoutStore } from './use-layout-store';
import type { KnownCollisions } from '../lib/room-score';
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
 * Call right after an `applyLayout` that puts a house on screen the player
 * didn't just build: the saved or shared house a session opens on, a
 * template, a library house or restore point, the paste-board, an import, a
 * cross-tab adopt, an undo/redo step. The store dispatch is synchronous, so
 * the layout it marks is the one that landed, and that layout earns no
 * achievements (#450). A share link that fails to open never lands, so the
 * player's first edit after it still counts.
 */
export function markLayoutLoaded(): void {
  loadedLayouts.add(layoutStore.getState().layout);
}

/** Whether `markLayoutLoaded` marked this layout: the First steps read it too (#721). */
export function isLoadedLayout(layout: RoomLayout): boolean {
  return loadedLayouts.has(layout);
}

/**
 * `known`: the active storey's collisions as the editor has them for
 * `layout` (`collidingIds`). The room goals score with them, and with the
 * set kept from the previous layout for the one before it (#903).
 */
export function useAchievements(layout: RoomLayout, known: KnownCollisions): UseAchievementsResult {
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(() => loadUnlocked());
  const [pending, setPending] = useState<readonly Achievement[]>([]);
  /** The last layout evaluated; null before the first, the starting house. */
  const lastRef = useRef<RoomLayout | null>(null);
  const unlockedRef = useRef(unlocked);
  const knownRef = useRef(known);
  knownRef.current = known;
  const lastKnownRef = useRef<KnownCollisions | undefined>(undefined);

  useEffect(() => {
    const before = lastRef.current;
    if (before === layout) return;
    lastRef.current = layout;
    const knownBefore = lastKnownRef.current;
    lastKnownRef.current = knownRef.current;
    const change = before === null || isLoadedLayout(layout) ? 'loaded' : 'edit';
    const earned = achievementsEarned(change, before, layout, unlockedRef.current, { before: knownBefore, now: knownRef.current });
    if (earned.length === 0) return;
    const next = new Set(unlockedRef.current);
    for (const achievement of earned) next.add(achievement.id);
    unlockedRef.current = next;
    setUnlocked(next);
    saveUnlocked(next);
    setPending((current) => [...current, ...earned]);
  }, [layout]);

  return {
    unlocked,
    pending,
    dismiss: () => setPending([]),
  };
}
