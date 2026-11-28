import { useEffect, useRef } from 'react';
import { PLAN_IMAGES_NOT_IN_BACKUP, backupFileName, backupNamesPlanImages, createBackup, inlineBackupPlanImages, libraryHousesLeftOut } from '../lib/backup';
import { plural } from '../lib/backup-file';
import {
  backupReminderDueFor,
  backupReminderMessage,
  dayKey,
  homeScreenKeepsHouses,
  readStorageCare,
  recordBackup,
  recordEditDay,
  recordReminded,
} from '../lib/backup-reminder';
import { notify } from '../lib/editor-notices';
import { modalBlocksFiles } from '../lib/file-drop';
import { downloadTextFile } from '../lib/plan-export/download';
import { isTourSession } from '../lib/tour-session';
import { isLoadedLayout } from './use-achievements';
import { layoutStore } from './use-layout-store';
import type { RoomLayout } from '../lib/types';

/** Said when the backup file couldn't be written. */
export const BACKUP_FAILED_MESSAGE = 'Couldn’t write the backup file. Nothing was recorded as backed up.';

/**
 * Download everything this browser keeps as one backup file (#615): the
 * house, saved layouts, restore points, sets and settings. Storage & backup
 * and the backup reminder (#928) both lead here. Async, so building the
 * file may wait on stored data; resolves true only when a complete file was
 * handed to the browser, and only then is the backup recorded. Callers show
 * `BACKUP_FAILED_MESSAGE` on false.
 */
export async function downloadBackup(layout: RoomLayout): Promise<boolean> {
  let partial = false;
  try {
    // Stored floor-plan images go back into the file, so it stands alone (#936).
    const bundle = await inlineBackupPlanImages(createBackup(layout));
    downloadTextFile(backupFileName(), 'application/json', JSON.stringify(bundle));
    partial = backupNamesPlanImages(bundle);
  } catch {
    return false;
  }
  // A floor-plan image that couldn't be put in the file (#936): said here,
  // and the backup isn't counted as done. The file did reach the browser,
  // so this isn't reported as a failed backup on top.
  if (partial) {
    notify(PLAN_IMAGES_NOT_IN_BACKUP, 'error');
    return true;
  }
  // Recorded once the download has been handed to the browser: a page
  // can't tell whether the player then cancels the save dialog, so a
  // cancelled download still counts as a backup here.
  recordBackup(Date.now());
  const leftOut = libraryHousesLeftOut();
  if (leftOut > 0) {
    notify(
      `${plural(leftOut, 'saved layout')} couldn’t be read and ${leftOut === 1 ? 'is' : 'are'} not in the backup. ${leftOut === 1 ? 'It stays' : 'They stay'} in this browser.`,
      'info'
    );
  }
  return true;
}

/** `downloadBackup` from a click: a failure says so. */
export function backUpFromClick(layout: RoomLayout): void {
  const failed = (): void => void notify(BACKUP_FAILED_MESSAGE, 'error');
  void downloadBackup(layout).then((done) => {
    if (!done) failed();
  }, failed);
}

/** After an edit, the reminder waits this long for the player to pause; it looks again as often while held. */
export const REMIND_AFTER_EDIT_MS = 4_000;

function homeScreenHelps(): boolean {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return homeScreenKeepsHouses(navigator.userAgent, navigator.maxTouchPoints ?? 0, standalone);
}

/**
 * A question or a dialog that holds the page is up: a notice now would talk
 * over it. The same test as file drops; the drawer (kept mounted while
 * closed) is the caller's `blocked`.
 */
function modalOpen(): boolean {
  return modalBlocksFiles(document) !== null;
}

const REMINDER_SLOT = 'backup-reminder';

function showReminder(message: string): void {
  notify(message, 'info', {
    slot: REMINDER_SLOT,
    action: { label: 'Back up', name: 'Back up all houses to a file', run: () => backUpFromClick(layoutStore.getState().layout) },
  });
}

/**
 * Show the backup reminder if it is due: one notice with a Back up button,
 * closed like any other; the next can't come for a week. Returns what it
 * said, or null.
 */
export function offerBackupReminder(now: number): string | null {
  const care = readStorageCare();
  if (!backupReminderDueFor(care, now, false)) return null;
  recordReminded(now);
  const message = backupReminderMessage(care, now, homeScreenHelps());
  showReminder(message);
  return message;
}

/** How often a shown reminder checks whether something covers it. */
export const REMINDER_WATCH_MS = 250;

/** The reminder is on screen (the notice host marks its slot). */
function reminderOnScreen(): boolean {
  return document.querySelector(`[data-notice-slot="${REMINDER_SLOT}"]`) !== null;
}

/**
 * The backup reminder (#928). Every real edit (not a whole-house load, not
 * in a shared-link tour) counts its day; a few seconds after an edit, once
 * the player pauses, the rule in `lib/backup-reminder` decides whether to
 * suggest a backup. It looks once a day per tab (a tab left open looks
 * again on a new day). `blocked` (EXPLORE, photo mode, the open drawer), a
 * question or a modal hold it back: it waits until they are gone. One that
 * times out under them shows again once they close.
 */
export function useBackupReminder(layout: RoomLayout, blocked: boolean): void {
  const lastRef = useRef<RoomLayout | null>(null);
  const blockedRef = useRef(blocked);
  const dayRef = useRef<string | null>(null);
  const lookedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const watchRef = useRef<number | null>(null);

  useEffect(() => {
    blockedRef.current = blocked;
  }, [blocked]);

  useEffect(() => {
    const before = lastRef.current;
    if (before === layout) return;
    lastRef.current = layout;
    if (before === null || isLoadedLayout(layout) || isTourSession()) return;
    const now = Date.now();
    // Every edit: a backup earlier today cleared the day, and a later edit counts it again.
    recordEditDay(now);
    const day = dayKey(now);
    if (dayRef.current !== day) {
      dayRef.current = day;
      lookedRef.current = false;
    }
    if (lookedRef.current) return;
    // A modal, the open drawer, EXPLORE or photo mode can come over the
    // reminder while it shows: if it is gone by the time they close (it
    // timed out underneath), it is shown again, once.
    const watch = (message: string, covered: boolean): void => {
      watchRef.current = window.setTimeout(() => {
        watchRef.current = null;
        const hidden = blockedRef.current || modalOpen();
        const onScreen = reminderOnScreen();
        if (hidden) {
          // Already gone before anything covered it (the player closed it): done.
          if (covered || onScreen) watch(message, true);
          return;
        }
        if (!onScreen) {
          if (covered && !isTourSession()) showReminder(message);
          return;
        }
        watch(message, false);
      }, REMINDER_WATCH_MS);
    };
    const look = (): void => {
      timerRef.current = null;
      if (isTourSession()) return;
      if (blockedRef.current || modalOpen()) {
        timerRef.current = window.setTimeout(look, REMIND_AFTER_EDIT_MS);
        return;
      }
      lookedRef.current = true;
      const message = offerBackupReminder(Date.now());
      if (message !== null) watch(message, false);
    };
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(look, REMIND_AFTER_EDIT_MS);
  }, [layout]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (watchRef.current !== null) window.clearTimeout(watchRef.current);
    },
    []
  );
}
