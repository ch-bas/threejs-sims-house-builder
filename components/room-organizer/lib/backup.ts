import { STORAGE_KEY } from './constants';
import { importCustomSets, listCustomSets, parseCustomSet, type CustomFurnitureSet } from './custom-sets';
import {
  LIBRARY_KEY_PREFIX,
  batchLibraryChanges,
  countUnreadableSavedLayouts,
  keepRoomShortfall,
  layoutSlugExists,
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
import { PLAN_IMAGE_WAIT_MS, comparablePlanImage, storePlanImage } from './plan-image-ref';
import { isUntouched } from './restore-point';
import { parseStoredLayout } from './schema';
import {
  MAX_STORAGE_ENTRY_CHARS,
  VERSION_HISTORY_STORAGE_KEY,
  importKeptVersions,
  importSnapshots,
  listSnapshots,
  readKeptEntriesForBackup,
} from './version-history';
import type { RoomLayout } from './types';

/**
 * One-file backup of everything the editor keeps in this browser (#620): the
 * open house, the library, restore points, recovery copies, received houses,
 * custom sets and settings. localStorage lives in one browser profile, on an
 * origin shared with other projects; clearing site data loses all of it.
 *
 * A file is validated whole before anything is written: every house goes
 * through `parseStoredLayout`, every set through `parseCustomSet`, settings
 * through an allow-list. Restoring only adds: it never replaces or deletes
 * anything this browser holds, and never touches the open house.
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
  'standalone-room-organizer-first-steps',
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
  /**
   * Kept versions (#935), with their names and when they were kept. Files
   * written before it lack the part, which reads as empty; an older editor
   * ignores it.
   */
  keptVersions: unknown[];
  recoveryCopies: BackupRecoveryCopy[];
  received: BackupReceivedEntry[];
  customSets: unknown[];
  settings: Record<string, string>;
}

type BackupPart = 'library' | 'restorePoints' | 'keptVersions' | 'recoveryCopies' | 'received' | 'customSets';

/** A file read and validated: what a restore works from. */
export interface ParsedBackup {
  exportedAt: number;
  house: RoomLayout | null;
  /** `stored`: the house as the file holds it, already validated; `layout`: as it opens. */
  library: { name: string; savedAt: number; stored: RoomLayout; layout: RoomLayout }[];
  /** Entries whose layout passed the schema; `importSnapshots` reads them again. */
  restorePoints: unknown[];
  /** Kept versions whose layout passed the schema; `importKeptVersions` reads them again. */
  keptVersions: unknown[];
  recoveryCopies: BackupRecoveryCopy[];
  received: { name: string; receivedAt: number; layout: RoomLayout }[];
  customSets: CustomFurnitureSet[];
  settings: Record<string, string>;
  /** Entries, or parts of the wrong shape, that failed validation and are left out. */
  invalid: number;
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
    keptVersions: storage ? readKeptEntriesForBackup(storage) : [],
    recoveryCopies: readRecoveryCopies().map(({ savedAt, raw }) => ({ savedAt, raw })),
    received: listReceivedLayouts().map(({ name, receivedAt, layout }) => ({ name, receivedAt, layout })),
    customSets: listCustomSets(),
    settings,
  };
}

// --- #936 plan image store ---
/**
 * The backup as a file that stands alone (#936): every floor-plan image a
 * stored house names by ref is put back in it. A ref that can't be read
 * stays, as stored.
 */
export async function inlineBackupPlanImages(bundle: BackupBundle): Promise<BackupBundle> {
  if (!backupNamesPlanImages(bundle)) return bundle;
  const { inlinePlanImageRefs, inlineRawPlanImages } = await import('./plan-image-store');
  const [main, library, received, recoveryCopies] = await Promise.all([
    inlinePlanImageRefs(bundle.main),
    inlinePlanImageRefs(bundle.library) as Promise<BackupLibraryEntry[]>,
    inlinePlanImageRefs(bundle.received) as Promise<BackupReceivedEntry[]>,
    Promise.all(bundle.recoveryCopies.map(async (copy) => ({ ...copy, raw: await inlineRawPlanImages(copy.raw) }))),
  ]);
  return { ...bundle, main, library, received, recoveryCopies };
}

/** Said when a backup went out with a floor-plan image it couldn't read (#936). */
export const PLAN_IMAGES_NOT_IN_BACKUP =
  'The backup was downloaded, but a floor-plan image couldn’t be read from this browser’s storage, so the file names it without holding it. Reload and back up again; until then this backup isn’t counted.';

