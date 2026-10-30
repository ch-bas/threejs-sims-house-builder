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
import { importReceivedLayouts, listReceivedLayouts } from './pasteboard';
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
  /**
   * With `replace`: parts the deletion pass had already replaced when a
   * later write was refused — the notice names them, so "nothing deleted"
   * is never said of them.
   */
  replacedBeforeStop: string[];
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

/** Recovery copies share at most this much room: they never crowd out the library or autosave. */
const MAX_RECOVERY_RESTORE_CHARS = 1024 * 1024;

/** The stored house a library name maps to, if any, as it opens. */
function libraryHouseNamed(name: string): { exists: boolean; layout: RoomLayout | null } {
  if (!layoutSlugExists(name)) return { exists: false, layout: null };
  const slot = librarySlotId(name);
  const entry = listSavedLayouts().find((candidate) => candidate.id === slot || librarySlotId(candidate.name) === slot);
  return { exists: true, layout: entry ? loadNamedLayout(entry.id) : null };
}

/** The slot a backup library entry is saved under. */
function entrySlot(entry: ParsedBackup['library'][number]): string {
  return librarySlotId(entry.name.trim() || entry.layout.name || 'Untitled');
}

/** What a Replace will delete here, for its confirm. Nothing when the file isn't complete. */
export interface ReplacePreview {
  /** Saved layouts deleted outright, plus those overwritten by a different house of the same name. */
  library: number;
  received: number;
  customSets: number;
}

export function previewReplace(backup: ParsedBackup): ReplacePreview {
  if (!backup.complete) return { library: 0, received: 0, customSets: 0 };
  let library = 0;
  for (const entry of listSavedLayouts()) {
    const incoming = backup.library.find((candidate) => entrySlot(candidate) === librarySlotId(entry.name));
    const stored = loadNamedLayout(entry.id);
    if (!incoming || !(stored && sameLayoutContent(stored, incoming.layout))) library += 1;
  }
  const incomingReceived = new Set(
    backup.received.map(({ layout }) => {
      const stored: RoomLayout = { ...layout };
      delete stored.floorPlanImage;
      return JSON.stringify(stored);
    })
  );
  const received = listReceivedLayouts().filter((entry) => !incomingReceived.has(JSON.stringify(entry.layout))).length;
  const setIds = new Set(backup.customSets.map((set) => set.id));
  const customSets = listCustomSets().filter((set) => !setIds.has(set.id)).length;
  return { library, received, customSets };
}

/**
 * The question a Replace asks first, naming what it deletes here: how many
 * saved layouts (an empty library in the file deletes them all), received
 * houses and sets — or that it deletes nothing, on a file not wholly read.
 */
export function replaceConfirmText(summary: BackupSummary, preview: ReplacePreview): string {
  const replaced = [summary.hasHouse ? 'the open house' : null, 'your saved layouts', 'received houses', 'custom sets']
    .filter((part): part is string => part !== null)
    .join(', ');
  let deletes: string;
  if (!summary.complete) {
    deletes = 'Part of the backup can’t be read, so nothing here is deleted or overwritten.';
  } else {
    const parts = [
      preview.library > 0 ? plural(preview.library, 'saved layout') : null,
      preview.received > 0 ? plural(preview.received, 'received house') : null,
      preview.customSets > 0 ? plural(preview.customSets, 'custom set') : null,
    ].filter((part): part is string => part !== null);
    deletes =
      parts.length > 0
        ? `This deletes or overwrites ${parts.join(', ')} the backup doesn’t have.`
        : 'Nothing here is deleted.';
  }
  const kept = summary.hasHouse ? ' The open house is kept as a restore point.' : '';
  return `Replace ${replaced} and settings with the backup’s? ${deletes}${kept} Your restore points are kept.`;
}

/**
 * Restore a validated backup, in two phases. First every write that removes
 * nothing: new library houses, received houses and sets into free room,
 * settings, then recovery copies and restore points, which take only what
 * room is left. Then — only with `replace`, a complete file and no failed
 * write — one deletion pass: the backup's sets and received houses take the
 * place of this browser's (each one atomic write), same-named library houses
 * are overwritten, and library houses the backup lacks are deleted. An
 * overwrite of different content counts as a deletion. `current` is the
 * open house: with `merge` the backup's house is saved to the library
 * unless it is that house, already in the library, or untouched.
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
    replacedBeforeStop: [],
  };
  const replace = mode === 'replace';
  // Replace deletes only on a whole, readable file (#620 review).
  const mayDelete = replace && backup.complete;

  // Phase 1: writes that remove nothing.
  const library = writeLibrary(backup, replace, mayDelete, current, report);
  if (!mayDelete) {
    const received = importReceivedLayouts(backup.received);
    if (received === null) report.failed += 1;
    else {
      report.received += received.added;
      report.overLimit += received.skipped;
    }
    const sets = importCustomSets(backup.customSets);
    if (sets === null) report.failed += 1;
    else {
      report.customSets += sets.added;
      report.overLimit += sets.skipped;
    }
  }
  restoreSettings(backup.settings, replace, report);
  restoreRecoveryCopies(backup.recoveryCopies, report);
  const points = importSnapshots(backup.restorePoints);
  report.restorePoints = points.added;
  report.overLimit += points.skipped;

  // Phase 2: the one deletion pass.
  if (replace) {
    if (mayDelete && report.failed === 0) replaceCollections(backup, library, report);
    else report.keptExtras = true;
  }

  if (replace && backup.house) {
    // Half a restore must not also swap the house: the open one stays, and
    // the notice says what didn't fit.
    if (report.failed > 0) report.houseWithheld = true;
    else report.house = backup.house;
  }
  return report;
}

/** Slots the restore wrote, and library houses held back to the deletion pass. */
interface LibraryWrites {
  written: Set<string>;
  /** Each overwrites a different house of the same name: a deletion, so it waits for the gate. */
  overwrites: { name: string; stored: RoomLayout; savedAt: number }[];
}

