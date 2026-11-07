/**
 * The light part of persistence that the error screens need as they render
 * (#584): the saved house's storage key, a raw read and a raw download, the
 * crash flag and the reload marker. It imports no schema and no catalogue,
 * so the error boundaries, which every page loads before hydration, don't
 * pull those into first-load JS. persistence.ts re-exports all of it; the
 * rest of the app keeps importing from there.
 */
import { downloadTextFile } from './plan-export/download';

/** The localStorage key of the saved house. */
export const STORAGE_KEY = 'standalone-room-organizer-layout';

/**
 * `window.localStorage`, or null where storage is unavailable: the getter
 * throws where storage is blocked, and Firefox with `dom.storage.enabled=false`
 * returns null instead (#472).
 */
export function localStorageOrNull(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The raw stored house (for a download), or null when absent or unreadable. */
export function readStoredLayoutRaw(storage?: Pick<Storage, 'getItem'>): string | null {
  try {
    return (storage ?? localStorageOrNull())?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Download a stored house exactly as stored — it may not parse, so it can't
 * go through `downloadLayoutAsJson`.
 */
export function downloadRawLayout(raw: string, fileName: string): void {
  downloadTextFile(fileName, 'application/json', raw);
}

/*
 * Whether the editor went down with an error (#568). The error screen notes it
 * while it renders, which is before the crashed editor's cleanup runs, so the
 * editor's unmount flush can tell a crash from an ordinary unmount and keep a
 * layout that crashed it out of the save. Module state, not storage: it only
 * has to outlive one commit, and a reload starts over.
 */
let editorCrashed = false;

/** Called by the error screens as they render. */
export function noteEditorCrashed(): void {
  editorCrashed = true;
}

/** Whether an error screen has replaced the editor since it last mounted. */
export function editorHasCrashed(): boolean {
  return editorCrashed;
}

/** Called as the editor mounts: a fresh editor has not crashed. */
export function clearEditorCrashed(): void {
  editorCrashed = false;
}

const RELOAD_ATTEMPT_KEY = 'pc-error-reload';
/** A crash this soon after the error screen's reload means reloading didn't help. */
export const RELOAD_RETRY_WINDOW_MS = 2 * 60_000;
/** How long the editor must stay up after mounting before its reload counts as having worked. */
export const EDITOR_SETTLED_MS = 10_000;

/** Called by the error screen's "Reload" so the next crash knows it came back. */
export function noteReloadAttempt(now: number = Date.now(), session?: Pick<Storage, 'setItem'>): void {
  try {
    (session ?? window.sessionStorage).setItem(RELOAD_ATTEMPT_KEY, String(now));
  } catch {
    /* without the marker the reset is offered straight away */
  }
}

/**
 * Called once the editor has come up with the saved house: the reload
 * worked, so a later, unrelated crash must not read as a recurrence.
 */
export function clearReloadAttempt(session?: Pick<Storage, 'removeItem'>): void {
  try {
    (session ?? window.sessionStorage).removeItem(RELOAD_ATTEMPT_KEY);
  } catch {
    /* nothing to clear where session storage is unavailable */
  }
}

/**
 * Whether the error screen should suspect the saved house (#336): the crash
 * came back within moments of a reload. Without session storage there's no
 * way to tell, so the answer is yes rather than no way out.
 */
export function crashRecurredAfterReload(now: number = Date.now(), session?: Pick<Storage, 'getItem'>): boolean {
  try {
    const stamp = Number((session ?? window.sessionStorage).getItem(RELOAD_ATTEMPT_KEY));
    return stamp > 0 && now >= stamp && now - stamp < RELOAD_RETRY_WINDOW_MS;
  } catch {
    return true;
  }
}
