// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { createBackup, parseBackup, restoreBackup } from './backup';
import { STORAGE_KEY } from './constants';
import { MAX_CUSTOM_SETS, importCustomSets, listCustomSets, saveCustomSet } from './custom-sets';
import { listSavedLayouts, loadNamedLayout, saveNamedLayout } from './library';
import { MAX_RECOVERY_COPIES, readRecoveryCopies } from './persistence';
import { importSnapshots, listSnapshots, recordSnapshot, VERSION_HISTORY_LIMIT } from './version-history';
import type { RoomLayout } from './types';

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

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('review D5', () => {
  it('R1 merge: two non-ASCII-named library houses both survive a restore', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const bundle = parseBackup(
      JSON.stringify({
        format: 'house-builder-backup',
        version: 1,
        main: null,
        library: [
          { name: 'Дом', savedAt: 1, layout: house('Дом', 2, 'a') },
          { name: 'Дача', savedAt: 2, layout: house('Дача', 3, 'b') },
        ],
      })
    );
    if (!bundle.ok) throw new Error('parse');
    const report = restoreBackup(bundle.bundle, house('Open', 1));
    expect(report.library).toBe(2);
    expect(listSavedLayouts()).toHaveLength(2);
  });

  it('R2 merge keeps this browser’s own restore points', () => {
    for (let i = 0; i < VERSION_HISTORY_LIMIT; i += 1) {
      recordSnapshot(house('Local', i + 1, 'local'), { force: true, now: () => 1_000 + i });
    }
    const localIds = listSnapshots().map((s) => s.id);
    // A backup from another browser with newer points of another house.
    const incoming = Array.from({ length: VERSION_HISTORY_LIMIT }, (_, i) => ({
      id: `remote-${i}`,
      savedAt: 50_000 + i,
      layoutId: 'remote',
      name: 'Remote',
      layout: house('Remote', i + 1, 'remote'),
    }));
    importSnapshots(incoming, { now: () => 100_000 });
    const after = new Set(listSnapshots().map((s) => s.id));
    const lost = localIds.filter((id) => !after.has(id));
    expect(lost).toHaveLength(0);
  });

  it('R3 merge keeps this browser’s own custom sets at the cap', () => {
    for (let i = 0; i < MAX_CUSTOM_SETS; i += 1) {
      saveCustomSet([makeItem({ id: `l${i}`, position: { x: 1, z: 1 } })], `Local ${i}`, { now: () => 1_000 + i, idTag: `l${i}` });
    }
    const before = listCustomSets().map((s) => s.id);
    const incoming = Array.from({ length: 5 }, (_, i) => ({
      id: `remote-${i}`,
      name: `Remote ${i}`,
      savedAt: 90_000 + i,
      items: [makeItem({ id: `r${i}`, position: { x: 1, z: 1 } })],
    }));
    const n = importCustomSets(incoming);
    expect(n).toEqual({ added: 0, skipped: 5 });
    const after = new Set(listCustomSets().map((s) => s.id));
    const lost = before.filter((id) => !after.has(id));
    expect(lost).toHaveLength(0);
  });

  it('R4 restore keeps the recovery-copy cap', () => {
    const copies = Array.from({ length: 20 }, (_, i) => ({ savedAt: i + 1, raw: `{"broken":${i}` }));
    const bundle = parseBackup(JSON.stringify({ format: 'house-builder-backup', version: 1, recoveryCopies: copies }));
    if (!bundle.ok) throw new Error('parse');
    restoreBackup(bundle.bundle, house('Open', 1));
    expect(readRecoveryCopies().length).toBeLessThanOrEqual(MAX_RECOVERY_COPIES);
  });

  it('R5 a hostile backup cannot plant unbounded app-prefixed keys', () => {
    const settings: Record<string, string> = {};
    for (let i = 0; i < 500; i += 1) settings[`standalone-room-organizer-junk-${i}`] = 'x'.repeat(1000);
    settings['__proto__'] = 'x';
    settings['standalone-room-organizer-layout'] = '{"evil":1}';
    settings['standalone-room-organizer-library:_index'] = '{}';
    const text = JSON.stringify({ format: 'house-builder-backup', version: 1, settings }).replace(
      '"__proto__"',
      '"__proto__"'
    );
    const bundle = parseBackup(text);
    if (!bundle.ok) throw new Error('parse');
    const report = restoreBackup(bundle.bundle, house('Open', 1));
    expect(report.settings).toBe(0);
    let junk = 0;
    for (let i = 0; i < localStorage.length; i += 1) if (localStorage.key(i)?.includes('junk')) junk += 1;
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(junk).toBe(0);
  });

  it('R6 round trip keeps library order and savedAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    saveNamedLayout(house('Old', 1), 'Old');
    vi.setSystemTime(20_000);
    saveNamedLayout(house('Mid', 2), 'Mid');
    vi.setSystemTime(30_000);
    saveNamedLayout(house('New', 3), 'New');
    const before = listSavedLayouts().map((e) => [e.name, e.savedAt]);
    const text = JSON.stringify(createBackup(house('Open', 1)));
    localStorage.clear();
    vi.setSystemTime(99_000);
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error('parse');
    restoreBackup(parsed.bundle, house('Open', 1));
    const after = listSavedLayouts().map((e) => [e.name, e.savedAt]);
    expect(after).toEqual(before);
  });

  it('R7 floorPlanImage of a library house survives the round trip', () => {
    const withImage = { ...house('Plan', 1), floorPlanImage: 'data:image/png;base64,AAAA' } as RoomLayout;
    saveNamedLayout(withImage, 'Plan');
    const text = JSON.stringify(createBackup(house('Open', 1)));
    localStorage.clear();
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error('parse');
    restoreBackup(parsed.bundle, house('Open', 1));
    const entry = listSavedLayouts()[0];
    expect(entry && loadNamedLayout(entry.id)?.floorPlanImage).toBe('data:image/png;base64,AAAA');
    expect(localStorage.getItem(`standalone-room-organizer-library:${entry?.id}`)).toBe(
      JSON.stringify({ ...withImage })
    );
  });

  it('R8 quota failing mid library: nothing deleted, nothing half-written', () => {
    saveNamedLayout(house('Keep A', 1), 'Keep A');
    saveNamedLayout(house('Keep B', 1), 'Keep B');
    const before = listSavedLayouts().map((e) => e.id).sort();
    const bundle = parseBackup(
      JSON.stringify({
        format: 'house-builder-backup',
        version: 1,
        main: null,
        library: [
          { name: 'New 1', savedAt: 1, layout: house('New 1', 1) },
          { name: 'New 2', savedAt: 2, layout: house('New 2', 1) },
          { name: 'New 3', savedAt: 3, layout: house('New 3', 1) },
        ],
      })
    );
    if (!bundle.ok) throw new Error('parse');
    const real = Storage.prototype.setItem;
    let writes = 0;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.includes('library:')) {
        writes += 1;
        if (writes > 3) throw new DOMException('full', 'QuotaExceededError');
      }
      real.call(this, k, v);
    });
    const report = restoreBackup(bundle.bundle, house('Open', 1));
    expect(report.failed.length).toBeGreaterThan(0);
    spy.mockRestore();
    const after = listSavedLayouts().map((e) => e.id).sort();
    // index consistent with blobs
    const orphans: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) ?? '';
      if (key.startsWith('standalone-room-organizer-library:') && !key.endsWith('_index')) {
        const id = key.slice('standalone-room-organizer-library:'.length);
        if (!after.includes(id)) orphans.push(id);
      }
    }
    for (const id of before) expect(after).toContain(id);
    expect(orphans).toEqual([]);
  });
});
