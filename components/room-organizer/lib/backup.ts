import { STORAGE_KEY } from './constants';
import { importCustomSets, listCustomSets, parseCustomSet, type CustomFurnitureSet } from './custom-sets';
import {
  LIBRARY_KEY_PREFIX,
  countUnreadableSavedLayouts,
  deleteNamedLayout,
  layoutSlugExists,
  librarySlotId,
  listSavedLayouts,
  loadNamedLayout,
  saveNamedLayout,
} from './library';
import { addReceivedLayout, listReceivedLayouts, removeReceivedLayout } from './pasteboard';
import {
  MAX_RECOVERY_COPIES,
  RECOVERY_STORAGE_KEY,
  localStorageOrNull,
  readRecoveryCopies,
  sameLayoutContent,
} from './persistence';
import { isUntouched } from './restore-point';
import { parseStoredLayout } from './schema';
import { MAX_STORAGE_ENTRY_CHARS, VERSION_HISTORY_STORAGE_KEY, importSnapshots } from './version-history';
import type { RoomLayout } from './types';

/**
 * One-file backup of everything the editor keeps in this browser (#620): the
 * open house, the library, restore points, recovery copies, received houses,
 * custom sets and settings. localStorage lives in one browser profile, on an
 * origin shared with other projects; clearing site data loses all of it.
 *
 * A file is validated whole before anything is written: every house goes
 * through `parseStoredLayout`, every set through `parseCustomSet`, and a part
 * that is missing, of the wrong shape or holds anything unreadable marks the
 * backup incomplete — then Replace deletes nothing. The open house is never
 * written here: the caller applies it like any other load, so it takes the
 * restore point, the undo step and the achievements rule.
 */

export const BACKUP_FORMAT = 'house-builder-backup';
/** Bumped when the bundle changes shape; a newer file is refused, not misread. */
export const BACKUP_VERSION = 1;

/**
 * The preference keys a backup carries, and the only keys a restore writes
 * besides the parts above. An explicit list: a crafted file must not plant
 * arbitrary keys, nor reach the main save or another site's data.
 */
export const BACKUP_SETTINGS_KEYS: readonly string[] = [
  'standalone-room-organizer-achievements',
  'standalone-room-organizer-recent-colors',
  'standalone-room-organizer-sidebar-tab',
  'standalone-room-organizer-welcome-dismissed',
];

/** Settings values are small preferences; anything bigger isn't one. */
const MAX_SETTING_CHARS = 16 * 1024;

export interface BackupLibraryEntry {
  name: string;
  savedAt: number;
  layout: unknown;
}

export interface BackupReceivedEntry {
  name: string;
  receivedAt: number;
  layout: unknown;
}

export interface BackupRecoveryCopy {
  savedAt: number | null;
  /** Kept as stored: a recovery copy is a house that may not open. */
  raw: string;
}

/** The file, as written. */
export interface BackupBundle {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  /** The open house, or null when there was none. */
  main: unknown;
  library: BackupLibraryEntry[];
  /** The restore-point ring's entries, as stored. */
  restorePoints: unknown[];
  recoveryCopies: BackupRecoveryCopy[];
  received: BackupReceivedEntry[];
  customSets: unknown[];
  settings: Record<string, string>;
}

type BackupPart = 'library' | 'restorePoints' | 'recoveryCopies' | 'received' | 'customSets' | 'settings';

