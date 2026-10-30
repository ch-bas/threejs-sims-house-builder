// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackup,
  describeRestore,
  parseBackup,
  restoreBackup,
  summarizeBackup,
  type BackupBundle,
  type ParsedBackup,
  type RestoreReport,
} from './backup';
import { STORAGE_KEY } from './constants';
import { CUSTOM_SETS_STORAGE_KEY, listCustomSets, saveCustomSet } from './custom-sets';
import { listSavedLayouts, loadNamedLayout, saveNamedLayout } from './library';
import { addReceivedLayout, listReceivedLayouts } from './pasteboard';
import { RECOVERY_STORAGE_KEY, readRecoveryCopies } from './persistence';
import { getSnapshot, listSnapshots, recordSnapshot } from './version-history';
import type { RoomLayout } from './types';

const ACHIEVEMENTS_KEY = 'standalone-room-organizer-achievements';

function house(name: string, itemCount: number, id = `house-${name}`): RoomLayout {
  return makeLayout({
    id,
    name,
    floors: [
      makeFloor({
        items: Array.from({ length: itemCount }, (_, index) =>
          makeItem({ id: `${name}-${index}`, position: { x: index, z: 0 } })
        ),
      }),
    ],
  });
}

/** Everything a person keeps in this browser, one of each. */
function fillBrowser(): RoomLayout {
  const open = house('Open', 2);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
  saveNamedLayout(house('Cottage', 3), 'Cottage');
  saveNamedLayout(house('Loft', 1), 'Loft');
  recordSnapshot(house('Open', 1), { force: true, now: () => 1_000 });
  recordSnapshot(house('Open', 2), { force: true, now: () => 2_000 });
  addReceivedLayout(house('From a friend', 4), { now: () => 500 });
  saveCustomSet([makeItem({ id: 'a', position: { x: 1, z: 1 } })], 'Reading nook', { now: () => 700, idTag: 'x' });
  localStorage.setItem(`${RECOVERY_STORAGE_KEY}-900-abc`, '{"broken":');
  localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(['first-item']));
  localStorage.setItem('some-other-site', 'not ours');
  return open;
}

/** What the browser holds, in comparable form. */
function inventory(): unknown {
  return {
    library: listSavedLayouts()
      .map((entry) => ({ name: entry.name, layout: loadNamedLayout(entry.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    snapshots: listSnapshots().map((summary) => ({ ...summary, layout: getSnapshot(summary.id) })),
    // A card's id hashes its stored JSON; the schema's form differs from the fixture's.
    received: listReceivedLayouts().map(({ id: _id, ...card }) => card),
    sets: listCustomSets(),
    recovery: readRecoveryCopies().map((copy) => copy.raw),
    achievements: localStorage.getItem(ACHIEVEMENTS_KEY),
  };
}

/** A bundle as a restore sees it: written to a file and read back. */
function reread(bundle: BackupBundle): ParsedBackup {
  const parsed = parseBackup(JSON.stringify(bundle));
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.bundle;
}

beforeEach(() => {
  localStorage.clear();
});

describe('backup round trip (#620)', () => {
  it('export, wipe, restore gives back everything the browser held, the open house in the library', () => {
    const open = fillBrowser();
    const before = inventory() as { library: { name: string }[] };
    const text = JSON.stringify(createBackup(open, 5_000));

    localStorage.clear();
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const report = restoreBackup(parsed.bundle, house('Blank', 0));

    expect(report.failed).toEqual([]);
    expect(report.invalid).toBe(0);
    const after = inventory() as { library: { name: string; layout: RoomLayout | null }[] };
    expect({ ...after, library: after.library.filter((entry) => entry.name !== 'Open (backup)') }).toEqual(before);
    const filed = after.library.find((entry) => entry.name === 'Open (backup)');
    expect(filed?.layout?.id).toBe(open.id);
    // Another site's key is neither backed up nor touched.
    expect(text).not.toContain('some-other-site');
  });

  it('never writes the main save', () => {
    const open = fillBrowser();
    const bundle = createBackup(open);
    localStorage.clear();
    restoreBackup(reread(bundle), house('Blank', 0));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('backs up the house on screen, not a save a debounce behind it', () => {
    fillBrowser();
    const onScreen = house('Open', 7);
    expect(createBackup(onScreen).main).toEqual(onScreen);
  });
});

describe('parseBackup', () => {
  it('says why a file is refused', () => {
    expect(parseBackup('{oops')).toEqual({ ok: false, reason: 'not-json' });
    expect(parseBackup(JSON.stringify(house('Single', 1)))).toEqual({ ok: false, reason: 'not-backup' });
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1 }))).toEqual({
      ok: false,
      reason: 'newer-version',
    });
  });

  it('reads a part of the wrong shape as empty and counts it; a missing part is just empty', () => {
    const parsed = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, library: 'nope', customSets: 3 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(summarizeBackup(parsed.bundle)).toEqual({
      hasHouse: false,
      library: 0,
      restorePoints: 0,
      received: 0,
      customSets: 0,
      invalid: 2,
    });
  });
});

describe('restore validation', () => {
  it('puts every house through the schema and leaves out the ones that fail', () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: 1,
        main: { not: 'a house' },
        library: [
          { name: 'Good', savedAt: 1, layout: house('Good', 1) },
          { name: 'Bad', savedAt: 1, layout: { width: 'wide' } },
        ],
        received: [{ name: 'Bad', receivedAt: 1, layout: 42 }],
      })
    );
    if (!parsed.ok) throw new Error('should parse');
    const report = restoreBackup(parsed.bundle, house('Current', 1));
    expect(listSavedLayouts().map((entry) => entry.name)).toEqual(['Good']);
    expect(listReceivedLayouts()).toEqual([]);
    expect(report.invalid).toBe(3);
    expect(describeRestore(report)).toContain('3 parts of the file couldn’t be read');
  });

  it('writes only this app’s settings keys, never the main save or another site’s', () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: 1,
        settings: {
          [ACHIEVEMENTS_KEY]: '["x"]',
          [STORAGE_KEY]: '{"hijack":true}',
          [CUSTOM_SETS_STORAGE_KEY]: 'garbage',
          'other-site': 'x',
        },
      })
    );
    if (!parsed.ok) throw new Error('should parse');
    const report = restoreBackup(parsed.bundle, house('Current', 1));
    expect(localStorage.getItem(ACHIEVEMENTS_KEY)).toBe('["x"]');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(CUSTOM_SETS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('other-site')).toBeNull();
    expect(report.invalid).toBe(3);
  });
});

