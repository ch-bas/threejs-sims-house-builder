import { safeGetItem, safeSetItem } from './safe-storage';

/**
 * The app's version and the last one this browser opened (#931). The build
 * stamps `package.json`'s version in (`next.config.mjs`); the stored "seen"
 * version is what a "What's new" card compares it with, so a returning
 * player hears about an update once.
 */

/** This build's version; "0.0.0" outside a Next build (tests). */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';

export const SEEN_VERSION_STORAGE_KEY = 'standalone-room-organizer-seen-version';

type Version = readonly [number, number, number];

/** "1.36.0" as numbers; null for anything else (a pre-release, junk). */
export function parseVersion(value: string | null): Version | null {
  if (value === null) return null;
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The stored last-seen version; null when absent or not a version. */
export function loadSeenVersion(storage?: Storage): string | null {
  const raw = safeGetItem(SEEN_VERSION_STORAGE_KEY, storage);
  return parseVersion(raw) ? raw : null;
}

/**
 * Note that this browser opened `current`, and say what it had seen before
 * (null: nothing, or a value that wasn't a version). Never moves the stamp
 * back: an older build served from a cache leaves the newer one in place.
 */
export function stampSeenVersion(current: string, storage?: Storage): string | null {
  const before = loadSeenVersion(storage);
  const now = parseVersion(current);
  if (!now) return before;
  const seen = parseVersion(before);
  if (!seen || compareVersions(seen, now) < 0) safeSetItem(SEEN_VERSION_STORAGE_KEY, current, storage);
  return before;
}

/**
 * Whether an update came since the player was last here: a version newer
 * than the one stamped, or no stamp at all on a browser that already holds a
 * house (it was here before the stamp existed). A first run is not an
 * update: the start chooser greets it.
 */
export function updatedSinceLastVisit(seenBefore: string | null, current: string, hasSavedHouse: boolean): boolean {
  const now = parseVersion(current);
  if (!now) return false;
  const seen = parseVersion(seenBefore);
  if (!seen) return hasSavedHouse;
  return compareVersions(seen, now) < 0;
}

let sessionSeenBefore: string | null | undefined;

/**
 * Once per page load: stamp this version and remember what was seen before
 * it, for whatever asks later in the session.
 */
export function noteVersionOpened(current: string = APP_VERSION): string | null {
  if (sessionSeenBefore === undefined) sessionSeenBefore = stampSeenVersion(current);
  return sessionSeenBefore;
}

/** Tests only: a fresh page load. */
export function resetVersionSessionForTests(): void {
  sessionSeenBefore = undefined;
}
