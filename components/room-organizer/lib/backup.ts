import { STORAGE_KEY } from './constants';
import { importCustomSets, listCustomSets } from './custom-sets';
import { deleteNamedLayout, layoutSlugExists, listSavedLayouts, loadNamedLayout, saveNamedLayout } from './library';
import { addReceivedLayout, listReceivedLayouts, removeReceivedLayout } from './pasteboard';
import {
  RECOVERY_STORAGE_KEY,
  localStorageOrNull,
  readRecoveryCopies,
  sameLayoutContent,
} from './persistence';
import { isUntouched } from './restore-point';
import { parseStoredLayout } from './schema';
import { tenantOfKey } from './storage-meter';
import { VERSION_HISTORY_STORAGE_KEY, importSnapshots, setItemEvictingSnapshots } from './version-history';
import type { RoomLayout } from './types';

/**
 * One-file backup of everything the editor keeps in this browser (#620): the
 * open house, the library, restore points, recovery copies, received houses,
 * custom sets and settings. localStorage lives in one browser profile, on an
 * origin shared with other projects; clearing site data loses all of it.
 *
 * Restoring pushes every part through the parser that guards it on a normal
 * read — every house through `parseStoredLayout` — and writes through the
 * same quota rules (restore points stay the lowest-priority tenant). The open
 * house is never written here: the caller applies it like any other load, so
 * it takes the restore point, the undo step and the achievements rule.
 */

export const BACKUP_FORMAT = 'house-builder-backup';
/** Bumped when the bundle changes shape; a newer file is refused, not misread. */
export const BACKUP_VERSION = 1;

/** Settings values are small preferences; anything bigger isn't one. */
const MAX_SETTING_CHARS = 64 * 1024;

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
  /** Other keys of this app (achievements, recent colours…), raw. */
  settings: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
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
  const read = (key: string): string | null => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const library: BackupLibraryEntry[] = [];
  for (const entry of listSavedLayouts()) {
    const layout = loadNamedLayout(entry.id);
    if (layout) library.push({ name: entry.name, savedAt: entry.savedAt, layout });
  }
  const ring = parseJson(read(VERSION_HISTORY_STORAGE_KEY));
  const settings: Record<string, string> = {};
  if (storage) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key === null || tenantOfKey(key) !== 'settings') continue;
        const value = storage.getItem(key);
        if (value !== null) settings[key] = value;
      }
    } catch {
      /* settings are the least of it */
    }
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    main: current ?? parseJson(read(STORAGE_KEY)),
    library,
    restorePoints: Array.isArray(ring) ? ring : [],
    recoveryCopies: readRecoveryCopies().map(({ savedAt, raw }) => ({ savedAt, raw })),
    received: listReceivedLayouts().map(({ name, receivedAt, layout }) => ({ name, receivedAt, layout })),
    customSets: listCustomSets(),
    settings,
  };
}