/** Whether a backup holds a floor-plan image only by ref (`inlineBackupPlanImages` then has work). */
export function backupNamesPlanImages(bundle: BackupBundle): boolean {
  // No quotes: a recovered copy's raw text holds them escaped.
  return JSON.stringify(bundle).includes('floorPlanImageRef');
}

/**
 * Put a backup's floor-plan images in the image store before its houses are
 * saved (#936): the library copies then name them by ref, and a house the
 * library already holds is known as the same one.
 */
export async function storeBackupPlanImages(backup: ParsedBackup): Promise<void> {
  const images = new Set<string>();
  for (const house of [backup.house, ...backup.library.map((entry) => entry.layout)]) {
    if (house?.floorPlanImage) images.add(house.floorPlanImage);
  }
  // Bounded: a store that never opens can't hold up the restore.
  await Promise.all([...images].map((image) => storePlanImage(image, PLAN_IMAGE_WAIT_MS)));
}
// --- end #936 ---

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

  // An entry that fails validation, or a part present but of the wrong
  // shape, is left out and counted; a part the file lacks is just empty.
  let invalid = 0;
  const part = (name: BackupPart): unknown[] => {
    const value = json[name];
    if (Array.isArray(value)) return value;
    if (value !== undefined && value !== null) invalid += 1;
    return [];
  };

  const library: ParsedBackup['library'] = [];
  for (const entry of part('library')) {
    const parsed = isRecord(entry) ? parseStoredLayout(entry.layout) : null;
    if (!parsed || !isRecord(entry) || typeof entry.name !== 'string') {
      invalid += 1;
      continue;
    }
    // Validated, and written back as it was stored, like any library blob:
    // loading it runs the schema's repairs again.
    library.push({ name: entry.name, savedAt: finite(entry.savedAt) ?? 0, stored: entry.layout as RoomLayout, layout: parsed });
  }

  const restorePoints: unknown[] = [];
  for (const entry of part('restorePoints')) {
    if (isRecord(entry) && finite(entry.savedAt) !== null && parseStoredLayout(entry.layout)) restorePoints.push(entry);
    else invalid += 1;
  }

  const keptVersions: unknown[] = [];
  for (const entry of part('keptVersions')) {
    if (isRecord(entry) && finite(entry.savedAt) !== null && parseStoredLayout(entry.layout)) keptVersions.push(entry);
    else invalid += 1;
  }

  const recoveryCopies: BackupRecoveryCopy[] = [];
  for (const entry of part('recoveryCopies')) {
    if (isRecord(entry) && typeof entry.raw === 'string' && entry.raw.length <= MAX_STORAGE_ENTRY_CHARS) {
      recoveryCopies.push({ savedAt: finite(entry.savedAt), raw: entry.raw });
    } else {
      invalid += 1;
    }
  }

  const received: ParsedBackup['received'] = [];
  for (const entry of part('received')) {
    const layout = isRecord(entry) ? parseStoredLayout(entry.layout) : null;
    if (layout && isRecord(entry)) {
      const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name : layout.name;
      received.push({ name, receivedAt: finite(entry.receivedAt) ?? 0, layout });
    } else {
      invalid += 1;
    }
  }

  const customSets: CustomFurnitureSet[] = [];
  for (const entry of part('customSets')) {
    const set = parseCustomSet(entry);
    if (set) customSets.push(set);
    else invalid += 1;
  }

  const settings: Record<string, string> = {};
  if (isRecord(json.settings)) {
    for (const [key, value] of Object.entries(json.settings)) {
      if (BACKUP_SETTINGS_KEYS.includes(key) && typeof value === 'string' && value.length <= MAX_SETTING_CHARS) {
        settings[key] = value;
      } else {
        invalid += 1;
      }
    }
  } else if (json.settings !== undefined && json.settings !== null) {
    invalid += 1;
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
      keptVersions,
      recoveryCopies,
      received,
      customSets,
      settings,
      invalid,
    },
  };
}

/** What a backup holds — only what passed validation — for the question before a restore. */
export interface BackupSummary {
  hasHouse: boolean;
  library: number;
  restorePoints: number;
  keptVersions: number;
  received: number;
  customSets: number;
  /** Entries or parts left out because they couldn't be read. */
  invalid: number;
}

export function summarizeBackup(backup: ParsedBackup): BackupSummary {
  return {
    hasHouse: backup.house !== null,
    library: backup.library.length,
    restorePoints: backup.restorePoints.length,
    keptVersions: backup.keptVersions.length,
    received: backup.received.length,
    customSets: backup.customSets.length,
    invalid: backup.invalid,
  };
}

