import { STORAGE_KEY } from './constants';
import { parseStoredLayout } from './schema';
import type { RoomLayout } from './types';

export function loadLayout(): RoomLayout | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parseStoredLayout(parsed);
  } catch (error) {
    console.warn('Failed to load saved layout:', error);
    return null;
  }
}

/** Returns true when the layout was persisted, false on any storage failure. */
export function saveLayout(layout: RoomLayout): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    return true;
  } catch (error) {
    // The most common failure here is QuotaExceededError when a large base64
    // floor-plan image pushes us past the ~5MB localStorage budget. Surface it
    // as a warning rather than crashing the auto-save loop, and report the
    // failure to the caller so the HUD doesn't falsely show "Saved".
    console.warn('Failed to persist layout to localStorage:', error);
    return false;
  }
}
