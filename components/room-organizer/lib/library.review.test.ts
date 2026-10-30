// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeItem, makeLayout } from './__testfixtures__/fixtures';
import { deleteNamedLayout, librarySlotId, listSavedLayouts, loadNamedLayout, saveNamedLayout } from './library';
import { saveLayout } from './persistence';
import { repairItem } from './schema';
import { listSnapshots, recordSnapshot } from './version-history';

const PREFIX = 'standalone-room-organizer-library:';

function limitStorageTo(capacity: number): void {
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    let used = key.length + value.length;
    for (let i = 0; i < this.length; i++) {
      const other = this.key(i);
      if (other !== null && other !== key) used += other.length + (this.getItem(other) ?? '').length;
    }
    if (used > capacity) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    original.call(this, key, value);
  });
}

function storageUsage(): number {
  let used = 0;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)!;
    used += key.length + (window.localStorage.getItem(key) ?? '').length;
  }
  return used;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('library saves and the autosave headroom, review cases (#565)', () => {
  it('a SUCCESSFUL save keeps restore points it did not need to evict', () => {
    const house = makeLayout({ name: 'Ringed' });
    expect(saveLayout(house).ok).toBe(true);
    const many = Array.from({ length: 800 }, (_, i) => makeItem({ id: `s${i}`, category: 'seating', position: { x: i % 9, z: i % 7 } }));
    expect(recordSnapshot(makeLayout({ name: 'Snapshotted', floors: [{ ...makeLayout().floors[0]!, items: many }] }))).toBe(true);
    expect(listSnapshots()).toHaveLength(1);
    // Room for the copy plus 64K headroom ONLY if the ring is counted as free
    // (autosave may evict it anyway).
    limitStorageTo(storageUsage() + 20_000);
    const result = saveNamedLayout(house, 'Copy');
    expect(result.ok).toBe(true);
    // free space after the save, ring still present:
    expect(listSnapshots()).toHaveLength(1);
  });

  it('probe key never left behind, success or failure', () => {
    const house = makeLayout({ name: 'P' });
    saveNamedLayout(house, 'P');
    expect(window.localStorage.getItem(`${PREFIX}_probe`)).toBeNull();
    limitStorageTo(storageUsage() + 10);
    expect(saveNamedLayout(house, 'Q').ok).toBe(false);
    expect(window.localStorage.getItem(`${PREFIX}_probe`)).toBeNull();
  });

  it('a house with a 1.7M-char floor plan can be saved to an EMPTY library in a 5Mi-char quota', () => {
    limitStorageTo(5 * 1024 * 1024);
    const house = makeLayout({ name: 'Big', floorPlanImage: `data:image/png;base64,${'A'.repeat(1_700_000)}` });
    expect(saveLayout(house).ok).toBe(true);
    const result = saveNamedLayout(house, 'Big copy');
    expect(result.ok).toBe(true);
  });

  it('re-saving an identical copy over its own slot at near-full storage', () => {
    const house = makeLayout({ name: 'Same' });
    expect(saveLayout(house).ok).toBe(true);
    expect(saveNamedLayout(house, 'Same').ok).toBe(true);
    limitStorageTo(storageUsage() + 30_000);
    const result = saveNamedLayout(house, 'Same');
    expect(result.ok).toBe(true);
  });
});