/** What a restore did, part by part. */
export interface RestoreReport {
  library: number;
  restorePoints: number;
  keptVersions: number;
  recoveryCopies: number;
  received: number;
  customSets: number;
  settings: number;
  /** Entries or parts of the file that failed validation and were left out. */
  invalid: number;
  /** Left out for lack of room under a cap, beside what this browser keeps. */
  skipped: {
    restorePoints: number;
    keptVersions: number;
    recoveryCopies: number;
    customSets: number;
    /** Names of the received houses the paste-board had no room for. */
    received: string[];
  };
  /** What the browser refused to store (full or blocked storage), in words: `saved layout “A”`. */
  failed: string[];
  /**
   * This browser's restore points dropped to make room for what was added:
   * they are the lowest-priority tenant of storage, so a write that needs
   * room evicts them, oldest first (#295). Said in the notice.
   */
  restorePointsDropped: number;
}

/** Recovery copies share at most this much room: they never crowd out the library or autosave. */
const MAX_RECOVERY_RESTORE_CHARS = 1024 * 1024;

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

/**
 * Whether the library already holds this very house under any name. The name
 * is left out of the comparison: a copy saved as "A (backup)" carries that
 * name, and restoring the same file again must not add it a second time.
 */
function libraryHolds(layout: RoomLayout): boolean {
  const unnamed = { ...layout, name: '' };
  return listSavedLayouts().some((entry) => {
    const stored = loadNamedLayout(entry.id);
    // An image inline on one side and named by ref on the other is one (#936).
    return stored !== null && sameLayoutContent(comparablePlanImage({ ...stored, name: '' }), comparablePlanImage(unnamed));
  });
}

/**
 * Add a validated backup to what this browser holds. A restore adds what is
 * missing and never replaces or deletes anything: a library house whose name
 * is taken by a different house is saved as "name (backup)", the backup's
 * open house goes to the library (unless it is the open house, already in
 * the library, or untouched), received houses, sets and restore points fill
 * only the room their caps leave beside this browser's own, and a setting is
 * written only where none is stored. Recovery copies come last, into what
 * room is left, so they can't take the room anything else needs. `current`
 * is the open house.
 */
export function restoreBackup(backup: ParsedBackup, current: RoomLayout): RestoreReport {
  const report: RestoreReport = {
    library: 0,
    restorePoints: 0,
    keptVersions: 0,
    recoveryCopies: 0,
    received: 0,
    customSets: 0,
    settings: 0,
    invalid: backup.invalid,
    skipped: { restorePoints: 0, keptVersions: 0, recoveryCopies: 0, customSets: 0, received: [] },
    failed: [],
    restorePointsDropped: 0,
  };
  const localPoints = listSnapshots().map((summary) => summary.id);

  restoreLibrary(backup, current, report);

  const received = importReceivedLayouts(backup.received);
  if (received === null) report.failed.push('received houses');
  else {
    report.received = received.added;
    report.skipped.received = received.skipped;
  }

  const sets = importCustomSets(backup.customSets);
  if (sets === null) report.failed.push('custom sets');
  else {
    report.customSets = sets.added;
    report.skipped.customSets = sets.skipped;
  }

  restoreSettings(backup.settings, report);

  // Kept versions before restore points, so a point the file keeps is
  // restored as kept, not into the ring; within the kept caps and the
  // library's autosave rule, like a library save.
  const kept = importKeptVersions(backup.keptVersions, {
    roomCheck: (chars) => keepRoomShortfall(current, chars),
  });
  report.keptVersions = kept.added;
  report.skipped.keptVersions = kept.skipped;

  const points = importSnapshots(backup.restorePoints);
  report.restorePoints = points.added;
  report.skipped.restorePoints = points.skipped;

  restoreRecoveryCopies(backup.recoveryCopies, report);
  const remaining = new Set(listSnapshots().map((summary) => summary.id));
  report.restorePointsDropped = localPoints.filter((id) => !remaining.has(id)).length;
  return report;
}

function restoreLibrary(backup: ParsedBackup, current: RoomLayout, report: RestoreReport): void {
  // One re-measure for the whole restore, not one per house (#711).
  batchLibraryChanges(() => restoreLibraryHouses(backup, current, report));
}