function writeLibrary(
  backup: ParsedBackup,
  replace: boolean,
  mayDelete: boolean,
  current: RoomLayout,
  report: RestoreReport
): LibraryWrites {
  // No two backup houses may land in one slot, and the deletion pass never
  // touches a slot this restore wrote.
  const writes: LibraryWrites = { written: new Set(), overwrites: [] };
  const claimed = new Set<string>();
  const free = (candidate: string): boolean => !claimed.has(librarySlotId(candidate)) && !layoutSlugExists(candidate);
  const save = (stored: RoomLayout, name: string, savedAt?: number): void => {
    const outcome = saveNamedLayout(stored, name, savedAt === undefined ? {} : { savedAt });
    if (outcome.ok) {
      writes.written.add(outcome.entry.id);
      report.library += 1;
    } else {
      report.failed += 1;
    }
  };

  for (const entry of backup.library) {
    const { layout } = entry;
    let name = entry.name.trim() || layout.name || 'Untitled';
    if (!replace && libraryHolds(layout)) continue;
    if (claimed.has(librarySlotId(name))) name = freeLibraryName(name, free);
    const here = libraryHouseNamed(name);
    if (here.exists && !(here.layout && sameLayoutContent(here.layout, layout))) {
      if (mayDelete) {
        claimed.add(librarySlotId(name));
        writes.overwrites.push({ name, stored: entry.stored, savedAt: entry.savedAt });
        continue;
      }
      name = freeLibraryName(name, free);
    }
    claimed.add(librarySlotId(name));
    save(entry.stored, name, entry.savedAt);
  }

  const house = backup.house;
  if (!replace && house && !isUntouched(house) && !sameHouseContent(house, current) && !libraryHolds(house)) {
    const name = freeLibraryName(house.name || 'Untitled', free);
    claimed.add(librarySlotId(name));
    save(house, name);
  }
  return writes;
}

/** The deletion pass of a Replace. Stops at the first refused write, deleting nothing more. */
function replaceCollections(backup: ParsedBackup, library: LibraryWrites, report: RestoreReport): void {
  const replaced: string[] = [];
  const refused = (): void => {
    report.failed += 1;
    report.keptExtras = true;
    report.replacedBeforeStop = replaced;
  };
  const sets = importCustomSets(backup.customSets, { replace: true });
  if (sets === null) return refused();
  replaced.push('custom sets');
  report.customSets += sets.added;
  report.overLimit += sets.skipped;

  const received = importReceivedLayouts(backup.received, { replace: true });
  if (received === null) return refused();
  replaced.push('received houses');
  report.received += received.added;
  report.overLimit += received.skipped;

  for (const { name, stored, savedAt } of library.overwrites) {
    const outcome = saveNamedLayout(stored, name, { savedAt });
    if (!outcome.ok) return refused();
    library.written.add(outcome.entry.id);
    report.library += 1;
  }
  for (const entry of listSavedLayouts()) {
    if (!library.written.has(entry.id)) deleteNamedLayout(entry.id);
  }
}

/**
 * Recovery copies come back only up to `MAX_RECOVERY_COPIES` and
 * `MAX_RECOVERY_RESTORE_CHARS`, after the library, and only into free room:
 * they never evict restore points or anything else.
 */
function restoreRecoveryCopies(copies: readonly BackupRecoveryCopy[], report: RestoreReport): void {
  const storage = localStorageOrNull();
  if (!storage) return;
  const stored = readRecoveryCopies();
  const held = new Set(stored.map((copy) => copy.raw));
  let count = stored.length;
  let chars = 0;
  // Newest first, as the copies are ranked when kept.
  const ordered = [...copies].sort((a, b) => (b.savedAt ?? -1) - (a.savedAt ?? -1));
  for (const copy of ordered) {
    if (held.has(copy.raw)) continue;
    if (count >= MAX_RECOVERY_COPIES || chars + copy.raw.length > MAX_RECOVERY_RESTORE_CHARS) {
      report.overLimit += 1;
      continue;
    }
    const key = `${RECOVERY_STORAGE_KEY}-${copy.savedAt ?? 0}-${Math.random().toString(36).slice(2, 8) || '0'}`;
    try {
      storage.setItem(key, copy.raw);
      held.add(copy.raw);
      count += 1;
      chars += copy.raw.length;
      report.recoveryCopies += 1;
    } catch {
      report.failed += 1;
    }
  }
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
  if (report.keptExtras) {
    lines.push(
      report.replacedBeforeStop.length > 0
        ? `The restore stopped after replacing your ${report.replacedBeforeStop.join(' and ')}; no saved layout was deleted.`
        : 'Nothing here was deleted.'
    );
  }
  return lines.join(' ');
}
