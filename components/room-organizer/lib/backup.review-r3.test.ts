// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { describeRestore, parseBackup, restoreBackup } from './backup';
import { listCustomSets, saveCustomSet } from './custom-sets';
import { listSavedLayouts, loadNamedLayout, saveNamedLayout } from './library';
import { addReceivedLayout, listReceivedLayouts } from './pasteboard';
import { listSnapshots, recordSnapshot } from './version-history';
import type { RoomLayout } from './types';

function house(name: string, n: number, id = `h-${name}`): RoomLayout {
  return makeLayout({ id, name, floors: [makeFloor({ items: Array.from({ length: n }, (_, i) => makeItem({ id: `${name}${i}`, position: { x: i, z: 0 } })) })] });
}
const base = { format: 'house-builder-backup', version: 1, main: null, library: [], restorePoints: [], recoveryCopies: [], received: [], customSets: [], settings: {} };
function parse(o: object) {
  const p = parseBackup(JSON.stringify({ ...base, ...o }));
  if (!p.ok) throw new Error(p.reason);
  return p.bundle;
}

const realSet = Storage.prototype.setItem;
let calls: string[] = [];
let failWhen: (key: string, n: number) => boolean = () => false;
beforeEach(() => {
  localStorage.clear();
  calls = [];
  failWhen = () => false;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    const n = calls.length;
    calls.push(key);
    if (failWhen(key, n)) {
      const e = new Error('quota');
      e.name = 'QuotaExceededError';
      throw e;
    }
    return realSet.call(this, key, value);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function contentIds(): string[] {
  return listSavedLayouts().map((e) => `${e.name}=${loadNamedLayout(e.id)?.floors[0]?.items.length}`).sort();
}

function seedLocal() {
  saveNamedLayout(house('A', 3, 'A-local'), 'A', { savedAt: 100 });
  saveNamedLayout(house('C', 4, 'C-local'), 'C', { savedAt: 101 });
  saveNamedLayout(house('Only', 5), 'Only', { savedAt: 102 });
  saveNamedLayout(house('Common', 6), 'Common', { savedAt: 103 });
  addReceivedLayout(house('RLocal', 2));
  saveCustomSet([makeItem({ id: 's1' })], 'LocalSet');
  localStorage.setItem('standalone-room-organizer-sidebar-tab', '"local"');
  recordSnapshot(house('Snap', 1), { force: true, now: () => 50 });
}
function bundle() {
  return parse({
    main: house('Incoming', 1),
    library: [
      { name: 'A', savedAt: 5, layout: house('A', 1, 'A-b') },
      { name: 'C', savedAt: 6, layout: house('C', 2, 'C-b') },
      { name: 'Common', savedAt: 7, layout: house('Common', 6) },
      { name: 'New', savedAt: 8, layout: house('New', 7) },
    ],
    received: [{ name: 'RB', receivedAt: 9, layout: house('RB', 3) }],
    customSets: [{ id: 'bset', name: 'BSet', savedAt: 10, items: [makeItem({ id: 'b1' })] }],
    settings: { 'standalone-room-organizer-sidebar-tab': '"backup"' },
    recoveryCopies: [{ savedAt: 11, raw: JSON.stringify(house('Rec', 1)) }],
    restorePoints: [{ id: 'rp1', savedAt: 12, layoutId: 'x', name: 'RP', layout: house('RP', 1, 'x') }],
  });
}

function run(fail: (key: string, n: number) => boolean) {
  seedLocal();
  const b = bundle();
  const snapshot = () => ({
    lib: contentIds(),
    sets: listCustomSets().map((s) => s.name),
    rec: listReceivedLayouts().map((r) => r.name),
    points: listSnapshots().map((p) => p.id),
    tab: localStorage.getItem('standalone-room-organizer-sidebar-tab'),
  });
  const before = snapshot();
  calls = [];
  failWhen = fail;
  const report = restoreBackup(b, house('Open', 1));
  failWhen = () => false;
  const after = snapshot();
  const lost = {
    lib: before.lib.filter((x) => !after.lib.includes(x)),
    sets: before.sets.filter((x) => !after.sets.includes(x)),
    rec: before.rec.filter((x) => !after.rec.includes(x)),
    points: before.points.filter((x) => !after.points.includes(x)),
    tab: before.tab !== after.tab,
  };
  return { report, after, lost, text: describeRestore(report), keys: [...calls] };
}

describe('r3 fault injection, restore (Merge only)', () => {
  it('without faults adds what is missing and keeps every local thing', () => {
    const r = run(() => false);
    expect(r.after.lib).toEqual(['A (backup)=1', 'A=3', 'C (backup)=2', 'C=4', 'Common=6', 'Incoming (backup)=1', 'New=7', 'Only=5']);
    expect(r.after.sets.sort()).toEqual(['BSet', 'LocalSet']);
    expect(r.after.rec.sort()).toEqual(['RB', 'RLocal']);
    expect(r.after.tab).toBe('"local"');
    expect(r.report.failed).toEqual([]);
    expect(r.report.restorePointsDropped).toBe(0);
  });

  for (const persistent of [false, true]) {
    it(`${persistent ? 'persistent' : 'single'} failure at every write loses nothing local but evictable restore points, and the notice says what happened`, () => {
      const total = run(() => false).keys.length;
      const problems: string[] = [];
      for (let i = 0; i < total; i += 1) {
        localStorage.clear();
        const r = run((_k, n) => (persistent ? n >= i : n === i));
        const key = r.keys[i] ?? '?';
        const { lost } = r;
        if (lost.lib.length || lost.sets.length || lost.rec.length || lost.tab) {
          problems.push(`#${i} ${key}: lost ${JSON.stringify(lost)}`);
        }
        // Restore points give way to anything written (#295); the notice must say so.
        if (lost.points.length !== r.report.restorePointsDropped || (lost.points.length > 0 && !/older restore point/.test(r.text))) {
          problems.push(`#${i} ${key}: ${lost.points.length} restore points dropped, notice: ${r.text}`);
        }
        if (r.report.failed.length > 0 && !/Didn’t fit in browser storage/.test(r.text)) {
          problems.push(`#${i} ${key}: failure not named: ${r.text}`);
        }
        if (/already holds everything/.test(r.text) && r.report.failed.length > 0) {
          problems.push(`#${i} ${key}: claims nothing missing: ${r.text}`);
        }
        const rest = r.text.replace(/(Nothing|nothing else) here was replaced or deleted\./, '');
        if (/replaced|deleted/.test(rest)) {
          problems.push(`#${i} ${key}: claims a replace or delete: ${r.text}`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});
