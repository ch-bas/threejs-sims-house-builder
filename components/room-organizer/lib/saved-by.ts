import { askConfirm } from './confirm-dialog';
import { createChannel } from './editor-notices';

/**
 * Which version of the app last saved the house (#933). With the offline
 * worker, a tab can run an older build after a newer one has saved: the
 * older schema would drop what it doesn't know, and its autosave would make
 * that permanent. Each save stamps the version that wrote it; a build older
 * than the stamp doesn't save over it unasked.
 *
 * It asks instead, once a session: "Save here anyway" re-stamps the house
 * with this version and saves, for the rest of the session; "Not now" keeps
 * the house as the newer version left it, and the save indicator offers the
 * same choice later. A stamp can be "newer" for no good reason (a reverted
 * release, a mis-bumped version), so the player can always keep working.
 *
 * The version comes from the build (`NEXT_PUBLIC_APP_VERSION`, package.json's
 * version, next.config.mjs); without one (tests, an unstamped build) nothing
 * is stamped or checked. A device-local note: not part of backups.
 */

export const SAVED_BY_STORAGE_KEY = 'standalone-room-organizer-saved-by';

/** This build's version, or null outside a stamped build. */
export const BUILD_VERSION: string | null = process.env.NEXT_PUBLIC_APP_VERSION ?? null;

type Version = readonly [number, number, number];

function parseVersion(value: string | null | undefined): Version | null {
  if (value === null || value === undefined) return null;
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Whether `stamp` names a version newer than `current` (junk and absence never do). */
export function isNewerVersion(stamp: string | null | undefined, current: string | null): boolean {
  const a = parseVersion(stamp);
  const b = parseVersion(current);
  if (!a || !b) return false;
  return (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0;
}

/** The newer version that last saved the house, or null when this build may save. */
export function newerSaver(storage: Pick<Storage, 'getItem'>, current: string | null): string | null {
  try {
    const stamp = storage.getItem(SAVED_BY_STORAGE_KEY);
    return isNewerVersion(stamp, current) ? stamp : null;
  } catch {
    return null;
  }
}

/** Whether the stored house was last saved by a newer build than `current`. */
export function savedByNewer(storage: Pick<Storage, 'getItem'>, current: string | null): boolean {
  return newerSaver(storage, current) !== null;
}

/** Stamps `current` as the version that saved the house; best effort, it is a few bytes. */
export function stampSavedBy(storage: Pick<Storage, 'setItem'>, current: string | null): void {
  if (!parseVersion(current) || current === null) return;
  try {
    storage.setItem(SAVED_BY_STORAGE_KEY, current);
  } catch {
    /* the save itself fitted; the stamp only guards older builds */
  }
}

// ── The choice, per session ─────────────────────────────────────────────────

let saveHereChosen = false;
let asked = false;
const chosen = createChannel<void>();

/** Whether the player chose, this session, to save over a newer version's house. */
export function savingHereChosen(): boolean {
  return saveHereChosen;
}

/** "Save here anyway": saves go ahead for the rest of the session; the autosave retries now. */
export function chooseSaveHere(): void {
  saveHereChosen = true;
  chosen.emit(undefined);
}

/** Calls `listener` when the player chose to save here (the autosave saves at once). */
export function subscribeSaveHereChosen(listener: () => void): () => void {
  return chosen.subscribe(listener);
}

/** Tests: a fresh session. */
export function resetSavedByChoice(): void {
  saveHereChosen = false;
  asked = false;
}

/** The question's words; the reload hint only when a newer worker really waits. */
export function newerSaveQuestion(stamp: string, current: string, updateWaiting: boolean): { title: string; body: string } {
  return {
    title: `This house was last saved by version ${stamp}, newer than this one (${current}).`,
    body:
      'Saving here can drop details only the newer version knows.' +
      (updateWaiting ? ' A newer version is ready: reloading the page opens it.' : ''),
  };
}

/**
 * The first refused save of a session asks (not as a danger: both answers
 * keep the house). Later refusals stay quiet: the save indicator says it.
 * Resolves true when the player chose to save here.
 */
export async function askToSaveHere(
  stamp: string,
  current: string,
  updateWaiting: () => Promise<boolean> = () => Promise.resolve(false)
): Promise<boolean> {
  if (asked || saveHereChosen) return saveHereChosen;
  asked = true;
  const { title, body } = newerSaveQuestion(stamp, current, await updateWaiting().catch(() => false));
  const yes = await askConfirm({ title, body, confirmLabel: 'Save here anyway', cancelLabel: 'Not now' });
  if (yes) chooseSaveHere();
  return yes;
}

/** A note for a saved layout written by a newer version, or null (#933). */
export function newerLibraryNote(savedBy: string | undefined, current: string | null = BUILD_VERSION): string | null {
  if (!isNewerVersion(savedBy, current) || !savedBy || !current) return null;
  return `It was saved by a newer version (${savedBy}) than this one (${current}), so details only that version knows may be missing.`;
}
