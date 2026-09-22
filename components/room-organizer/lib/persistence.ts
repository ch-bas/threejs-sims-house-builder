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

/**
 * Where a stored blob that exists but can't be used — unreadable (JSON or
 * schema failure, #113) or parseable but crashing on apply (#206) — is
 * stashed before the autosave loop can overwrite it with the fallback
 * layout. The user's house survives for manual recovery.
 */
export const RECOVERY_STORAGE_KEY = `${STORAGE_KEY}-recovery`;

/**
 * Copy the raw stored blob aside before it gets clobbered by the fallback
 * autosave. Call whenever the stored layout can't be brought up: after
 * loadLayout() returned null despite a blob existing (#113), or after
 * applying a parsed layout threw (#206). Best-effort; a quota failure here
 * must not break the mount.
 */
export function backupStoredLayout(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    window.localStorage.setItem(RECOVERY_STORAGE_KEY, raw);
    console.warn(`Saved layout can't be used; a copy was kept under "${RECOVERY_STORAGE_KEY}".`);
  } catch (error) {
    console.warn('Failed to back up stored layout:', error);
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