describe('restore only adds', () => {
  it('keeps a different house under a taken name, files the backup’s open house, keeps local settings', () => {
    const backupOpen = house('Backed up', 5);
    saveNamedLayout(house('Cottage', 3, 'cottage-old'), 'Cottage');
    const bundle = createBackup(backupOpen);
    localStorage.clear();

    const current = house('Mine', 9);
    saveNamedLayout(house('Cottage', 8, 'cottage-new'), 'Cottage');
    localStorage.setItem(ACHIEVEMENTS_KEY, '["mine"]');
    bundle.settings[ACHIEVEMENTS_KEY] = '["theirs"]';
    restoreBackup(reread(bundle), current);

    const names = listSavedLayouts().map((entry) => entry.name).sort();
    expect(names).toEqual(['Backed up (backup)', 'Cottage', 'Cottage (backup)']);
    const cottage = listSavedLayouts().find((entry) => entry.name === 'Cottage');
    expect(loadNamedLayout(cottage!.id)?.id).toBe('cottage-new');
    expect(localStorage.getItem(ACHIEVEMENTS_KEY)).toBe('["mine"]');
  });

  it('adds nothing the browser already holds, and says so', () => {
    const open = fillBrowser();
    const before = inventory();
    const report = restoreBackup(reread(createBackup(open)), open);
    expect(inventory()).toEqual(before);
    expect(describeRestore(report)).toMatch(/^Nothing new to add/);
  });

  it('keeps the restore points already stored', () => {
    recordSnapshot(house('Local', 3), { force: true, now: () => 10 });
    const bundle = createBackup(null);
    localStorage.clear();
    recordSnapshot(house('Here', 4), { force: true, now: () => 20 });
    const report = restoreBackup(reread(bundle), house('Current', 1));
    expect(report.restorePoints).toBe(1);
    expect(listSnapshots().map((summary) => summary.name)).toEqual(['Here', 'Local']);
  });
});

describe('the restore notice', () => {
  const empty = (): RestoreReport => ({
    library: 0,
    restorePoints: 0,
    recoveryCopies: 0,
    received: 0,
    customSets: 0,
    settings: 0,
    invalid: 0,
    skipped: { restorePoints: 0, recoveryCopies: 0, customSets: 0, received: [] },
    failed: [],
    restorePointsDropped: 0,
  });

  it('never says the browser holds everything when something was left out', () => {
    const report = { ...empty(), skipped: { ...empty().skipped, received: ['Lake house', 'Loft'] } };
    const text = describeRestore(report);
    expect(text).not.toMatch(/already holds everything/);
    expect(text).toContain('Nothing was added.');
    expect(text).toContain('2 received houses (“Lake house”, “Loft”): the board is full');
  });

  it('names what didn’t fit in storage, and never claims a replace or delete', () => {
    const text = describeRestore({ ...empty(), library: 1, failed: ['saved layout “Big”'] });
    expect(text).toContain('Added 1 saved layout.');
    expect(text).toContain('Didn’t fit in browser storage: saved layout “Big”.');
    expect(text).toContain('Nothing here was replaced or deleted.');
  });
});