describe('library slots, review cases (#550)', () => {
  it('NFC and NFD Café share a slot', () => {
    expect(librarySlotId('Café')).toBe(librarySlotId('Café'));
  });

  it('legacy NFD Café under "cafe" is moved when saving ASCII "Cafe"', () => {
    const nfd = makeLayout({ name: 'Café' });
    window.localStorage.setItem(`${PREFIX}cafe`, JSON.stringify(nfd));
    window.localStorage.setItem(
      `${PREFIX}_index`,
      JSON.stringify({ entries: [{ id: 'cafe', name: 'Café', savedAt: 1, itemCount: 0, floorCount: 1 }] })
    );
    const ascii = makeLayout({ name: 'Cafe', floors: [{ ...makeLayout().floors[0]!, items: [makeItem({ id: 'a' })] }] });
    expect(saveNamedLayout(ascii, 'Cafe').ok).toBe(true);
    const list = listSavedLayouts();
    expect(list.map((e) => e.name).sort()).toEqual(['Cafe', 'Café'].sort());
    for (const entry of list) expect(loadNamedLayout(entry.id)?.name).toBe(entry.name);
    // NFC save of Café now replaces the moved NFD entry, no duplicate
    expect(saveNamedLayout(makeLayout({ name: 'Café' }), 'Café')).toMatchObject({ ok: true, overwrote: true });
    expect(listSavedLayouts()).toHaveLength(2);
  });

  it('move survives the main write failing mid-move (no loss)', () => {
    const cafe = makeLayout({ name: 'Café' });
    window.localStorage.setItem(`${PREFIX}caf`, JSON.stringify(cafe));
    window.localStorage.setItem(
      `${PREFIX}_index`,
      JSON.stringify({ entries: [{ id: 'caf', name: 'Café', savedAt: 1, itemCount: 0, floorCount: 1 }] })
    );
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === `${PREFIX}caf` ) throw new DOMException('q', 'QuotaExceededError');
      original.call(this, key, value);
    });
    expect(saveNamedLayout(makeLayout({ name: 'Caf' }), 'Caf').ok).toBe(false);
    vi.restoreAllMocks();
    expect(listSavedLayouts().map((e) => e.id)).toEqual(['caf']);
    expect(loadNamedLayout('caf')?.name).toBe('Café');
    expect(window.localStorage.getItem(`${PREFIX}u_café`)).toBeNull();
  });

  it('index write fails mid-move and the rollback of caf also fails', () => {
    const cafe = makeLayout({ name: 'Café', floors: [{ ...makeLayout().floors[0]!, items: [makeItem({ id: 'big', name: 'x'.repeat(50) })] }] });
    const cafeJson = JSON.stringify(cafe);
    window.localStorage.setItem(`${PREFIX}caf`, cafeJson);
    window.localStorage.setItem(
      `${PREFIX}_index`,
      JSON.stringify({ entries: [{ id: 'caf', name: 'Café', savedAt: 1, itemCount: 1, floorCount: 1 }] })
    );
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === `${PREFIX}_index`) throw new DOMException('q', 'QuotaExceededError');
      if (key === `${PREFIX}caf` && value === cafeJson) throw new DOMException('q', 'QuotaExceededError');
      original.call(this, key, value);
    });
    expect(saveNamedLayout(makeLayout({ name: 'Caf' }), 'Caf').ok).toBe(false);
    vi.restoreAllMocks();
    const list = listSavedLayouts();
    // Listed "Café" must open Café
    for (const entry of list) expect(loadNamedLayout(entry.id)?.name).toBe(entry.name);
  });

  it('delete after move', () => {
    const cafe = makeLayout({ name: 'Café' });
    window.localStorage.setItem(`${PREFIX}caf`, JSON.stringify(cafe));
    window.localStorage.setItem(
      `${PREFIX}_index`,
      JSON.stringify({ entries: [{ id: 'caf', name: 'Café', savedAt: 1, itemCount: 0, floorCount: 1 }] })
    );
    expect(saveNamedLayout(makeLayout({ name: 'Caf' }), 'Caf').ok).toBe(true);
    const moved = listSavedLayouts().find((e) => e.name === 'Café')!;
    expect(deleteNamedLayout(moved.id)).toBe(true);
    expect(listSavedLayouts().map((e) => e.name)).toEqual(['Caf']);
    expect(loadNamedLayout('caf')?.name).toBe('Caf');
  });

  it('long Unicode name whose non-ASCII char is past the name cap', () => {
    const name = `${'a'.repeat(200)}é`;
    const r = saveNamedLayout(makeLayout({ name }), name);
    expect(r.ok).toBe(true);
    const r2 = saveNamedLayout(makeLayout({ name }), name);
    expect(r2).toMatchObject({ ok: true, overwrote: true });
    expect(listSavedLayouts()).toHaveLength(1);
  });
});

describe('repairItem on incoming items (#553)', () => {
  it('repairItem keeps identity and is cheap for 200 items', () => {
    const items = Array.from({ length: 200 }, (_, i) => makeItem({ id: `i${i}`, category: 'seating', position: { x: i, z: 0 } }));
    let same = 0;
    for (let k = 0; k < 100; k++) for (const it of items) if (repairItem(it) === it) same++;
    expect(same).toBe(20000);
  });
});
