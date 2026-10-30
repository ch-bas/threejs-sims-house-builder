// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { createBackup, parseBackup, restoreBackup, summarizeBackup } from './backup';
import { MAX_CUSTOM_SETS, listCustomSets, saveCustomSet } from './custom-sets';
import { listSavedLayouts, saveNamedLayout } from './library';
import { MAX_RECEIVED_LAYOUTS, addReceivedLayout, listReceivedLayouts } from './pasteboard';
import { measureStorage } from './storage-meter';
import type { RoomLayout } from './types';

function house(name: string, n: number, id = `h-${name}`): RoomLayout {
  return makeLayout({ id, name, floors: [makeFloor({ items: Array.from({ length: n }, (_, i) => makeItem({ id: `${name}${i}`, position: { x: i, z: 0 } })) })] });
}
const base = { format: 'house-builder-backup', version: 1, main: null, library: [], restorePoints: [], recoveryCopies: [], received: [], customSets: [], settings: {} };
function parse(o: object) { const p = parseBackup(JSON.stringify({ ...base, ...o })); if (!p.ok) throw new Error(p.reason); return p.bundle; }
/** Fill storage with a foreign key so only about `room` chars remain. */
function leaveRoom(room: number) {
  let lo = 0, hi = 6_000_000;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); try { localStorage.setItem('zz-other', 'x'.repeat(mid)); lo = mid; } catch { hi = mid - 1; } }
  localStorage.setItem('zz-other', 'x'.repeat(Math.max(0, lo - room)));
}
beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

describe('re-review D5', () => {
  it('restoring the same file twice adds a renamed copy only once', () => {
    saveNamedLayout(house('A', 3, 'local-a'), 'A');
    const bundle = parse({ library: [{ name: 'A', savedAt: 1, layout: house('A', 1, 'backup-a') }] });
    const current = house('Open', 2, 'open');
    expect(restoreBackup(bundle, current).library).toBe(1);
    expect(listSavedLayouts().map((entry) => entry.name).sort()).toEqual(['A', 'A (backup)']);
    expect(restoreBackup(bundle, current).library).toBe(0);
    expect(listSavedLayouts()).toHaveLength(2);
  });

  it('Q3 merge keeps every local received house when the board is at its cap', () => {
    for (let i = 0; i < MAX_RECEIVED_LAYOUTS; i += 1) addReceivedLayout(house(`L${i}`, 1), { now: () => 1000 + i });
    const bundle = parse({ received: [{ name: 'B', receivedAt: 5000, layout: house('B', 2) }] });
    restoreBackup(bundle, house('Open', 1));
    const names = listReceivedLayouts().map((e) => e.name);
    expect(names.filter((n) => n.startsWith('L')).length).toBe(MAX_RECEIVED_LAYOUTS);
  });
  it('Q4 500 crafted app-prefixed settings keys: none written, summary counts', () => {
    const settings: Record<string, string> = {};
    for (let i = 0; i < 500; i += 1) settings[`standalone-room-organizer-x${i}`] = 'v';
    settings['standalone-room-organizer-sidebar-tab'] = 'x'.repeat(20_000);
    const bundle = parse({ settings });
    expect(Object.keys(bundle.settings)).toEqual([]);
    expect(bundle.invalid).toBe(501);
    restoreBackup(bundle, house('Open', 1));
    expect(Object.keys(localStorage).filter((k) => k.startsWith('standalone-room-organizer-x')).length).toBe(0);
    expect(localStorage.getItem('standalone-room-organizer-sidebar-tab')).toBeNull();
  });
  it('Q5 five non-ASCII houses: backup, wipe, restore, restore again', () => {
    const names = ['Дом', 'Дача', '日本の家', 'بيت', 'Σπίτι'];
    names.forEach((n, i) => saveNamedLayout(house(n, i + 1), n, { savedAt: 1000 + i }));
    const file = JSON.stringify(createBackup(house('Open', 1)));
    localStorage.clear();
    const p = parseBackup(file); if (!p.ok) throw new Error();
    expect(summarizeBackup(p.bundle)).toMatchObject({ library: 5, invalid: 0 });
    restoreBackup(p.bundle, house('Open', 1));
    const after1 = listSavedLayouts().map((e) => [e.name, e.savedAt]);
    expect(after1.length).toBe(5);
    restoreBackup(p.bundle, house('Open', 1));
    const after2 = listSavedLayouts().map((e) => [e.name, e.savedAt]);
    expect(after2).toEqual(after1);
    expect(after2.map((x) => x[0]).sort()).toEqual([...names].sort());
    expect(after2.map((x) => x[1])).toEqual([1004, 1003, 1002, 1001, 1000]);
    // merge on top adds nothing
    const r = restoreBackup(p.bundle, house('Open', 1));
    expect(r.library).toBe(0);
    expect(listSavedLayouts().length).toBe(5);
  });
  it('Q7 custom sets at the cap survive a restore', () => {
    for (let i = 0; i < MAX_CUSTOM_SETS; i += 1) saveCustomSet([makeItem({ id: `s${i}` })], `Set ${i}`, { now: () => 1000 + i, idTag: `s${i}` });
    const incoming = { id: 'new', name: 'N', savedAt: Date.now() + 1e6, items: [makeItem({ id: 'n' })] };
    restoreBackup(parse({ customSets: [incoming] }), house('Open', 1));
    expect(listCustomSets().length).toBe(MAX_CUSTOM_SETS);
    expect(listCustomSets().some((s) => s.id === 'new')).toBe(false);
  });
  it('Q8 recovery copies can fill the quota and starve the library', () => {
    leaveRoom(400_000);
    const raw = 'y'.repeat(150_000);
    const bundle = parse({ main: house('Incoming', 1), recoveryCopies: [{ savedAt: 1, raw }, { savedAt: 2, raw: raw + 'z' }], library: [{ name: 'A', savedAt: 1, layout: house('A', 2) }] });
    const r = restoreBackup(bundle, house('Open', 1));
    expect({ rec: r.recoveryCopies, lib: r.library, failed: r.failed }).toEqual({ rec: 2, lib: 2, failed: [] });
  });
  it('Q9 meter ignores the probe as a house', () => {
    localStorage.setItem('standalone-room-organizer-library:_probe', 'x');
    localStorage.setItem('standalone-room-organizer-library:_index', '{}');
    expect(measureStorage(localStorage).libraryHouses).toEqual([]);
  });
});