/** The file name a backup downloads as. */
export function backupFileName(now: number = Date.now()): string {
  return `house-builder-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
}

export type BackupParseFailure = 'not-json' | 'not-backup' | 'newer-version';

export type BackupParseResult = { ok: true; bundle: BackupBundle } | { ok: false; reason: BackupParseFailure };

/** Why a file isn't a backup this version can restore, in words. */
export const BACKUP_FAILURE_TEXT: Record<BackupParseFailure, string> = {
  'not-json': 'This file isn’t a backup — it isn’t JSON.',
  'not-backup': 'This file isn’t a backup made by this editor. To open a single house, use Import in Layout actions.',
  'newer-version': 'This backup was made by a newer version of the editor. Reload to update, then try again.',
};

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Read a backup file's text. Only the envelope is checked here; every part
 * is validated as it is restored, and a part of the wrong shape reads as
 * empty rather than failing the whole file.
 */
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
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const library: BackupLibraryEntry[] = [];
  for (const entry of list(json.library)) {
    if (!isRecord(entry) || typeof entry.name !== 'string') continue;
    library.push({ name: entry.name, savedAt: finite(entry.savedAt) ?? 0, layout: entry.layout });
  }
  const received: BackupReceivedEntry[] = [];
  for (const entry of list(json.received)) {
    if (!isRecord(entry)) continue;
    received.push({
      name: typeof entry.name === 'string' ? entry.name : '',
      receivedAt: finite(entry.receivedAt) ?? 0,
      layout: entry.layout,
    });
  }
  const recoveryCopies: BackupRecoveryCopy[] = [];
  for (const entry of list(json.recoveryCopies)) {
    if (isRecord(entry) && typeof entry.raw === 'string') {
      recoveryCopies.push({ savedAt: finite(entry.savedAt), raw: entry.raw });
    }
  }
  const settings: Record<string, string> = {};
  if (isRecord(json.settings)) {
    for (const [key, value] of Object.entries(json.settings)) {
      if (typeof value === 'string') settings[key] = value;
    }
  }
  return {
    ok: true,
    bundle: {
      format: BACKUP_FORMAT,
      version,
      exportedAt: finite(json.exportedAt) ?? 0,
      main: json.main ?? null,
      library,
      restorePoints: list(json.restorePoints),
      recoveryCopies,
      received,
      customSets: list(json.customSets),
      settings,
    },
  };
}

/** What a backup holds, for the confirm before a restore. */
export interface BackupSummary {
  hasHouse: boolean;
  library: number;
  restorePoints: number;
  received: number;
  customSets: number;
}

export function summarizeBackup(bundle: BackupBundle): BackupSummary {
  return {
    hasHouse: parseStoredLayout(bundle.main) !== null,
    library: bundle.library.length,
    restorePoints: bundle.restorePoints.length,
    received: bundle.received.length,
    customSets: bundle.customSets.length,
  };
}

/**
 * `merge` adds the backup beside what is stored and replaces nothing: a
 * library house whose name is taken by a different house is saved under a
 * new name, and the backup's open house goes to the library. `replace` makes
 * the open house, library, received houses, custom sets and settings the
 * backup's. Restore points and recovery copies are always merged — they are
 * the way back from a restore, too.
 */
export type RestoreMode = 'merge' | 'replace';

export interface RestoreReport {
  /** With `replace`: the house the caller must open. Never written here. */
  house: RoomLayout | null;
  library: number;
  restorePoints: number;
  recoveryCopies: number;
  received: number;
  customSets: number;
  settings: number;
  /** Parts that failed validation and were left out. */
  skipped: number;
  /** Parts the browser refused to store (full or blocked storage). */
  failed: number;
}

/** A library name not in use yet: `name (backup)`, then `(backup 2)`… */
function freeLibraryName(name: string): string {
  for (let n = 1; ; n += 1) {
    const candidate = `${name} (backup${n === 1 ? '' : ` ${n}`})`;
    if (!layoutSlugExists(candidate)) return candidate;
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
 * Restore a parsed backup. `current` is the open house: with `merge` the
 * backup's house is saved to the library unless it is that house, already
 * in the library, or untouched.
 */
export function restoreBackup(bundle: BackupBundle, mode: RestoreMode, current: RoomLayout): RestoreReport {
  const report: RestoreReport = {
    house: null,
    library: 0,
    restorePoints: 0,
    recoveryCopies: 0,
    received: 0,
    customSets: 0,
    settings: 0,
    skipped: 0,
    failed: 0,
  };
  const replace = mode === 'replace';

  // Restore points first: the restore point the caller takes of the
  // outgoing house must land in the ring after them.
  report.restorePoints = importSnapshots(bundle.restorePoints);
  restoreRecoveryCopies(bundle.recoveryCopies, report);

  // Library: with `replace` the backup's houses are written first and the
  // houses it doesn't have are deleted only once every write succeeded.
  const savedNames = new Set<string>();
  let libraryFailed = 0;
  for (const entry of bundle.library) {
    const layout = parseStoredLayout(entry.layout);
    if (!layout) {
      report.skipped += 1;
      continue;
    }
    let name = entry.name.trim() || layout.name || 'Untitled';
    if (!replace) {
      if (libraryHolds(layout)) continue;
      if (layoutSlugExists(name)) name = freeLibraryName(name);
    }
    const saved = saveNamedLayout(layout, name);
    if (saved) {
      report.library += 1;
      savedNames.add(saved.entry.id);
    } else {
      libraryFailed += 1;
    }
  }
  report.failed += libraryFailed;
  if (replace && libraryFailed === 0) {
    for (const entry of listSavedLayouts()) {
      if (!savedNames.has(entry.id)) deleteNamedLayout(entry.id);
    }
  }

  const house = parseStoredLayout(bundle.main);
  if (bundle.main !== null && !house) report.skipped += 1;
  if (house && replace) {
    report.house = house;
  } else if (house && !isUntouched(house) && !sameHouseContent(house, current) && !libraryHolds(house)) {
    const saved = saveNamedLayout(house, freeLibraryName(house.name || 'Untitled'));
    if (saved) report.library += 1;
    else report.failed += 1;
  }

  restoreReceived(bundle.received, replace, report);

  const sets = importCustomSets(bundle.customSets, { replace });
  if (sets === null) report.failed += 1;
  else report.customSets = sets;

  restoreSettings(bundle.settings, replace, report);
  return report;
}

function restoreRecoveryCopies(copies: readonly BackupRecoveryCopy[], report: RestoreReport): void {
  const storage = localStorageOrNull();
  if (!storage) return;
  const stored = new Set(readRecoveryCopies().map((copy) => copy.raw));
  for (const copy of copies) {
    if (stored.has(copy.raw)) continue;
    const stamp = copy.savedAt ?? 0;
    const key = `${RECOVERY_STORAGE_KEY}-${stamp}-${Math.random().toString(36).slice(2, 8) || '0'}`;
    try {
      setItemEvictingSnapshots(storage, key, copy.raw);
      stored.add(copy.raw);
      report.recoveryCopies += 1;
    } catch {
      report.failed += 1;
    }
  }
}

function restoreReceived(entries: readonly BackupReceivedEntry[], replace: boolean, report: RestoreReport): void {
  const layouts: { layout: RoomLayout; receivedAt: number }[] = [];
  for (const entry of entries) {
    const layout = parseStoredLayout(entry.layout);
    if (layout) layouts.push({ layout, receivedAt: entry.receivedAt });
    else report.skipped += 1;
  }
  const before = listReceivedLayouts().map((entry) => entry.id);
  const kept = new Set<string>();
  let failed = 0;
  // Oldest first, so the board's cap drops the oldest, as a paste would.
  for (const { layout, receivedAt } of layouts.sort((a, b) => a.receivedAt - b.receivedAt)) {
    const added = addReceivedLayout(layout, { now: () => receivedAt });
    if (!added) {
      failed += 1;
      continue;
    }
    kept.add(added.entry.id);
    if (!added.duplicate) report.received += 1;
  }
  report.failed += failed;
  // The houses the backup doesn't have go only once all of its own are in.
  if (replace && failed === 0) {
    for (const id of before) if (!kept.has(id)) removeReceivedLayout(id);
  }
}

function restoreSettings(settings: Record<string, string>, replace: boolean, report: RestoreReport): void {
  const storage = localStorageOrNull();
  if (!storage) return;
  for (const [key, value] of Object.entries(settings)) {
    // Only this app's own preference keys: a crafted file must not reach
    // the main save or another site's data through here.
    if (tenantOfKey(key) !== 'settings' || value.length > MAX_SETTING_CHARS) {
      report.skipped += 1;
      continue;
    }
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
  let text = parts.length > 0 ? `Restored ${parts.join(', ')}.` : 'Nothing new to restore — this browser already holds everything in the backup.';
  if (report.skipped > 0) text += ` ${plural(report.skipped, 'part')} couldn’t be read and ${report.skipped === 1 ? 'was' : 'were'} left out.`;
  if (report.failed > 0) text += ` ${plural(report.failed, 'part')} didn’t fit in browser storage.`;
  return text;
}
