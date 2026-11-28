import { formatAge } from './format';
import { safeGetItem, safeSetItem } from './safe-storage';

/**
 * Keeping the houses in this browser (#928). Everything the editor holds
 * lives in localStorage, which a browser may clear under storage pressure
 * unless the site is marked persistent, and which Safari clears after a
 * week without a visit. This module records what the browser answered when
 * asked to keep the site's storage, and when the last backup file was
 * written, and decides when a backup reminder is due. No React; the store
 * and the Storage API are passed in or default to the browser's.
 */

/** Small preference record; not carried by backups, it describes this browser. */
export const STORAGE_CARE_KEY = 'standalone-room-organizer-storage-care';

/** What `navigator.storage.persist()` answered. */
export type PersistAnswer = 'granted' | 'denied';

export interface StorageCare {
  /** 'granted' once the browser said yes; null until then. */
  persist: 'granted' | null;
  /**
   * When the browser last said no, or null. A no is not final: Chromium
   * decides by engagement, which grows, so it is asked again later.
   */
  persistDeniedAt: number | null;
  /** When the last backup file was written, or null for never. */
  lastBackupAt: number | null;
  /** Local days (`dayKey`) with edits since the last backup. */
  editDays: readonly string[];
  /** When the backup reminder last showed, or null. */
  remindedAt: number | null;
  /** The player turned the reminder off (Storage & backup). */
  remindersOff: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const EMPTY: StorageCare = { persist: null, persistDeniedAt: null, lastBackupAt: null, editDays: [], remindedAt: null, remindersOff: false };

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The stored record, validated field by field; anything unreadable reads as unset. */
export function readStorageCare(storage?: Storage): StorageCare {
  const raw = safeGetItem(STORAGE_CARE_KEY, storage);
  if (!raw) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!isRecord(parsed)) return EMPTY;
  const days = Array.isArray(parsed.editDays) ? parsed.editDays : [];
  return {
    persist: parsed.persist === 'granted' ? 'granted' : null,
    persistDeniedAt: finiteOrNull(parsed.persistDeniedAt),
    lastBackupAt: finiteOrNull(parsed.lastBackupAt),
    editDays: days.filter((day): day is string => typeof day === 'string' && DAY_KEY.test(day)).slice(-MAX_EDIT_DAYS),
    remindedAt: finiteOrNull(parsed.remindedAt),
    remindersOff: parsed.remindersOff === true,
  };
}

const listeners = new Set<() => void>();