/** A file read and validated: what a restore works from. */
export interface ParsedBackup {
  exportedAt: number;
  house: RoomLayout | null;
  /** `stored`: the house as the file holds it, already validated; `layout`: as it opens. */
  library: { name: string; savedAt: number; stored: RoomLayout; layout: RoomLayout }[];
  /** Entries whose layout passed the schema; `importSnapshots` reads them again. */
  restorePoints: unknown[];
  recoveryCopies: BackupRecoveryCopy[];
  received: { receivedAt: number; layout: RoomLayout }[];
  customSets: CustomFurnitureSet[];
  settings: Record<string, string>;
  /** Entries that failed validation and are left out. */
  invalid: number;
  /**
   * Whether every part is present, of the right shape and fully readable.
   * Only then may Replace delete anything.
   */
  complete: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function readKey(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Everything stored, as one bundle. `current` is the house on screen: the
 * autosave can be a debounce behind it, and the backup must hold the latest.
 */
export function createBackup(current: RoomLayout | null, now: number = Date.now()): BackupBundle {
  const storage = localStorageOrNull();
  const library: BackupLibraryEntry[] = [];
  for (const entry of listSavedLayouts()) {
    // The blob as stored, not as loaded: fields a load repairs or this
    // version doesn't know survive the round trip. One that doesn't open is
    // left out (`libraryHousesLeftOut`).
    const layout = parseJson(readKey(storage, `${LIBRARY_KEY_PREFIX}${entry.id}`));
    if (parseStoredLayout(layout)) library.push({ name: entry.name, savedAt: entry.savedAt, layout });
  }
  const ring = parseJson(readKey(storage, VERSION_HISTORY_STORAGE_KEY));
  const settings: Record<string, string> = {};
  for (const key of BACKUP_SETTINGS_KEYS) {
    const value = readKey(storage, key);
    if (value !== null) settings[key] = value;
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    main: current ?? parseJson(readKey(storage, STORAGE_KEY)),
    library,
    restorePoints: Array.isArray(ring) ? ring : [],
    recoveryCopies: readRecoveryCopies().map(({ savedAt, raw }) => ({ savedAt, raw })),
    received: listReceivedLayouts().map(({ name, receivedAt, layout }) => ({ name, receivedAt, layout })),
    customSets: listCustomSets(),
    settings,
  };
}

/**
 * Saved layouts a backup can't carry because they don't open — listed ones
 * whose stored house fails the schema, and index entries the library can't
 * list. They stay in this browser; the backup notice says how many.
 */
export function libraryHousesLeftOut(): number {
  const storage = localStorageOrNull();
  const broken = listSavedLayouts().filter(
    (entry) => parseStoredLayout(parseJson(readKey(storage, `${LIBRARY_KEY_PREFIX}${entry.id}`))) === null
  ).length;
  return broken + countUnreadableSavedLayouts();
}

/** The file name a backup downloads as. */
export function backupFileName(now: number = Date.now()): string {
  return `house-builder-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
}

export type BackupParseFailure = 'not-json' | 'not-backup' | 'newer-version';

export type BackupParseResult = { ok: true; bundle: ParsedBackup } | { ok: false; reason: BackupParseFailure };

/** Why a file isn't a backup this version can restore, in words. */
export const BACKUP_FAILURE_TEXT: Record<BackupParseFailure, string> = {
  'not-json': 'This file isn’t a backup — it isn’t JSON.',
  'not-backup': 'This file isn’t a backup made by this editor. To open a single house, use Import in Layout actions.',
  'newer-version': 'This backup was made by a newer version of the editor. Reload to update, then try again.',
};

/** Read a backup file's text and validate all of it. */
export function parseBackup(text: string): BackupParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!isRecord(json) || json.format !== BACKUP_FORMAT) return { ok: false, reason: 'not-backup' };
  const version = finite(json.version);
  if (version === null || version < 1) return { ok: false, reason: 'not-backup' };
  if (version > BACKUP_VERSION) return { ok: false, reason: 'newer-version' };

  let invalid = 0;
  const malformed = new Set<BackupPart>();
  const part = (name: BackupPart): unknown[] => {
    const value = json[name];
    if (Array.isArray(value)) return value;
    malformed.add(name);
    return [];
  };
  const reject = (name: BackupPart): void => {
    invalid += 1;
    malformed.add(name);
  };

  const library: ParsedBackup['library'] = [];
  for (const entry of part('library')) {
    const parsed = isRecord(entry) ? parseStoredLayout(entry.layout) : null;
    if (!parsed || !isRecord(entry) || typeof entry.name !== 'string') {
      reject('library');
      continue;
    }
    // Validated, and written back as it was stored, like any library blob:
    // loading it runs the schema's repairs again.
    library.push({ name: entry.name, savedAt: finite(entry.savedAt) ?? 0, stored: entry.layout as RoomLayout, layout: parsed });
  }

  const restorePoints: unknown[] = [];
  for (const entry of part('restorePoints')) {
    if (isRecord(entry) && finite(entry.savedAt) !== null && parseStoredLayout(entry.layout)) restorePoints.push(entry);
    else reject('restorePoints');
  }

  const recoveryCopies: BackupRecoveryCopy[] = [];
  for (const entry of part('recoveryCopies')) {
    if (isRecord(entry) && typeof entry.raw === 'string' && entry.raw.length <= MAX_STORAGE_ENTRY_CHARS) {
      recoveryCopies.push({ savedAt: finite(entry.savedAt), raw: entry.raw });
    } else {
      reject('recoveryCopies');
    }
  }

  const received: ParsedBackup['received'] = [];
  for (const entry of part('received')) {
    const layout = isRecord(entry) ? parseStoredLayout(entry.layout) : null;
    if (layout && isRecord(entry)) received.push({ receivedAt: finite(entry.receivedAt) ?? 0, layout });
    else reject('received');
  }

  const customSets: CustomFurnitureSet[] = [];
  for (const entry of part('customSets')) {
    const set = parseCustomSet(entry);
    if (set) customSets.push(set);
    else reject('customSets');
  }

  const settings: Record<string, string> = {};
  if (isRecord(json.settings)) {
    for (const [key, value] of Object.entries(json.settings)) {
      if (BACKUP_SETTINGS_KEYS.includes(key) && typeof value === 'string' && value.length <= MAX_SETTING_CHARS) {
        settings[key] = value;
      } else {
        reject('settings');
      }
    }
  } else {
    malformed.add('settings');
  }

  const house = parseStoredLayout(json.main ?? null);
  if (json.main !== null && json.main !== undefined && !house) invalid += 1;

  return {
    ok: true,
    bundle: {
      exportedAt: finite(json.exportedAt) ?? 0,
      house,
      library,
      restorePoints,
      recoveryCopies,
      received,
      customSets,
      settings,
      invalid,
      complete: malformed.size === 0 && invalid === 0,
    },
  };
}

/** What a backup holds — only what passed validation — for the confirm before a restore. */
export interface BackupSummary {
  hasHouse: boolean;
  library: number;
  restorePoints: number;
  received: number;
  customSets: number;
  /** Entries left out because they couldn't be read. */
  invalid: number;
  /** False when Replace will delete nothing, because part of the file is missing or unreadable. */
  complete: boolean;
}

export function summarizeBackup(backup: ParsedBackup): BackupSummary {
  return {
    hasHouse: backup.house !== null,
    library: backup.library.length,
    restorePoints: backup.restorePoints.length,
    received: backup.received.length,
    customSets: backup.customSets.length,
    invalid: backup.invalid,
    complete: backup.complete,
  };
}

/**
 * `merge` adds the backup beside what is stored and replaces nothing: a
 * library house whose name is taken by a different house is saved under a
 * new name, and the backup's open house goes to the library. `replace` makes
 * the open house, library, received houses, custom sets and settings the
 * backup's — deleting what the backup lacks only when the whole file was
 * readable and every write succeeded. Restore points and recovery copies are
 * always merged, and this browser's own are never dropped for them.
 */
export type RestoreMode = 'merge' | 'replace';

export interface RestoreReport {
  /** With `replace`: the house the caller must open. Never written here. */
  house: RoomLayout | null;
  /**
   * With `replace`: the backup has a house, but it isn't opened because part
   * of the restore failed — the open house stays.
   */
  houseWithheld: boolean;
  library: number;
  restorePoints: number;
  recoveryCopies: number;
  received: number;
  customSets: number;
  settings: number;
  /** Entries that failed validation and were left out. */
  invalid: number;
  /** Entries left out for lack of room under a cap (restore points, recovery copies, sets). */
  overLimit: number;
  /** Writes the browser refused (full or blocked storage). */
  failed: number;
  /** With `replace`: deletions were held back because the file wasn't complete or a write failed. */
  keptExtras: boolean;
}

/** A library name not in use yet: `name (backup)`, then `(backup 2)`… */
function freeLibraryName(name: string, free: (candidate: string) => boolean): string {
  for (let n = 1; ; n += 1) {
    const candidate = `${name} (backup${n === 1 ? '' : ` ${n}`})`;
    if (free(candidate)) return candidate;
  }
}

/** Content equality after both sides went through the schema, as stored houses do. */
function sameHouseContent(parsed: RoomLayout, layout: RoomLayout): boolean {
  return sameLayoutContent(parsed, parseStoredLayout(JSON.parse(JSON.stringify(layout))) ?? layout);
}

/** Whether the library already holds this very house under any name. */
function libraryHolds(layout: RoomLayout): boolean {
  return listSavedLayouts().some((entry) => {
    const stored = loadNamedLayout(entry.id);
    return stored !== null && sameLayoutContent(stored, layout);
  });
}

/**
 * Restore a validated backup. `current` is the open house: with `merge` the
 * backup's house is saved to the library unless it is that house, already
 * in the library, or untouched.
 */
export function restoreBackup(backup: ParsedBackup, mode: RestoreMode, current: RoomLayout): RestoreReport {
  const report: RestoreReport = {
    house: null,
    houseWithheld: false,
    library: 0,
    restorePoints: 0,
    recoveryCopies: 0,
    received: 0,
    customSets: 0,
    settings: 0,
    invalid: backup.invalid,
    overLimit: 0,
    failed: 0,
    keptExtras: false,
  };
  const replace = mode === 'replace';
  // Replace deletes only on a whole, readable file (#620 review).
  const mayDelete = replace && backup.complete;
  if (replace && !backup.complete) report.keptExtras = true;

  const points = importSnapshots(backup.restorePoints);
  report.restorePoints = points.added;
  report.overLimit += points.skipped;
  restoreRecoveryCopies(backup.recoveryCopies, report);
  restoreLibrary(backup, replace, mayDelete, current, report);
  restoreReceived(backup.received, replace, mayDelete, report);

  const sets = importCustomSets(backup.customSets, { replace: mayDelete });
  if (sets === null) report.failed += 1;
  else {
    report.customSets = sets.added;
    report.overLimit += sets.skipped;
  }

  restoreSettings(backup.settings, replace, report);

  if (replace && backup.house) {
    // Half a restore must not also swap the house: the open one stays, and
    // the notice says what didn't fit.
    if (report.failed > 0) report.houseWithheld = true;
    else report.house = backup.house;
  }
  return report;
}

function restoreLibrary(
  backup: ParsedBackup,
  replace: boolean,
  mayDelete: boolean,
  current: RoomLayout,
  report: RestoreReport
): void {
  // Slots this restore wrote: no two backup houses may land in one, and the
  // deletion pass never touches them.
  const written = new Set<string>();
  const free = (candidate: string): boolean =>
    replace ? !written.has(librarySlotId(candidate)) : !layoutSlugExists(candidate);
  let failed = 0;
  const save = (layout: RoomLayout, name: string, savedAt?: number): void => {
    const outcome = saveNamedLayout(layout, name, savedAt === undefined ? {} : { savedAt });
    if (outcome.ok) {
      written.add(outcome.entry.id);
      report.library += 1;
    } else {
      failed += 1;
    }
  };

  for (const entry of backup.library) {
    const { layout } = entry;
    let name = entry.name.trim() || layout.name || 'Untitled';
    if (!replace && libraryHolds(layout)) continue;
    if (!free(name)) name = freeLibraryName(name, free);
    save(entry.stored, name, entry.savedAt);
  }

  const house = backup.house;
  if (!replace && house && !isUntouched(house) && !sameHouseContent(house, current) && !libraryHolds(house)) {
    save(house, freeLibraryName(house.name || 'Untitled', free));
  }

  report.failed += failed;
  if (!replace) return;
  if (!mayDelete || failed > 0) {
    report.keptExtras = true;
    return;
  }
  for (const entry of listSavedLayouts()) {
    if (!written.has(entry.id)) deleteNamedLayout(entry.id);
  }
}

/**
 * Recovery copies come back only up to `MAX_RECOVERY_COPIES`, and only into
 * free room: they never evict restore points or anything else.
 */
function restoreRecoveryCopies(copies: readonly BackupRecoveryCopy[], report: RestoreReport): void {
  const storage = localStorageOrNull();
  if (!storage) return;
  const stored = readRecoveryCopies();
  const held = new Set(stored.map((copy) => copy.raw));
  let count = stored.length;
  // Newest first, as the copies are ranked when kept.
  const ordered = [...copies].sort((a, b) => (b.savedAt ?? -1) - (a.savedAt ?? -1));
  for (const copy of ordered) {
    if (held.has(copy.raw)) continue;
    if (count >= MAX_RECOVERY_COPIES) {
      report.overLimit += 1;
      continue;
    }
    const key = `${RECOVERY_STORAGE_KEY}-${copy.savedAt ?? 0}-${Math.random().toString(36).slice(2, 8) || '0'}`;
    try {
      storage.setItem(key, copy.raw);
      held.add(copy.raw);
      count += 1;
      report.recoveryCopies += 1;
    } catch {
      report.failed += 1;
    }
  }
}

function restoreReceived(
  entries: ParsedBackup['received'],
  replace: boolean,
  mayDelete: boolean,
  report: RestoreReport
): void {
  const before = listReceivedLayouts().map((entry) => entry.id);
  const kept = new Set<string>();
  let failed = 0;
  // Oldest first, so the board's cap drops the oldest, as a paste would.
  for (const { layout, receivedAt } of [...entries].sort((a, b) => a.receivedAt - b.receivedAt)) {
    const added = addReceivedLayout(layout, { now: () => receivedAt });
    if (!added) {
      failed += 1;
      continue;
    }
    kept.add(added.entry.id);
    if (!added.duplicate) report.received += 1;
  }
  report.failed += failed;
  if (!replace) return;
  // The houses the backup doesn't have go only once all of its own are in.
  if (!mayDelete || failed > 0) {
    report.keptExtras = true;
    return;
  }
  for (const id of before) if (!kept.has(id)) removeReceivedLayout(id);
}

function restoreSettings(settings: Record<string, string>, replace: boolean, report: RestoreReport): void {
  const storage = localStorageOrNull();
  if (!storage) return;
  for (const [key, value] of Object.entries(settings)) {
    if (!BACKUP_SETTINGS_KEYS.includes(key)) continue;
    try {
      if (!replace && storage.getItem(key) !== null) continue;
      storage.setItem(key, value);
      report.settings += 1;
    } catch {
      report.failed += 1;
    }
  }
}

function plural(count: number, noun: string, nouns = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : nouns}`;
}

/** One line saying what a restore did, for the notice after it. */
export function describeRestore(report: RestoreReport): string {
  const parts: string[] = [];
  if (report.house) parts.push('the house');
  if (report.library > 0) parts.push(plural(report.library, 'saved layout'));
  if (report.restorePoints > 0) parts.push(plural(report.restorePoints, 'restore point'));
  if (report.recoveryCopies > 0) parts.push(plural(report.recoveryCopies, 'recovery copy', 'recovery copies'));
  if (report.received > 0) parts.push(plural(report.received, 'received house'));
  if (report.customSets > 0) parts.push(plural(report.customSets, 'custom set'));
  if (report.settings > 0) parts.push(plural(report.settings, 'setting'));
  const lines = [
    parts.length > 0
      ? `Restored ${parts.join(', ')}.`
      : 'Nothing new to restore — this browser already holds everything in the backup.',
  ];
  if (report.invalid > 0) {
    lines.push(`${plural(report.invalid, 'part')} of the file couldn’t be read and ${report.invalid === 1 ? 'was' : 'were'} left out.`);
  }
  if (report.overLimit > 0) {
    lines.push(`${plural(report.overLimit, 'restore point, recovery copy or set', 'restore points, recovery copies or sets')} didn’t fit beside yours and ${report.overLimit === 1 ? 'was' : 'were'} skipped.`);
  }
  if (report.failed > 0) lines.push(`${plural(report.failed, 'part')} didn’t fit in browser storage.`);
  if (report.houseWithheld) lines.push('Your open house was kept, since the restore didn’t complete.');
  if (report.keptExtras) lines.push('Nothing here was deleted.');
  return lines.join(' ');
}