function restoreLibraryHouses(backup: ParsedBackup, current: RoomLayout, report: RestoreReport): void {
  const save = (stored: RoomLayout, name: string, savedAt?: number): void => {
    const outcome = saveNamedLayout(stored, name, savedAt === undefined ? {} : { savedAt });
    if (outcome.ok) report.library += 1;
    else report.failed.push(`saved layout “${name}”`);
  };
  for (const entry of backup.library) {
    if (libraryHolds(entry.layout)) continue;
    const name = entry.name.trim() || entry.layout.name || 'Untitled';
    save(entry.stored, layoutSlugExists(name) ? freeLibraryName(name) : name, entry.savedAt);
  }
  const house = backup.house;
  if (house && !isUntouched(house) && !sameHouseContent(house, current) && !libraryHolds(house)) {
    save(house, freeLibraryName(house.name || 'Untitled'));
  }
}

/**
 * Recovery copies come back only up to `MAX_RECOVERY_COPIES` and
 * `MAX_RECOVERY_RESTORE_CHARS`, and only into free room: they never evict
 * restore points or anything else, and a refused one stops nothing.
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
      report.skipped.recoveryCopies += 1;
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
      report.failed.push('a recovery copy');
    }
  }
}

/** A setting is written only where this browser has none. */
function restoreSettings(settings: Record<string, string>, report: RestoreReport): void {
  const storage = localStorageOrNull();
  if (!storage) return;
  for (const [key, value] of Object.entries(settings)) {
    if (!BACKUP_SETTINGS_KEYS.includes(key)) continue;
    try {
      if (storage.getItem(key) !== null) continue;
      storage.setItem(key, value);
      report.settings += 1;
    } catch {
      report.failed.push('a setting');
    }
  }
}

function plural(count: number, noun: string, nouns = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : nouns}`;
}

function quoted(names: readonly string[]): string {
  return names.map((name) => `“${name}”`).join(', ');
}

/** What a restore did, in words, for the notice after it. Says only what happened. */
export function describeRestore(report: RestoreReport): string {
  const added: string[] = [];
  if (report.library > 0) added.push(plural(report.library, 'saved layout'));
  if (report.restorePoints > 0) added.push(plural(report.restorePoints, 'restore point'));
  if (report.keptVersions > 0) added.push(plural(report.keptVersions, 'kept version'));
  if (report.recoveryCopies > 0) added.push(plural(report.recoveryCopies, 'recovery copy', 'recovery copies'));
  if (report.received > 0) added.push(plural(report.received, 'received house'));
  if (report.customSets > 0) added.push(plural(report.customSets, 'custom set'));
  if (report.settings > 0) added.push(plural(report.settings, 'setting'));

  const { skipped } = report;
  const left: string[] = [];
  if (skipped.received.length > 0) {
    left.push(`${plural(skipped.received.length, 'received house')} (${quoted(skipped.received)}): the board is full`);
  }
  if (skipped.customSets > 0) left.push(`${plural(skipped.customSets, 'custom set')}: the sets are full`);
  if (skipped.restorePoints > 0) left.push(`${plural(skipped.restorePoints, 'restore point')}: no room beside yours`);
  if (skipped.keptVersions > 0) left.push(`${plural(skipped.keptVersions, 'kept version')}: no room beside yours`);
  if (skipped.recoveryCopies > 0) {
    left.push(`${plural(skipped.recoveryCopies, 'recovery copy', 'recovery copies')}: no room beside yours`);
  }
  const nothingMissed = left.length === 0 && report.failed.length === 0 && report.invalid === 0;

  const lines: string[] = [];
  if (added.length > 0) lines.push(`Added ${added.join(', ')}.`);
  else if (nothingMissed) lines.push('Nothing new to add — this browser already holds everything in the backup.');
  else lines.push('Nothing was added.');
  if (left.length > 0) lines.push(`Not added: ${left.join('; ')}.`);
  if (report.failed.length > 0) lines.push(`Didn’t fit in browser storage: ${report.failed.join(', ')}.`);
  if (report.invalid > 0) {
    lines.push(`${plural(report.invalid, 'part')} of the file couldn’t be read and ${report.invalid === 1 ? 'was' : 'were'} left out.`);
  }
  if (report.restorePointsDropped > 0) {
    lines.push(
      `To make room, ${plural(report.restorePointsDropped, 'older restore point')} ${report.restorePointsDropped === 1 ? 'was' : 'were'} dropped; nothing else here was replaced or deleted.`
    );
  } else {
    lines.push('Nothing here was replaced or deleted.');
  }
  return lines.join(' ');
}
