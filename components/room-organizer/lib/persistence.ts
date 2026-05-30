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

export function saveLayout(layout: RoomLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch (error) {
    // The most common failure here is QuotaExceededError when a large base64
    // floor-plan image pushes us past the ~5MB localStorage budget. Surface it
    // as a warning rather than crashing the auto-save loop.
    console.warn('Failed to persist layout to localStorage:', error);
  }
}

export function clearLayout(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
