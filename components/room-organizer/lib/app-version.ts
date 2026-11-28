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

/**
 * Whether the What's new card (#931) has news for this browser, given the
 * release its lines describe (null: no lines). Asked for from Help, it
 * always shows; after an update, only when that release is newer than the
 * version seen before, so a fix-only release doesn't repeat the last card.
 * The card is offered only on a browser that held a house.
 */
export function whatsNewIsNews(contentVersion: string | null, asked: boolean, seenBefore: string | null): boolean {
  if (contentVersion === null) return false;
  return asked || updatedSinceLastVisit(seenBefore, contentVersion, true);
}

/**
 * Whether to offer What's new as the editor opens (#931): only to a
 * returning player (a built house, the start chooser answered) after an
 * update. A first run never: the chooser and Getting started come first.
 */
export function offersWhatsNew(seenBefore: string | null, current: string, returningVisit: boolean): boolean {
  return returningVisit && updatedSinceLastVisit(seenBefore, current, true);
}

let sessionSeenBefore: string | null | undefined;

/**
 * Once per page load: the version this browser had seen before it, read
 * (not stamped) on first ask and kept for the rest of the session.
 */
export function versionSeenBefore(storage?: Storage): string | null {
  if (sessionSeenBefore === undefined) sessionSeenBefore = loadSeenVersion(storage);
  return sessionSeenBefore;
}

/**
 * This build has been seen: stamp it (never backwards). Called when there
 * is nothing to tell, or once What's new has shown or been dismissed, so a
 * card never seen (EXPLORE all session, a failed load) is offered again.
 */
export function settleSeenVersion(current: string = APP_VERSION, storage?: Storage): void {
  versionSeenBefore(storage);
  stampSeenVersion(current, storage);
}

/** Tests only: a fresh page load. */
export function resetVersionSessionForTests(): void {
  sessionSeenBefore = undefined;
}