/** Called after every in-tab change to the record. */
export function subscribeStorageCare(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function writeStorageCare(patch: Partial<StorageCare>, storage?: Storage): void {
  const next = { ...readStorageCare(storage), ...patch };
  // Best effort: a lost record only means the line reads "No backup yet".
  safeSetItem(STORAGE_CARE_KEY, JSON.stringify(next), storage);
  for (const listener of listeners) listener();
}

/** A backup file was just written: edits count again from here. */
export function recordBackup(at: number, storage?: Storage): void {
  writeStorageCare({ lastBackupAt: at, editDays: [] }, storage);
}

/** The house was edited at `at`; written only on a day not yet counted. */
export function recordEditDay(at: number, storage?: Storage): void {
  const care = readStorageCare(storage);
  const editDays = noteEditDay(care.editDays, at);
  if (editDays !== care.editDays) writeStorageCare({ editDays }, storage);
}

/** The backup reminder showed at `at`: the next waits a week. */
export function recordReminded(at: number, storage?: Storage): void {
  writeStorageCare({ remindedAt: at }, storage);
}

/** The reminder switch in Storage & backup. */
export function setBackupReminders(on: boolean, storage?: Storage): void {
  writeStorageCare({ remindersOff: !on }, storage);
}

/** A no is kept only as its time (`persistDeniedAt`); a yes clears it. */
export function recordPersistAnswer(answer: PersistAnswer, at: number, storage?: Storage): void {
  writeStorageCare(answer === 'granted' ? { persist: 'granted', persistDeniedAt: null } : { persistDeniedAt: at }, storage);
}

/** After a no, a browser that asks with a prompt is asked again only after this long. */
export const PERSIST_ASK_AGAIN_MS = 7 * DAY_MS;

export interface PersistAskContext {
  now: number;
  /**
   * Whether `persist()` shows the player a prompt here (Firefox). Chromium
   * and Safari answer silently from their own heuristics, so asking them
   * again each session costs nothing and lets a grown engagement count.
   */
  prompts: boolean;
}

/**
 * Whether to ask the browser to keep the site's storage (at most once a
 * session; the caller tracks that). Never after a yes. After a no: a
 * prompting browser waits a week, so the prompt never repeats inside it;
 * a silent one is asked again in the next session with an edit. A no dated
 * ahead of the clock counts as long ago.
 */
export function shouldAskToPersist(care: StorageCare, context: PersistAskContext): boolean {
  if (care.persist === 'granted') return false;
  if (care.persistDeniedAt === null || !context.prompts) return true;
  const since = context.now - care.persistDeniedAt;
  return since < 0 || since >= PERSIST_ASK_AGAIN_MS;
}

/** Whether this browser answers `persist()` with a prompt: only Firefox does. */
export function persistPrompts(userAgent: string): boolean {
  return /\bFirefox\//.test(userAgent);
}

/** The slice of `StorageManager` used here; absent on old browsers and insecure origins. */
export interface PersistApi {
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
}

/** Ask the browser to keep the site's storage; null when it can't be asked. */
export async function requestPersistence(api: PersistApi | undefined): Promise<PersistAnswer | null> {
  if (!api?.persist) return null;
  try {
    return (await api.persist()) ? 'granted' : 'denied';
  } catch {
    return null;
  }
}

/** Whether the site's storage is kept now, without asking; null when unknown. */
export async function queryPersistence(api: PersistApi | undefined): Promise<boolean | null> {
  if (!api?.persisted) return null;
  try {
    return await api.persisted();
  } catch {
    return null;
  }
}

/** The local calendar day of `at`, as `YYYY-MM-DD`. */
export function dayKey(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Edit days kept: enough for any rule here, never a growing list. */
const MAX_EDIT_DAYS = 31;

/** `days` with the day of `at` added; the same array when it is already there. */
export function noteEditDay(days: readonly string[], at: number): readonly string[] {
  const key = dayKey(at);
  if (days.includes(key)) return days;
  return [...days, key].slice(-MAX_EDIT_DAYS);
}

/** With no backup at all, edits on this many separate days call for one. */
export const BACKUP_FIRST_AFTER_DAYS = 3;
/** A backup older than this, with edits since, calls for a new one. */
export const BACKUP_STALE_AFTER_MS = 14 * DAY_MS;
/** The reminder shows at most this often. */
export const BACKUP_REMINDER_EVERY_MS = 7 * DAY_MS;

export interface BackupReminderInput {
  now: number;
  lastBackupAt: number | null;
  /** Days with edits since the last backup (`noteEditDay`). */
  editDays: readonly string[];
  lastRemindedAt: number | null;
  /** EXPLORE is on: the reminder waits. */
  exploring: boolean;
}

/**
 * Whether to suggest a backup now. With none yet: after edits on three
 * separate days. With one: once it is more than two weeks old and the house
 * changed since. Never during EXPLORE, at most once a week; a reminder time
 * ahead of the clock counts as long ago, so a clock set back can't silence
 * it for good.
 */
export function backupReminderDue(input: BackupReminderInput): boolean {
  if (input.exploring) return false;
  if (input.lastRemindedAt !== null) {
    const since = input.now - input.lastRemindedAt;
    if (since >= 0 && since < BACKUP_REMINDER_EVERY_MS) return false;
  }
  if (input.lastBackupAt === null) return input.editDays.length >= BACKUP_FIRST_AFTER_DAYS;
  return input.editDays.length > 0 && input.now - input.lastBackupAt > BACKUP_STALE_AFTER_MS;
}

/** `backupReminderDue` from the stored record; never once the player turned it off. */
export function backupReminderDueFor(care: StorageCare, now: number, exploring: boolean): boolean {
  if (care.remindersOff) return false;
  return backupReminderDue({ now, lastBackupAt: care.lastBackupAt, editDays: care.editDays, lastRemindedAt: care.remindedAt, exploring });
}

/**
 * Whether Add to Home Screen would keep the houses: Safari on iOS and
 * iPadOS clears a site's storage after seven days without a visit unless it
 * runs from the home screen. An iPad asks for the desktop site, so it reads
 * as a Mac with a touch screen.
 */
export function homeScreenKeepsHouses(userAgent: string, maxTouchPoints: number, standalone: boolean): boolean {
  if (standalone) return false;
  return /\b(iPhone|iPad|iPod)\b/.test(userAgent) || (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1);
}

/** What the reminder says: since when, why, and on iOS how to keep the houses for good. */
export function backupReminderMessage(care: StorageCare, now: number, homeScreen: boolean): string {
  const first =
    care.lastBackupAt === null
      ? 'Your houses are only in this browser. A backup file keeps a copy if it clears its data.'
      : `Your last backup was ${formatAge(Math.max(0, now - care.lastBackupAt))}. Back up to keep your latest changes.`;
  return homeScreen ? `${first} Add to Home Screen keeps your houses from being cleared.` : first;
}
